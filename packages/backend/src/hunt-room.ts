import type {
  Player, GamePhase, Avatar, HuntConfig, HuntItem, HuntItemProgress,
  HuntPlayerProgress, HuntAppeal, HuntResults, HuntResultsItemDetail,
  ClientHuntState, HuntTeamSummary, HuntItemStatus, HuntHistoryEntry,
  HuntHistorySummary,
} from '@lamo-trivia/shared';
import type { HuntServerMessage } from '@lamo-trivia/shared';
import {
  HuntClientMessageSchema, HuntConfigSchema, AVATARS, HUNT_EXPIRY_MS, HUNT_LIMITS,
} from '@lamo-trivia/shared';
import { getAnthropicKey } from './env';
import type { Env } from './env';
import { verifyAndCompare, VERIFICATION_MODEL } from './vision';
import { logEvent } from './analytics';
import {
  adjustUserCredits, withKvLock, KvLockBusyError, InsufficientCreditsError,
} from './auth';

type AlarmAction =
  | 'expire_hunt'
  | 'start_playing'
  | 'time_warning_5'
  | 'time_warning_1'
  | 'end_hunt'
  | 'cleanup_hunt';

/** A finished submission — one a model actually returned a verdict for —
 *  replayed verbatim if the client retries the same uploadId after a dropped
 *  ack. A server-side failure is deliberately never recorded here: it is not
 *  finished, and replaying it would answer the client's reconnect auto-retry
 *  with a canned failure without ever re-verifying the photo, dead-ending the
 *  retry the attempt refund exists to enable. */
interface CompletedUpload {
  /** `${playerId}:${itemId}:${uploadId}` */
  key: string;
  result: HuntServerMessage;
}

interface HuntRoomState {
  huntId: string;
  config: HuntConfig;
  phase: GamePhase;
  hostId: string;
  hostEmail?: string;
  creditsDeducted?: number;
  players: Player[];
  items: HuntItem[];
  progress: Record<string, HuntPlayerProgress>;
  pendingAppeals: HuntAppeal[];
  nextAlarmAction: AlarmAction | null;
  createdAt: number;
  startedAt?: number;
  endsAt?: number;
  // Secret per-player rejoin tokens (playerId → token). Kept out of the
  // Player objects, which are broadcast to all clients.
  rejoinTokens: Record<string, string>;
  /** Delete-auth secret handed to the host when history is saved. Retained so
   *  a host who was offline at that moment can be re-issued it on reconnect. */
  hostSecret?: string;
  /** The player who held host at the moment hostSecret was minted. `hostId`
   *  drifts afterwards — an explicit Leave on the results screen transfers it
   *  to a remaining player — and the delete-auth secret must not follow it. */
  hostSecretOwnerId?: string;
  /** Set once this room has written its own `hunt-host:` KV index entry, so
   *  the backfill costs two KV writes per room lifetime, not per message. */
  hostIndexWritten?: boolean;
  /** playerId → itemId → consecutive verification failures already refunded.
   *  Caps how often a failing item can hand the attempt back. */
  refundedFailures: Record<string, Record<string, number>>;
  /** Recently completed submissions, oldest first, for uploadId idempotency. */
  completedUploads: CompletedUpload[];
  /** `playerId:itemId` → token for the verification currently in flight. The
   *  client re-sends the same uploadId after a dropped ack, so the uploadId
   *  cannot tell one verification call from another: a swept submission that
   *  is resubmitted and then has its original call throw late would otherwise
   *  apply that failure to the new call, discarding its real verdict. */
  activeVerifications: Record<string, string>;
}

// Per-connection message rate limiting
const WS_RATE_WINDOW_MS = 10_000;
const WS_RATE_MAX_MESSAGES = 30;

// A verification that fails server-side refunds the attempt, but only a few
// times per item — otherwise a client can loop a failing upload forever, and
// every iteration bills two Sonnet calls plus a Haiku call.
const MAX_REFUNDED_FAILURES_PER_ITEM = 2;

// How many finished submissions to remember for uploadId replay. One entry per
// item is a single team's working set, and the schema allows 15 items — a
// smaller cap evicts a legitimate replay before the client's reconnect-retry
// arrives and the double-attempt bug comes back. Counted per player, so a busy
// team cannot evict another team's entries either.
const MAX_COMPLETED_UPLOADS_PER_PLAYER = HUNT_LIMITS.maxItems;

// The photo-upload gate in routes/hunts.ts refuses an upload unless
// `hunt-host:{huntId}` exists. These mirror recordHuntHost's TTL and per-host
// list cap exactly, so an entry this room backfills is indistinguishable from
// one written at creation time.
const HUNT_HOST_TTL = 90 * 24 * 60 * 60;
const MAX_TRACKED_HUNTS = 200;

// How long a dropped connection may stay gone before the player is removed
// from the lobby (waiting) or loses host (playing). Phones background
// constantly mid-hunt — camera, lock screen — so don't react instantly.
const DISCONNECT_GRACE_MS = 60_000;

export class ScavengerHuntRoom {
  private state: DurableObjectState;
  private env: Env;
  private room: HuntRoomState | null = null;
  private wsRates = new Map<WebSocket, { count: number; start: number }>();
  // Set synchronously at the top of handleStartHunt. The phase isn't committed
  // until the end of that method and the input gate opens on every KV call in
  // between, so a phase-only guard lets a concurrent start through.
  private startInFlight = false;
  // Same reasoning as startInFlight: the backfill's KV round trips reopen the
  // input gate, so a second message would start a duplicate backfill before
  // the persisted flag is written.
  private hostIndexInFlight = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<HuntRoomState>('room');
      if (stored) {
        // Backfill fields added after the room was persisted
        stored.rejoinTokens ??= {};
        stored.refundedFailures ??= {};
        stored.completedUploads ??= [];
        stored.activeVerifications ??= {};
        this.room = stored;
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      // Configure hunt room
      if (request.method === 'POST' && url.pathname === '/config') {
        const body = (await request.json()) as Record<string, unknown>;
        const huntId = typeof body.huntId === 'string' ? body.huntId : '';
        if (!huntId) {
          return Response.json({ error: 'Missing huntId' }, { status: 400 });
        }
        const parsed = HuntConfigSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json({ error: 'Invalid hunt config' }, { status: 400 });
        }
        const config = parsed.data as HuntConfig;
        const hostEmail = typeof body.hostEmail === 'string' ? body.hostEmail : undefined;
        this.room = {
          huntId,
          config,
          phase: 'waiting',
          hostId: '',
          hostEmail,
          players: [],
          items: config.items,
          progress: {},
          pendingAppeals: [],
          nextAlarmAction: 'expire_hunt',
          createdAt: Date.now(),
          rejoinTokens: {},
          refundedFailures: {},
          completedUploads: [],
          activeVerifications: {},
        };
        await this.persist();

        // Set expiry alarm for waiting phase
        await this.state.storage.setAlarm(Date.now() + HUNT_EXPIRY_MS);

        return Response.json({ ok: true });
      }

      // WebSocket upgrade
      if (request.headers.get('Upgrade') === 'websocket') {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.state.acceptWebSocket(server);
        // Stash the email in the attachment (survives hibernation, unlike in-memory
        // maps) until join_hunt replaces it with the playerId
        const email = request.headers.get('X-User-Email');
        if (email) {
          server.serializeAttachment({ pendingEmail: email });
        }
        return new Response(null, { status: 101, webSocket: client });
      }

      return new Response('Expected WebSocket or /config', { status: 400 });
    } catch (err) {
      console.error('ScavengerHuntRoom fetch error', {
        huntId: this.room?.huntId,
        path: url.pathname,
        error: err instanceof Error ? err.message : String(err),
      });
      return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const now = Date.now();
    const rate = this.wsRates.get(ws);
    if (!rate || now - rate.start > WS_RATE_WINDOW_MS) {
      this.wsRates.set(ws, { count: 1, start: now });
    } else {
      rate.count++;
      if (rate.count > WS_RATE_MAX_MESSAGES) {
        this.sendTo(ws, { type: 'error', message: 'Rate limit exceeded' });
        ws.close(1008, 'Rate limit exceeded');
        this.wsRates.delete(ws);
        return;
      }
    }

    // Resilience checks on every message during active play
    if (this.room?.phase === 'playing') {
      // Fallback: end hunt if alarm chain failed and endsAt has passed.
      // Keep processing the message — handlers respond with a proper error
      // for a finished hunt instead of silently dropping the action.
      if (this.room.endsAt && now > this.room.endsAt) {
        await this.finishHunt();
      } else {
        // Auto-reset items stuck in pending_review for >60s (API failure or DO restart)
        await this.resetStuckPendingReviews(now);
      }
    } else if (
      this.room?.phase === 'starting' &&
      this.room.startedAt &&
      now - this.room.startedAt > 30_000
    ) {
      // Fallback: the start_playing alarm was lost (e.g. DO died between
      // persist and setAlarm) — don't leave players stuck on the countdown
      await this.startHuntPlaying();
    }

    // Lazily act on players who dropped past the grace period, and repair this
    // hunt's own host index (the single alarm slot belongs to the game timer
    // chain, so neither gets a dedicated alarm)
    if (this.room) {
      await this.backfillHostIndex();
      await this.sweepDisconnectedPlayers(now);
    }

    const raw = typeof message === 'string' ? message : '';
    if (raw.length > 8192) {
      this.sendTo(ws, { type: 'error', message: 'Message too large' });
      return;
    }

    try {
      const data = JSON.parse(raw);
      const parsed = HuntClientMessageSchema.safeParse(data);
      if (!parsed.success) {
        this.sendTo(ws, { type: 'error', message: 'Invalid message format' });
        return;
      }

      switch (parsed.data.type) {
        case 'join_hunt':
          await this.handleJoin(ws, parsed.data.username, parsed.data.rejoinToken);
          break;
        case 'rejoin_hunt':
          await this.handleRejoin(ws, parsed.data.username, parsed.data.rejoinToken);
          break;
        case 'leave_hunt':
          await this.handleLeave(ws, true);
          break;
        case 'start_hunt':
          await this.handleStartHunt(ws);
          break;
        case 'reveal_clue':
          await this.handleRevealClue(ws, parsed.data.itemId, parsed.data.clueId);
          break;
        case 'submit_photo':
          await this.handleSubmitPhoto(ws, parsed.data.itemId, parsed.data.uploadId);
          break;
        case 'approve_appeal':
          await this.handleApproveAppeal(ws, parsed.data.playerId, parsed.data.itemId);
          break;
        case 'reject_appeal':
          await this.handleRejectAppeal(ws, parsed.data.playerId, parsed.data.itemId);
          break;
        case 'contest_photo':
          await this.handleContestPhoto(ws, parsed.data.itemId);
          break;
        case 'claim_host':
          await this.handleClaimHost(ws);
          break;
        case 'send_message':
          await this.handleSendMessage(ws, parsed.data.message, parsed.data.targetPlayerId);
          break;
        case 'update_config':
          await this.handleUpdateConfig(ws, parsed.data.config);
          break;
        case 'ping': {
          this.sendTo(ws, { type: 'pong' });
          // During active/finished phases, resync full state to recover from missed broadcasts
          if (this.room && (this.room.phase === 'playing' || this.room.phase === 'finished')) {
            const pingPlayerId = this.getPlayerId(ws);
            if (pingPlayerId) {
              this.sendTo(ws, { type: 'hunt_state', state: this.getClientHuntState(pingPlayerId) });
            }
          }
          break;
        }
      }
    } catch (err) {
      console.error('WebSocket message error', {
        huntId: this.room?.huntId,
        error: err instanceof Error ? err.message : String(err),
      });
      this.sendTo(ws, { type: 'error', message: 'Failed to parse message' });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.wsRates.delete(ws);
    await this.handleLeave(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.wsRates.delete(ws);
    await this.handleLeave(ws);
  }

  async alarm(): Promise<void> {
    if (!this.room) return;

    switch (this.room.nextAlarmAction) {
      case 'expire_hunt':
        await this.expireHunt();
        break;
      case 'start_playing':
        await this.startHuntPlaying();
        break;
      case 'time_warning_5':
        this.broadcast({ type: 'time_warning', secondsRemaining: 300 });
        this.room.nextAlarmAction = 'time_warning_1';
        await this.persist();
        if (this.room.endsAt) {
          await this.state.storage.setAlarm(this.room.endsAt - 60 * 1000);
        }
        break;
      case 'time_warning_1':
        this.broadcast({ type: 'time_warning', secondsRemaining: 60 });
        this.room.nextAlarmAction = 'end_hunt';
        await this.persist();
        if (this.room.endsAt) {
          await this.state.storage.setAlarm(this.room.endsAt);
        }
        break;
      case 'end_hunt':
        await this.finishHunt();
        break;
      case 'cleanup_hunt':
        await this.cleanupHunt();
        break;
    }
  }

  // --- Handlers ---

  private async handleJoin(ws: WebSocket, username: string, rejoinToken?: string): Promise<void> {
    if (!this.room) {
      this.sendTo(ws, { type: 'error', message: 'Hunt not found', code: 'HUNT_NOT_FOUND' });
      return;
    }

    if (this.room.phase !== 'waiting') {
      // If this player already exists, redirect to rejoin
      const existing = this.room.players.find(
        (p) => p.username.toLowerCase() === username.toLowerCase(),
      );
      if (existing) {
        await this.handleRejoin(ws, username, rejoinToken);
        return;
      }
      this.sendTo(ws, { type: 'error', message: 'Hunt already started', code: 'HUNT_STARTED' });
      return;
    }

    if (this.room.players.length >= this.room.config.maxPlayers) {
      this.sendTo(ws, { type: 'error', message: 'Hunt is full', code: 'HUNT_FULL' });
      return;
    }

    // If a player with the same username already exists (e.g., returning after navigating away),
    // re-attach to the existing player instead of creating a duplicate
    const existingPlayer = this.room.players.find(
      (p) => p.username.toLowerCase() === username.toLowerCase(),
    );
    if (existingPlayer) {
      await this.reattachPlayer(ws, existingPlayer, rejoinToken);
      return;
    }

    const playerId = crypto.randomUUID();
    const avatar = this.pickAvatar();
    const player: Player = {
      id: playerId,
      username,
      avatar,
      connectedAt: Date.now(),
      score: 0,
    };

    // Read the creator email before the playerId attachment replaces it
    const wsEmail = this.getPendingEmail(ws);
    ws.serializeAttachment(playerId);

    this.room.players.push(player);

    // Secret rejoin token — sent only to this player's own socket
    const newToken = crypto.randomUUID();
    this.room.rejoinTokens[playerId] = newToken;

    // Assign host: prefer the creator (matched by email), otherwise first joiner
    if (this.room.hostEmail && wsEmail && wsEmail === this.room.hostEmail) {
      this.room.hostId = playerId;
      if (this.room.players.length > 1) {
        this.broadcast({ type: 'host_changed', hostId: playerId });
      }
    } else if (this.room.hostId === '') {
      this.room.hostId = playerId;
    }

    await this.persist();

    this.sendTo(ws, { type: 'join_confirmed', playerId, rejoinToken: newToken });
    this.sendTo(ws, { type: 'hunt_state', state: this.getClientHuntState(playerId) });
    this.broadcastExcept(ws, { type: 'player_joined', player });
    await this.notifyGroupOfUpdate();
  }

  /**
   * Re-attach a socket to an existing player after verifying the rejoin
   * token. Tokens didn't always exist — players from older hunts are
   * grandfathered in and issued one on their first reconnect.
   */
  private async reattachPlayer(
    ws: WebSocket,
    player: Player,
    rejoinToken: string | undefined,
  ): Promise<boolean> {
    if (!this.room) return false;

    const expectedToken = this.room.rejoinTokens[player.id];
    if (expectedToken && rejoinToken !== expectedToken) {
      this.sendTo(ws, {
        type: 'error',
        message: 'That username is taken in this hunt',
        code: 'USERNAME_TAKEN',
      });
      return false;
    }

    // Read the creator email before the playerId attachment replaces it
    const wsEmail = this.getPendingEmail(ws);
    ws.serializeAttachment(player.id);
    this.closeStaleSockets(player.id, ws);

    const token = expectedToken ?? crypto.randomUUID();
    this.room.rejoinTokens[player.id] = token;
    player.disconnectedAt = undefined;

    // The creator is the durable host — restore the role if it drifted to
    // another player while they were disconnected
    if (
      this.room.hostEmail &&
      wsEmail === this.room.hostEmail &&
      this.room.hostId !== player.id
    ) {
      this.room.hostId = player.id;
      this.broadcast({ type: 'host_changed', hostId: player.id });
    }

    await this.persist();

    this.sendTo(ws, { type: 'join_confirmed', playerId: player.id, rejoinToken: token });
    this.sendTo(ws, { type: 'hunt_state', state: this.getClientHuntState(player.id) });
    return true;
  }

  private async handleRejoin(ws: WebSocket, username: string, rejoinToken?: string): Promise<void> {
    if (!this.room) {
      this.sendTo(ws, { type: 'error', message: 'Hunt not found', code: 'HUNT_NOT_FOUND' });
      return;
    }

    // Read the creator email before reattachPlayer swaps the attachment for
    // the playerId — the host-secret re-issue below still needs it
    const wsEmail = this.getPendingEmail(ws);

    // Find existing player by username (case insensitive)
    const existingPlayer = this.room.players.find(
      (p) => p.username.toLowerCase() === username.toLowerCase(),
    );

    if (!existingPlayer) {
      // If hunt is still in waiting phase, redirect to normal join
      if (this.room.phase === 'waiting') {
        await this.handleJoin(ws, username, rejoinToken);
      } else {
        this.sendTo(ws, { type: 'error', message: 'Player not found in this hunt', code: 'PLAYER_NOT_FOUND' });
      }
      return;
    }

    // Verifies the rejoin token, re-attaches the socket, restores host to
    // the creator, and sends join_confirmed + hunt_state
    const reattached = await this.reattachPlayer(ws, existingPlayer, rejoinToken);
    if (!reattached) return;

    // If playing, also send the items (normally sent via hunt_started)
    if (this.room.phase === 'playing' && this.room.endsAt) {
      this.sendTo(ws, {
        type: 'hunt_started',
        items: this.room.items,
        endsAt: this.room.endsAt,
      });
    }

    // If finished, resend results
    if (this.room.phase === 'finished') {
      const results = this.buildResults();
      this.sendTo(ws, { type: 'hunt_finished', results });

      // The delete-auth secret was delivered once, over whichever socket the
      // host happened to have open when history was saved. Re-issue it here or
      // a host who was disconnected at that instant can never delete their
      // hunt's history and photos — but only to the account it was minted for,
      // never to whoever holds hostId now (see canReceiveHostSecret).
      if (this.room.hostSecret && this.canReceiveHostSecret(existingPlayer.id, wsEmail)) {
        this.sendTo(ws, {
          type: 'hunt_history_saved',
          huntId: this.room.huntId,
          hostSecret: this.room.hostSecret,
        });
      }
    }

    // Send any pending appeals to host
    if (existingPlayer.id === this.room.hostId && this.room.pendingAppeals.length > 0) {
      for (const appeal of this.room.pendingAppeals) {
        this.sendTo(ws, { type: 'appeal_received', appeal });
      }
    }
  }

  private async handleLeave(ws: WebSocket, explicit = false): Promise<void> {
    if (!this.room) return;

    const playerId = this.getPlayerId(ws);
    if (!playerId) return;

    // If the player reconnected, a late close of the old socket must not
    // remove them or transfer host away from their live connection
    const otherActive = this.state.getWebSockets().some(
      (s) => s !== ws && this.getPlayerId(s) === playerId,
    );
    if (otherActive) return;

    // A dropped connection isn't a departure. Mark the time and let the
    // sweep act only if the player stays gone past the grace period.
    if (!explicit) {
      const player = this.room.players.find((p) => p.id === playerId);
      if (player && !player.disconnectedAt) {
        player.disconnectedAt = Date.now();
        await this.persist();
      }
      return;
    }

    // During playing/finished, don't remove the player — just detach the WebSocket
    // so they can rejoin and see their progress/results
    if (this.room.phase === 'playing' || this.room.phase === 'finished') {
      if (this.room.hostId === playerId) {
        await this.transferHost(playerId);
      }
      return;
    }

    // During waiting/starting, fully remove the player
    await this.removePlayer(playerId);
  }

  /** Fully remove a player during the waiting/starting phases. */
  private async removePlayer(playerId: string): Promise<void> {
    if (!this.room) return;

    const wasHost = this.room.hostId === playerId;

    this.room.players = this.room.players.filter((p) => p.id !== playerId);
    delete this.room.progress[playerId];
    delete this.room.rejoinTokens[playerId];
    // Nothing references a departed player again, and their leftovers count
    // against the per-player replay cap if they rejoin under a new id
    delete this.room.refundedFailures[playerId];
    this.room.completedUploads = this.room.completedUploads.filter(
      (e) => !e.key.startsWith(`${playerId}:`),
    );
    for (const key of Object.keys(this.room.activeVerifications)) {
      if (key.startsWith(`${playerId}:`)) delete this.room.activeVerifications[key];
    }

    let newHostId: string | undefined;
    if (wasHost && this.room.players.length > 0) {
      this.room.hostId = this.room.players[0].id;
      newHostId = this.room.hostId;
    } else if (wasHost) {
      // Reset so the next joiner is auto-assigned host
      this.room.hostId = '';
    }

    await this.persist();
    this.broadcast({ type: 'player_left', playerId, ...(newHostId ? { newHostId } : {}) });
    await this.notifyGroupOfUpdate();
  }

  /**
   * Whether this player may be handed the delete-auth secret again.
   *
   * `hostId` is not the right identity: when the real host taps Leave on the
   * results screen, handleLeave(explicit) with phase 'finished' transfers host
   * to a remaining player. That player rejoining would otherwise be issued a
   * secret that deletes the real host's saved history and every R2 photo with
   * it, and that also bypasses canViewHunt on GET /:huntId/history. So the
   * secret goes back only to the player it was minted for.
   *
   * Rooms whose history was saved before the owner was recorded fall back to
   * the creator's email, which the Worker sets on the socket from the session
   * (X-User-Email is stripped from client requests) — otherwise a legitimate
   * host mid-way through an already-finished hunt would be stranded.
   */
  private canReceiveHostSecret(playerId: string, wsEmail: string | null): boolean {
    const room = this.room;
    if (!room) return false;
    if (room.hostSecretOwnerId) return room.hostSecretOwnerId === playerId;
    return !!room.hostEmail && wsEmail === room.hostEmail;
  }

  /** Hand host to the first connected player and bring them up to speed. */
  private async transferHost(fromPlayerId: string): Promise<void> {
    if (!this.room || this.room.hostId !== fromPlayerId) return;

    const candidate = this.room.players.find(
      (p) => p.id !== fromPlayerId && this.findPlayerWebSocket(p.id) !== null,
    );
    if (!candidate) return;

    this.room.hostId = candidate.id;
    await this.persist();
    this.broadcast({ type: 'host_changed', hostId: candidate.id });

    // Pending appeals only flow to the host at creation or rejoin time —
    // the incoming host needs them pushed or they'd rot unreviewed
    const hostWs = this.findPlayerWebSocket(candidate.id);
    if (hostWs) {
      for (const appeal of this.room.pendingAppeals) {
        this.sendTo(hostWs, { type: 'appeal_received', appeal });
      }
    }
  }

  /**
   * Act on players whose connection has been gone past the grace period:
   * remove them from a waiting lobby, or transfer host away mid-hunt.
   * Called lazily from the message path — the alarm slot is taken by the
   * game timer chain.
   */
  private async sweepDisconnectedPlayers(now: number): Promise<void> {
    if (!this.room) return;

    let cleared = false;
    for (const player of [...this.room.players]) {
      if (!player.disconnectedAt) continue;

      if (this.findPlayerWebSocket(player.id)) {
        // Reconnected without a clean rejoin — clear the marker
        player.disconnectedAt = undefined;
        cleared = true;
        continue;
      }

      if (now - player.disconnectedAt < DISCONNECT_GRACE_MS) continue;

      if (this.room.phase === 'waiting') {
        await this.removePlayer(player.id);
      } else if (this.room.phase === 'playing' && this.room.hostId === player.id) {
        await this.transferHost(player.id);
      }
    }

    if (cleared) {
      await this.persist();
    }
  }

  /**
   * Write this hunt's own `hunt-host:` index entry from persisted state.
   *
   * POST /api/hunts/:huntId/photos refuses an upload unless that key exists,
   * and the only writer is recordHuntHost() at hunt-creation time — so every
   * hunt already waiting or mid-play when that gate ships would answer every
   * submit_photo with "Hunt not found", permanently, on a hunt the host has
   * already paid credits for. Nothing outside the room can repair it: Durable
   * Objects are not enumerable and HuntHistoryEntry carries no host email.
   * hostEmail is an old field, so every existing hunt already has one.
   *
   * The key format, value and TTL mirror recordHuntHost in routes/hunts.ts
   * exactly, companion `host-hunts:` index included — a mismatch leaves the
   * gate shut and the history listing blind. Runs once per room lifetime,
   * guarded by a persisted flag.
   */
  private async backfillHostIndex(): Promise<void> {
    const room = this.room;
    if (!room || room.hostIndexWritten || !room.hostEmail) return;
    if (this.hostIndexInFlight) return;
    this.hostIndexInFlight = true;

    const { huntId, hostEmail } = room;
    try {
      await this.env.TRIVIA_KV.put(`hunt-host:${huntId}`, hostEmail, {
        expirationTtl: HUNT_HOST_TTL,
      });

      const existing =
        (await this.env.TRIVIA_KV.get<string[]>(`host-hunts:${hostEmail}`, 'json')) ?? [];
      const updated = [huntId, ...existing.filter((id) => id !== huntId)]
        .slice(0, MAX_TRACKED_HUNTS);
      await this.env.TRIVIA_KV.put(`host-hunts:${hostEmail}`, JSON.stringify(updated));

      // Flag only after both writes land: a failure has to be retried on the
      // next message, not remembered as done
      if (this.room) {
        this.room.hostIndexWritten = true;
        await this.persist();
      }
    } catch (err) {
      console.error('Hunt host index backfill failed', {
        huntId,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.hostIndexInFlight = false;
    }
  }

  private async handleStartHunt(ws: WebSocket): Promise<void> {
    if (!this.room) return;

    // Without this guard a duplicate start_hunt (double-click, stale tab) would
    // re-deduct credits and re-initialize progress, wiping a hunt mid-play.
    // The phase isn't persisted as 'starting' until the very end of this
    // method, and every KV/subrequest await before then reopens the DO input
    // gate — so the phase check alone lets a second concurrent start_hunt
    // through and bills the host twice. startInFlight is set synchronously,
    // before the first await, and cleared on every exit path below.
    if (this.room.phase !== 'waiting' || this.startInFlight) {
      this.sendTo(ws, { type: 'error', message: 'Hunt has already started' });
      return;
    }
    this.startInFlight = true;
    try {
      await this.startHunt(ws);
    } finally {
      // By the time we get here the phase is either 'starting' (the durable
      // guard has taken over) or still 'waiting' because the start failed —
      // either way the room must not stay wedged behind the in-memory flag.
      this.startInFlight = false;
    }
  }

  /** Body of handleStartHunt, run under the startInFlight guard. */
  private async startHunt(ws: WebSocket): Promise<void> {
    if (!this.room) return;

    const playerId = this.getPlayerId(ws);
    if (playerId !== this.room.hostId) {
      this.sendTo(ws, { type: 'error', message: 'Only the host can start the hunt' });
      return;
    }

    // Don't count (or bill credits for) players who dropped out of the
    // lobby past the grace period
    await this.sweepDisconnectedPlayers(Date.now());

    // Every await from here on reopens the DO input gate, and an expire_hunt
    // alarm delivered in that window nulls this.room and calls deleteAll() —
    // so re-check before each deref, the same discipline finishHunt and
    // saveHistory already follow
    if (!this.room) return;

    const participantCount = this.room.players.length;
    if (participantCount < this.room.config.minPlayers) {
      this.sendTo(ws, {
        type: 'error',
        message: `Need at least ${this.room.config.minPlayers} teams to start`,
      });
      return;
    }

    // Deduct credits from host
    if (this.room.hostEmail) {
      const creditsNeeded = this.room.items.length * this.room.config.maxRetries * participantCount;
      const { huntId, hostEmail } = this.room;
      const details = `Hunt "${this.room.config.name}" — ${this.room.items.length} items × ${this.room.config.maxRetries} retries × ${participantCount} teams`;

      // One lock covers the whole charge, serialising per host: two hunts
      // started at once by one host each read a pre-charge balance, and only
      // serialising them keeps the second one's refusal honest.
      //
      // This replaces the old `credit-lock:{huntId}` get-then-put, which is now
      // redundant: a second charge for *this* hunt is stopped durably by the
      // idempotency key below rather than by a 60s KV key, and withKvLock's
      // nonce arbitration is stricter than a bare read. The key here is
      // per-host and distinct from the `credit-lock:user:` key
      // adjustUserCredits takes internally, so the two nest without
      // deadlocking — neither ever waits, a held lock throws immediately.
      // hostEmail is a stored User.email, so it is already normalized.
      //
      // Affordability is adjustUserCredits' decision, not a pre-check here. It
      // refuses an overdraw outright with InsufficientCreditsError, and a
      // retry of a charge that already committed comes back `applied: false`
      // with the current user. A pre-check would compare the *post-charge*
      // balance against the full price and refuse a hunt the host has already
      // paid for — exactly the state a DO that died between the charge and the
      // phase write leaves behind.
      try {
        const { user: host, applied } = await withKvLock(
          this.env,
          `hunt-start-lock:${hostEmail}`,
          () =>
            // Keyed on the hunt: a hunt is billed once, and a hunt never
            // returns to 'waiting', so this can't swallow a legitimate
            // second charge.
            adjustUserCredits(this.env, hostEmail, -creditsNeeded, {
              idempotencyKey: `hunt-start:${huntId}`,
              transaction: {
                type: 'deduction',
                amount: creditsNeeded,
                timestamp: Date.now(),
                details,
                huntId,
              },
            }),
        );

        // The lock's KV round trips reopen the input gate: an expire_hunt
        // alarm in that window deleted the room out from under a charge that
        // has already landed. Nothing can be un-billed here, but the log is
        // the only trace and the deref below would TypeError.
        if (!this.room) {
          console.error('Hunt expired mid-charge', { huntId, creditsNeeded });
          return;
        }

        // `applied === false` means an earlier attempt already paid for this
        // hunt and this one was the idempotent replay, so record what was
        // actually charged rather than what this attempt would have charged.
        this.room.creditsDeducted = applied ? creditsNeeded : (this.room.creditsDeducted ?? 0);

        // Notify host of deduction — zero when the charge had already landed
        // on an earlier attempt and this one was the idempotent replay
        this.sendTo(ws, {
          type: 'credits_deducted',
          amount: applied ? creditsNeeded : 0,
          remaining: host.credits,
        });
      } catch (err) {
        if (err instanceof KvLockBusyError) {
          this.sendTo(ws, { type: 'error', message: 'Hunt is already starting' });
          return;
        }
        if (err instanceof InsufficientCreditsError) {
          // The generic message below would be true but misleading: nothing
          // was charged and the start was refused for one specific reason
          this.sendTo(ws, {
            type: 'error',
            message: 'Not enough credits to start this hunt',
          });
          return;
        }
        console.error('Credit deduction failed', {
          huntId,
          error: err instanceof Error ? err.message : String(err),
        });
        this.sendTo(ws, { type: 'error', message: 'Failed to start hunt. Please try again.' });
        return;
      }
    }

    // The credit charge above was a round trip through KV
    if (!this.room) return;

    // Initialize progress for all players (including host, who also plays)
    for (const player of this.room.players) {
      const items: Record<string, HuntItemProgress> = {};
      for (const item of this.room.items) {
        items[item.id] = {
          itemId: item.id,
          status: 'searching',
          cluesRevealed: [],
          attemptsUsed: 0,
        };
      }
      this.room.progress[player.id] = {
        playerId: player.id,
        items,
        totalScore: 0,
      };
    }

    this.room.phase = 'starting';
    this.room.startedAt = Date.now();
    this.room.nextAlarmAction = 'start_playing';

    await this.persist();

    logEvent(this.env, 'hunt_started', {
      huntId: this.room.huntId,
      playerCount: this.room.players.length,
      itemCount: this.room.items.length,
      durationMinutes: this.room.config.durationMinutes,
      maxRetries: this.room.config.maxRetries,
      creditsDeducted: this.room.creditsDeducted ?? 0,
      isGroupGame: !!this.room.config.groupId,
    }).catch(() => {});

    this.broadcast({ type: 'hunt_starting', countdown: 3 });

    // Use alarm for the 3-second countdown (durable across hibernation)
    await this.state.storage.setAlarm(Date.now() + 3000);

    if (!this.room) return;

    // Remove from lobby — a DO-to-DO fetch, so the gate reopens again here
    const huntId = this.room.huntId;
    const lobbyId = this.env.GAME_LOBBY.idFromName('global');
    const lobby = this.env.GAME_LOBBY.get(lobbyId);
    await lobby.fetch(
      new Request(`http://internal/games/${huntId}`, { method: 'DELETE' }),
    );

    if (!this.room) return;
    await this.notifyGroupOfUpdate();
  }

  private async startHuntPlaying(): Promise<void> {
    if (!this.room) return;

    this.room.phase = 'playing';
    const now = Date.now();
    this.room.endsAt = now + this.room.config.durationMinutes * 60 * 1000;

    await this.persist();

    this.broadcast({
      type: 'hunt_started',
      items: this.room.items,
      endsAt: this.room.endsAt,
    });

    // Set up alarm chain for hunt timer
    const duration = this.room.config.durationMinutes * 60 * 1000;
    if (duration > 5 * 60 * 1000) {
      // Hunt is longer than 5 minutes — set 5-minute warning
      this.room.nextAlarmAction = 'time_warning_5';
      await this.persist();
      await this.state.storage.setAlarm(this.room.endsAt - 5 * 60 * 1000);
    } else if (duration > 60 * 1000) {
      // Hunt is 1-5 minutes — set 1-minute warning
      this.room.nextAlarmAction = 'time_warning_1';
      await this.persist();
      await this.state.storage.setAlarm(this.room.endsAt - 60 * 1000);
    } else {
      // Very short hunt — just end it
      this.room.nextAlarmAction = 'end_hunt';
      await this.persist();
      await this.state.storage.setAlarm(this.room.endsAt);
    }
  }

  private async handleRevealClue(ws: WebSocket, itemId: string, clueId: string): Promise<void> {
    if (!this.room || this.room.phase !== 'playing') return;

    // The phase stays 'playing' through the end-of-hunt verification grace, so
    // a phase-only guard would keep charging clue points after the player's
    // timer reads 00:00. Same deadline check handleSubmitPhoto makes.
    if (this.room.endsAt && Date.now() > this.room.endsAt) {
      this.sendTo(ws, { type: 'error', message: 'The hunt has ended' });
      return;
    }

    const playerId = this.getPlayerId(ws);
    if (!playerId) return;

    const progress = this.room.progress[playerId];
    if (!progress) return;

    const itemProgress = progress.items[itemId];
    if (!itemProgress) {
      this.sendTo(ws, { type: 'error', message: 'Item not found' });
      return;
    }

    if (itemProgress.status === 'found') {
      this.sendTo(ws, { type: 'error', message: 'Item already found' });
      return;
    }

    if (itemProgress.cluesRevealed.includes(clueId)) {
      this.sendTo(ws, { type: 'error', message: 'Clue already revealed' });
      return;
    }

    const item = this.room.items.find((i) => i.id === itemId);
    if (!item) return;

    const clue = item.clues.find((c) => c.id === clueId);
    if (!clue) {
      this.sendTo(ws, { type: 'error', message: 'Clue not found' });
      return;
    }

    itemProgress.cluesRevealed.push(clueId);
    progress.totalScore -= clue.pointCost;

    await this.persist();

    this.sendTo(ws, {
      type: 'clue_revealed',
      itemId,
      clueId,
      clueText: clue.text,
      newScore: progress.totalScore,
    });

    this.notifyHostOfTeamUpdate();
  }

  private async handleSubmitPhoto(ws: WebSocket, itemId: string, uploadId: string): Promise<void> {
    if (!this.room) return;

    if (this.room.phase !== 'playing' || (this.room.endsAt && Date.now() > this.room.endsAt)) {
      // Tell the player instead of silently dropping — clock skew plus a slow
      // upload makes a just-too-late final submission look like a broken button
      this.sendTo(ws, { type: 'error', message: 'The hunt has ended' });
      return;
    }

    const playerId = this.getPlayerId(ws);
    if (!playerId) return;

    const progress = this.room.progress[playerId];
    if (!progress) return;

    const itemProgress = progress.items[itemId];
    if (!itemProgress) {
      this.sendTo(ws, { type: 'error', message: 'Item not found' });
      return;
    }

    // Resolve the item before mutating any state, so a bad itemId can't
    // strand the progress entry in pending_review
    const item = this.room.items.find((i) => i.id === itemId);
    if (!item) {
      this.sendTo(ws, { type: 'error', message: 'Item not found' });
      return;
    }

    // The client re-sends the same uploadId when an ack goes missing, so a
    // repeat of an already-finished submission replays the original outcome
    // instead of burning a second attempt. Checked before the status ladder:
    // after a win the item is 'found', which would otherwise answer the retry
    // with "Item already found".
    const replay = this.findCompletedUpload(playerId, itemId, uploadId);
    if (replay) {
      this.sendTo(ws, replay);
      return;
    }

    // Same upload, still verifying — re-ack rather than erroring, so the
    // client's retry resolves its pending state
    if (itemProgress.status === 'pending_review' && itemProgress.activeUploadId === uploadId) {
      this.sendTo(ws, { type: 'photo_verifying', itemId });
      return;
    }

    if (itemProgress.status === 'found') {
      this.sendTo(ws, { type: 'error', message: 'Item already found' });
      return;
    }

    if (itemProgress.status === 'pending_review') {
      this.sendTo(ws, { type: 'error', message: 'Verification in progress. Please wait.' });
      return;
    }

    // An item with an appeal in the queue is not settled. Letting a new photo
    // through would let the same item score twice: once here, once again when
    // the host approves the appeal that is still waiting on their dashboard.
    if (this.hasPendingAppeal(playerId, itemId)) {
      this.sendTo(ws, {
        type: 'error',
        message: 'Your appeal for this item is waiting on the host.',
      });
      return;
    }

    if (itemProgress.attemptsUsed >= this.room.config.maxRetries) {
      this.sendTo(ws, { type: 'error', message: 'No attempts remaining' });
      return;
    }

    // Mark as pending review. The token — not the uploadId — is what later
    // identifies this particular verification call: the client re-sends the
    // same uploadId after a dropped ack, so two calls can share one.
    const verifyToken = crypto.randomUUID();
    itemProgress.status = 'pending_review';
    itemProgress.pendingReviewSince = Date.now();
    itemProgress.attemptsUsed++;
    itemProgress.lastRejectedPhotoUrl = undefined;
    itemProgress.activeUploadId = uploadId;
    this.setVerifyToken(playerId, itemId, verifyToken);
    await this.persist();

    this.sendTo(ws, { type: 'photo_verifying', itemId });

    const photoKey = `${this.room.huntId}/${uploadId}`;
    // Whether the object was actually read out of R2 on this attempt. The
    // catch below must not advertise a key for an object that was never
    // stored: the host would get a broken image in the appeal, and approving
    // it writes the dangling key into saved history forever.
    let photoInR2 = false;

    // Verify the photo asynchronously
    try {
      const apiKey = await getAnthropicKey(this.env);

      // Fetch photo from R2
      const photoObj = await this.env.R2_HUNT_PHOTOS.get(photoKey);
      if (!photoObj) {
        itemProgress.status = 'searching';
        itemProgress.pendingReviewSince = undefined;
        itemProgress.attemptsUsed--; // Nothing was verified — refund the attempt
        this.endVerification(itemProgress, playerId, itemId);
        await this.persist();
        this.sendTo(ws, { type: 'error', message: 'Photo not found. Please try again.' });
        return;
      }
      photoInR2 = true;

      const photoBytes = await photoObj.arrayBuffer();
      const contentType = photoObj.httpMetadata?.contentType || 'image/jpeg';

      const { sonnetResult: result, comparison } = await verifyAndCompare(
        apiKey, item.description, photoBytes, contentType,
      );

      // Fire-and-forget: log photo verification + vision comparison events
      logEvent(this.env, 'photo_verified', {
        huntId: this.room.huntId,
        model: VERIFICATION_MODEL,
        accepted: result.accepted,
        confidence: result.confidence,
        latencyMs: comparison.sonnetLatencyMs,
      }).catch(() => {});

      logEvent(this.env, 'vision_comparison', {
        huntId: this.room.huntId,
        sonnetAccepted: result.accepted,
        sonnetConfidence: result.confidence,
        sonnetLatencyMs: comparison.sonnetLatencyMs,
        haikuAccepted: comparison.haikuResult?.accepted ?? null,
        haikuConfidence: comparison.haikuResult?.confidence ?? null,
        haikuLatencyMs: comparison.haikuLatencyMs,
        haikuError: comparison.haikuError ?? null,
        agreement: comparison.agreement,
      }).catch(() => {});

      // Re-read state in case it changed during async call
      if (!this.room) return;
      const currentProgress = this.room.progress[playerId]?.items[itemId];
      if (!currentProgress) return;

      // A stuck-review reset or a newer submission superseded this verification
      // while we were waiting on the API — discard the stale result. Keyed on
      // the per-attempt token, because a resubmission re-sends the same
      // uploadId and would otherwise look like this very call.
      if (this.getVerifyToken(playerId, itemId) !== verifyToken) return;

      // Re-lookup the player's WebSocket — the original `ws` may be stale
      // if the player disconnected and reconnected during async verification
      const currentWs = this.findPlayerWebSocket(playerId) ?? ws;

      if (this.room.phase !== 'playing') {
        currentProgress.status = 'searching';
        currentProgress.pendingReviewSince = undefined;
        this.endVerification(currentProgress, playerId, itemId);
        await this.persist();
        this.sendTo(currentWs, {
          type: 'error',
          message: 'The hunt ended before your photo finished verifying',
        });
        return;
      }

      if (result.accepted) {
        currentProgress.status = 'found';
        currentProgress.pendingReviewSince = undefined;
        this.endVerification(currentProgress, playerId, itemId);
        currentProgress.foundAt = Date.now();
        currentProgress.photoUrl = photoKey;

        // Calculate points: basePoints - hint deductions (already subtracted from totalScore)
        const pointsEarned = item.basePoints;
        this.room.progress[playerId].totalScore += pointsEarned;
        this.clearRefundedFailures(playerId, itemId);

        const accepted: HuntServerMessage = {
          type: 'photo_accepted',
          itemId,
          pointsEarned,
          newScore: this.room.progress[playerId].totalScore,
        };
        this.rememberCompletedUpload(playerId, itemId, uploadId, accepted);

        await this.persist();

        this.sendTo(currentWs, accepted);

        this.notifyHostOfTeamUpdate();
        await this.checkAllTeamsComplete();
      } else {
        const attemptsRemaining = this.room.config.maxRetries - currentProgress.attemptsUsed;

        if (attemptsRemaining <= 0) {
          // Auto-create appeal
          currentProgress.status = 'rejected';
          currentProgress.pendingReviewSince = undefined;
          this.endVerification(currentProgress, playerId, itemId);
          const player = this.room.players.find((p) => p.id === playerId);
          const appeal: HuntAppeal = {
            playerId,
            playerUsername: player?.username || 'Unknown',
            itemId,
            itemDescription: item.description,
            photoUrl: photoKey,
            timestamp: Date.now(),
            isContest: false,
          };
          this.room.pendingAppeals.push(appeal);
          this.clearRefundedFailures(playerId, itemId);

          const submitted: HuntServerMessage = {
            type: 'appeal_submitted',
            itemId,
            attemptsUsed: currentProgress.attemptsUsed,
          };
          this.rememberCompletedUpload(playerId, itemId, uploadId, submitted);

          await this.persist();

          this.sendTo(currentWs, submitted);

          // Notify host
          const hostWs = this.findPlayerWebSocket(this.room.hostId);
          if (hostWs) {
            this.sendTo(hostWs, { type: 'appeal_received', appeal });
          }

          this.notifyHostOfTeamUpdate();
          await this.checkAllTeamsComplete();
        } else {
          currentProgress.status = 'searching';
          currentProgress.pendingReviewSince = undefined;
          this.endVerification(currentProgress, playerId, itemId);
          currentProgress.lastRejectedPhotoUrl = photoKey;
          this.clearRefundedFailures(playerId, itemId);

          const rejected: HuntServerMessage = {
            type: 'photo_rejected',
            itemId,
            reason: result.reason,
            attemptsRemaining,
            attemptsUsed: currentProgress.attemptsUsed,
          };
          this.rememberCompletedUpload(playerId, itemId, uploadId, rejected);

          await this.persist();

          this.sendTo(currentWs, rejected);

          this.notifyHostOfTeamUpdate();
        }
      }
    } catch (err) {
      console.error('Photo verification error', {
        huntId: this.room?.huntId,
        playerId,
        itemId,
        error: err instanceof Error ? err.message : String(err),
      });

      // Everything below belongs to *this* verification attempt, so all of it
      // sits inside the supersession guard. Outside it, the reply carried an
      // attemptsUsed read from whatever submission happened to be current, and
      // a cached failure landed on a newer, still-legitimate one.
      if (!this.room) return;
      const currentProgress = this.room.progress[playerId]?.items[itemId];
      if (
        !currentProgress ||
        currentProgress.status !== 'pending_review' ||
        this.getVerifyToken(playerId, itemId) !== verifyToken
      ) {
        return;
      }

      // Reset status on error so the player can retry
      currentProgress.status = 'searching';
      currentProgress.pendingReviewSince = undefined;
      this.endVerification(currentProgress, playerId, itemId);
      // The photo was never judged, so keep it contestable — otherwise
      // contest_photo answers "No rejected photo to contest" for every
      // server-side failure. Only when it really is in R2, though: a key for
      // an object that was never stored gives the host a broken image and, on
      // approve, a dangling entry in saved history.
      if (photoInR2) {
        currentProgress.lastRejectedPhotoUrl = photoKey;
      }

      // A transient failure shouldn't eat the attempt, but an unconditional
      // refund makes verification free: credits are debited once at start,
      // so a client could loop a failing upload forever at two Sonnet calls
      // plus a Haiku call each. Refund the first few, then start charging.
      const refunded = this.getRefundedFailures(playerId, itemId);
      if (refunded < MAX_REFUNDED_FAILURES_PER_ITEM) {
        currentProgress.attemptsUsed--;
        this.setRefundedFailures(playerId, itemId, refunded + 1);
      }
      await this.persist();

      // Send photo_rejected (not just error) so the frontend clears the
      // verifying state. Deliberately NOT remembered as a completed upload: a
      // transient failure is not a finished submission, and the client's
      // reconnect auto-retry would replay it through findCompletedUpload
      // without ever re-verifying the photo.
      this.sendTo(this.findPlayerWebSocket(playerId) ?? ws, {
        type: 'photo_rejected',
        itemId,
        reason: 'Photo verification failed. Please try again.',
        attemptsRemaining: this.room.config.maxRetries - currentProgress.attemptsUsed,
        attemptsUsed: currentProgress.attemptsUsed,
      });

      await this.fileVerificationFailureAppeal(
        playerId,
        itemId,
        photoInR2 ? photoKey : '',
      );
    }
  }

  /**
   * Hand an item whose attempts ran out on *server-side failures* to the host
   * as an appeal, so it can still be settled by hand.
   *
   * Without it the refund cap creates a state the machine cannot leave. During
   * an API outage the first failures are refunded and the rest consume the
   * attempts; from there submit_photo answers "No attempts remaining",
   * contest_photo refuses on the same counter, and the auto-appeal in the
   * verdict path never ran because no verdict was ever returned. The item
   * stays unsettled, so checkAllTeamsComplete can't end the hunt early either
   * — on a hunt the host has already paid credits for.
   *
   * Same mechanism the real-rejection path uses; the appeal is labelled so the
   * host can see it is a verification failure and not a rejected photo.
   */
  private async fileVerificationFailureAppeal(
    playerId: string,
    itemId: string,
    photoUrl: string,
  ): Promise<void> {
    const room = this.room;
    if (!room || room.phase !== 'playing') return;

    const progress = room.progress[playerId]?.items[itemId];
    if (!progress || progress.status !== 'searching') return;
    // Only once the player genuinely has no way back in
    if (room.config.maxRetries - progress.attemptsUsed > 0) return;
    if (this.hasPendingAppeal(playerId, itemId)) return;

    const item = room.items.find((i) => i.id === itemId);
    if (!item) return;

    const player = room.players.find((p) => p.id === playerId);
    const appeal: HuntAppeal = {
      playerId,
      playerUsername: player?.username || 'Unknown',
      itemId,
      // The host dashboard renders this string, and it is the only channel
      // that can tell them the photo was never actually judged
      itemDescription: `${item.description} — photo verification failed (server error, not a rejection)`,
      photoUrl,
      timestamp: Date.now(),
      isContest: false,
    };

    progress.status = 'rejected';
    room.pendingAppeals.push(appeal);
    this.clearRefundedFailures(playerId, itemId);
    await this.persist();

    const playerWs = this.findPlayerWebSocket(playerId);
    if (playerWs) {
      this.sendTo(playerWs, {
        type: 'appeal_submitted',
        itemId,
        attemptsUsed: progress.attemptsUsed,
      });
    }

    const hostWs = this.findPlayerWebSocket(room.hostId);
    if (hostWs) {
      this.sendTo(hostWs, { type: 'appeal_received', appeal });
    }

    this.notifyHostOfTeamUpdate();
  }

  // --- Submission bookkeeping ---

  private uploadKey(playerId: string, itemId: string, uploadId: string): string {
    return `${playerId}:${itemId}:${uploadId}`;
  }

  /** The outcome already recorded for this exact upload, if any. */
  private findCompletedUpload(
    playerId: string,
    itemId: string,
    uploadId: string,
  ): HuntServerMessage | null {
    if (!this.room) return null;
    const key = this.uploadKey(playerId, itemId, uploadId);
    return this.room.completedUploads.find((e) => e.key === key)?.result ?? null;
  }

  /** Record a finished submission, evicting this player's oldest past the cap. */
  private rememberCompletedUpload(
    playerId: string,
    itemId: string,
    uploadId: string,
    result: HuntServerMessage,
  ): void {
    if (!this.room) return;
    const key = this.uploadKey(playerId, itemId, uploadId);
    const existing = this.room.completedUploads.findIndex((e) => e.key === key);
    if (existing !== -1) this.room.completedUploads.splice(existing, 1);
    this.room.completedUploads.push({ key, result });

    // Evict within this player only. A global FIFO let one busy team push
    // another team's entry out, and the evicted team's reconnect-retry then
    // burned a second attempt on a photo that had already been judged.
    const prefix = `${playerId}:`;
    let overflow =
      this.room.completedUploads.filter((e) => e.key.startsWith(prefix)).length
      - MAX_COMPLETED_UPLOADS_PER_PLAYER;
    if (overflow <= 0) return;
    // Oldest first, so dropping from the front drops the oldest
    this.room.completedUploads = this.room.completedUploads.filter((e) => {
      if (overflow > 0 && e.key.startsWith(prefix)) {
        overflow--;
        return false;
      }
      return true;
    });
  }

  private verifyKey(playerId: string, itemId: string): string {
    return `${playerId}:${itemId}`;
  }

  private setVerifyToken(playerId: string, itemId: string, token: string): void {
    if (!this.room) return;
    this.room.activeVerifications[this.verifyKey(playerId, itemId)] = token;
  }

  private getVerifyToken(playerId: string, itemId: string): string | undefined {
    return this.room?.activeVerifications[this.verifyKey(playerId, itemId)];
  }

  /** Close out an item's in-flight verification: nothing is being awaited for
   *  it any more, and a late result must not be applied. */
  private endVerification(item: HuntItemProgress, playerId: string, itemId: string): void {
    item.activeUploadId = undefined;
    if (this.room) delete this.room.activeVerifications[this.verifyKey(playerId, itemId)];
  }

  private getRefundedFailures(playerId: string, itemId: string): number {
    return this.room?.refundedFailures[playerId]?.[itemId] ?? 0;
  }

  private setRefundedFailures(playerId: string, itemId: string, count: number): void {
    if (!this.room) return;
    const forPlayer = (this.room.refundedFailures[playerId] ??= {});
    forPlayer[itemId] = count;
  }

  /** A verification that actually returned a verdict clears the refund streak. */
  private clearRefundedFailures(playerId: string, itemId: string): void {
    const forPlayer = this.room?.refundedFailures[playerId];
    if (forPlayer) delete forPlayer[itemId];
  }

  private hasPendingAppeal(playerId: string, itemId: string): boolean {
    return !!this.room?.pendingAppeals.some(
      (a) => a.playerId === playerId && a.itemId === itemId,
    );
  }

  private async handleApproveAppeal(ws: WebSocket, playerId: string, itemId: string): Promise<void> {
    if (!this.room) return;

    const hostId = this.getPlayerId(ws);
    if (hostId !== this.room.hostId) {
      this.sendTo(ws, { type: 'error', message: 'Only the host can approve appeals' });
      return;
    }

    const appealIdx = this.room.pendingAppeals.findIndex(
      (a) => a.playerId === playerId && a.itemId === itemId,
    );
    if (appealIdx === -1) {
      this.sendTo(ws, { type: 'error', message: 'Appeal not found' });
      return;
    }

    const appeal = this.room.pendingAppeals[appealIdx];
    const progress = this.room.progress[playerId]?.items[itemId];
    const item = this.room.items.find((i) => i.id === itemId);

    // Every exit below removes the appeal and persists. Splicing ahead of a
    // bare `return` drops it from memory while it survives in storage, where
    // it reappears after eviction and blocks checkAllTeamsComplete forever.
    this.room.pendingAppeals.splice(appealIdx, 1);

    // The player may have resubmitted and already won the item while this
    // appeal sat in the queue — scoring it again would double the points
    if (!progress || !item || progress.status === 'found') {
      await this.persist();
      this.sendTo(ws, { type: 'error', message: 'That item is already resolved' });
      this.notifyHostOfTeamUpdate();
      await this.checkAllTeamsComplete();
      return;
    }

    progress.status = 'found';
    progress.foundAt = Date.now();
    // Without this the photo is missing from history: saveHistory only keeps
    // photos for items that are both 'found' and carry a photoUrl
    progress.photoUrl = appeal.photoUrl;

    const pointsEarned = item.basePoints;
    this.room.progress[playerId].totalScore += pointsEarned;

    await this.persist();

    // Notify the player
    const playerWs = this.findPlayerWebSocket(playerId);
    if (playerWs) {
      this.sendTo(playerWs, {
        type: 'appeal_approved',
        itemId,
        pointsEarned,
        newScore: this.room.progress[playerId].totalScore,
      });
    }

    this.notifyHostOfTeamUpdate();
    await this.checkAllTeamsComplete();
  }

  private async handleRejectAppeal(ws: WebSocket, playerId: string, itemId: string): Promise<void> {
    if (!this.room) return;

    const hostId = this.getPlayerId(ws);
    if (hostId !== this.room.hostId) {
      this.sendTo(ws, { type: 'error', message: 'Only the host can reject appeals' });
      return;
    }

    const appealIdx = this.room.pendingAppeals.findIndex(
      (a) => a.playerId === playerId && a.itemId === itemId,
    );
    if (appealIdx === -1) {
      this.sendTo(ws, { type: 'error', message: 'Appeal not found' });
      return;
    }

    const appeal = this.room.pendingAppeals[appealIdx];

    // If this was a voluntary contest and player has attempts left, return to searching.
    // Never for an item already won on a later submission: flipping it back to
    // 'searching' would leave its points on the total, so buildResults and
    // totalScore would disagree.
    const progress = this.room.progress[playerId]?.items[itemId];
    const returnToSearching = !!(
      appeal.isContest &&
      progress &&
      progress.status !== 'found' &&
      this.room.config.maxRetries - progress.attemptsUsed > 0
    );
    if (returnToSearching && progress) {
      progress.status = 'searching';
    }

    this.room.pendingAppeals.splice(appealIdx, 1);
    await this.persist();

    const playerWs = this.findPlayerWebSocket(playerId);
    if (playerWs) {
      this.sendTo(playerWs, { type: 'appeal_rejected', itemId, returnToSearching });
    }

    this.notifyHostOfTeamUpdate();
    await this.checkAllTeamsComplete();
  }

  private async handleContestPhoto(ws: WebSocket, itemId: string): Promise<void> {
    if (!this.room || this.room.phase !== 'playing') return;

    const playerId = this.getPlayerId(ws);
    if (!playerId) return;

    const progress = this.room.progress[playerId];
    if (!progress) return;

    const itemProgress = progress.items[itemId];
    if (!itemProgress) {
      this.sendTo(ws, { type: 'error', message: 'Item not found' });
      return;
    }

    if (itemProgress.status !== 'searching') {
      this.sendTo(ws, { type: 'error', message: 'Nothing to contest' });
      return;
    }

    const photoUrl = itemProgress.lastRejectedPhotoUrl;
    if (!photoUrl) {
      this.sendTo(ws, { type: 'error', message: 'No rejected photo to contest' });
      return;
    }

    const attemptsRemaining = this.room.config.maxRetries - itemProgress.attemptsUsed;
    if (attemptsRemaining <= 0) {
      this.sendTo(ws, { type: 'error', message: 'No attempts remaining' });
      return;
    }

    const item = this.room.items.find((i) => i.id === itemId);
    if (!item) return;

    const player = this.room.players.find((p) => p.id === playerId);

    const appeal: HuntAppeal = {
      playerId,
      playerUsername: player?.username || 'Unknown',
      itemId,
      itemDescription: item.description,
      photoUrl,
      timestamp: Date.now(),
      isContest: true,
    };

    itemProgress.status = 'rejected';
    this.room.pendingAppeals.push(appeal);
    await this.persist();

    this.sendTo(ws, { type: 'appeal_submitted', itemId, attemptsUsed: itemProgress.attemptsUsed });

    const hostWs = this.findPlayerWebSocket(this.room.hostId);
    if (hostWs) {
      this.sendTo(hostWs, { type: 'appeal_received', appeal });
    }

    this.notifyHostOfTeamUpdate();
  }

  private async handleClaimHost(ws: WebSocket): Promise<void> {
    if (!this.room) return;

    const playerId = this.getPlayerId(ws);
    if (!playerId) return;

    if (this.room.phase !== 'waiting' && this.room.phase !== 'playing') {
      this.sendTo(ws, { type: 'error', message: 'Cannot claim host right now' });
      return;
    }

    if (!this.room.players.some((p) => p.id === playerId)) {
      this.sendTo(ws, { type: 'error', message: 'Player not in hunt' });
      return;
    }

    if (this.room.hostId === playerId) {
      this.sendTo(ws, { type: 'error', message: 'You are already the host' });
      return;
    }

    // Only allow claim if current host is disconnected
    const currentHostWs = this.findPlayerWebSocket(this.room.hostId);
    if (currentHostWs) {
      this.sendTo(ws, { type: 'error', message: 'Current host is still connected' });
      return;
    }

    this.room.hostId = playerId;
    await this.persist();
    this.broadcast({ type: 'host_changed', hostId: playerId });

    // A mid-hunt host needs the pending appeals pushed to them
    if (this.room.phase === 'playing') {
      for (const appeal of this.room.pendingAppeals) {
        this.sendTo(ws, { type: 'appeal_received', appeal });
      }
    }
  }

  private async handleSendMessage(ws: WebSocket, message: string, targetPlayerId?: string): Promise<void> {
    if (!this.room) return;

    const senderId = this.getPlayerId(ws);
    if (senderId !== this.room.hostId) {
      this.sendTo(ws, { type: 'error', message: 'Only the host can send messages' });
      return;
    }

    if (this.room.phase !== 'playing') {
      this.sendTo(ws, { type: 'error', message: 'Can only send messages during the hunt' });
      return;
    }

    const msg = { type: 'host_message' as const, message };

    if (targetPlayerId) {
      const targetWs = this.findPlayerWebSocket(targetPlayerId);
      if (targetWs) {
        this.sendTo(targetWs, msg);
      }
    } else {
      // Send to all non-host players
      for (const player of this.room.players) {
        if (player.id === this.room.hostId) continue;
        const playerWs = this.findPlayerWebSocket(player.id);
        if (playerWs) {
          this.sendTo(playerWs, msg);
        }
      }
    }
  }

  private async checkAllTeamsComplete(): Promise<void> {
    if (!this.room || this.room.phase !== 'playing') return;

    if (this.room.players.length === 0) return;

    // Don't finish the hunt while there are pending appeals — the host
    // still needs to approve or reject them, which may change item status
    if (this.room.pendingAppeals.length > 0) return;

    const allDone = this.room.players.every((player) => {
      const progress = this.room!.progress[player.id];
      if (!progress) return false;
      return this.room!.items.every((item) => {
        const ip = progress.items[item.id];
        return ip && (ip.status === 'found' || ip.status === 'rejected');
      });
    });

    if (allDone) {
      await this.finishHunt();
    }
  }

  // --- Alarm actions ---

  private async resetStuckPendingReviews(now: number): Promise<void> {
    if (!this.room || this.room.phase !== 'playing') return;

    const STUCK_THRESHOLD_MS = 60_000;
    let anyReset = false;
    const exhausted: Array<{ playerId: string; itemId: string; photoUrl: string }> = [];

    for (const player of this.room.players) {
      const progress = this.room.progress[player.id];
      if (!progress) continue;

      for (const [itemId, item] of Object.entries(progress.items)) {
        if (
          item.status === 'pending_review' &&
          item.pendingReviewSince &&
          now - item.pendingReviewSince > STUCK_THRESHOLD_MS
        ) {
          // The photo is still in R2 and was never judged — keep it
          // contestable, or contest_photo answers "No rejected photo to
          // contest" for every timed-out review
          if (item.activeUploadId) {
            item.lastRejectedPhotoUrl = `${this.room.huntId}/${item.activeUploadId}`;
          }
          item.status = 'searching';
          item.pendingReviewSince = undefined;
          this.endVerification(item, player.id, itemId);

          // Under the same cap the throwing path is under. Refunding here
          // unconditionally reopened the cost-abuse vector through slow or
          // hanging verifications instead of fast-failing ones, and left two
          // players hitting one degraded API with opposite outcomes depending
          // on whether their call threw or timed out.
          const refunded = this.getRefundedFailures(player.id, itemId);
          if (refunded < MAX_REFUNDED_FAILURES_PER_ITEM) {
            item.attemptsUsed = Math.max(0, item.attemptsUsed - 1);
            this.setRefundedFailures(player.id, itemId, refunded + 1);
          }
          anyReset = true;

          const ws = this.findPlayerWebSocket(player.id);
          if (ws) {
            this.sendTo(ws, {
              type: 'photo_rejected',
              itemId,
              reason: 'Verification timed out. Please try again.',
              attemptsRemaining: this.room.config.maxRetries - item.attemptsUsed,
              attemptsUsed: item.attemptsUsed,
            });
          }

          // Same escape hatch the throwing path gets — capping the refund
          // without one just moves the terminal state to timeouts
          if (this.room.config.maxRetries - item.attemptsUsed <= 0) {
            exhausted.push({
              playerId: player.id,
              itemId,
              photoUrl: item.lastRejectedPhotoUrl ?? '',
            });
          }
        }
      }
    }

    if (anyReset) {
      await this.persist();
    }

    // Filed after the walk: each one persists and mutates pendingAppeals
    for (const entry of exhausted) {
      await this.fileVerificationFailureAppeal(entry.playerId, entry.itemId, entry.photoUrl);
    }
  }

  private async finishHunt(): Promise<void> {
    if (!this.room || this.room.phase === 'finished') return;

    // Grace period: a photo submitted before the deadline may still be mid-
    // verification. Defer the finish briefly so the result counts instead of
    // being discarded; the 60s cap matches the stuck-review threshold.
    if (this.room.endsAt && Date.now() < this.room.endsAt + 60_000) {
      const anyPendingReview = Object.values(this.room.progress).some((progress) =>
        Object.values(progress.items).some((item) => item.status === 'pending_review'),
      );
      if (anyPendingReview) {
        this.room.nextAlarmAction = 'end_hunt';
        await this.persist();
        await this.state.storage.setAlarm(Date.now() + 10_000);
        return;
      }
    }

    this.room.phase = 'finished';
    this.room.nextAlarmAction = 'cleanup_hunt';

    // Anything still unverified at this point is abandoned — clear the status
    // so clients don't render a permanent "Verifying..." badge
    for (const progress of Object.values(this.room.progress)) {
      for (const item of Object.values(progress.items)) {
        if (item.status === 'pending_review') {
          item.status = 'searching';
          item.pendingReviewSince = undefined;
          this.endVerification(item, progress.playerId, item.itemId);
        }
      }
    }

    // Clear any pending appeals since the hunt is over — but tell the
    // affected players their appeal was never reviewed
    for (const appeal of this.room.pendingAppeals) {
      const appealWs = this.findPlayerWebSocket(appeal.playerId);
      if (appealWs) {
        this.sendTo(appealWs, {
          type: 'error',
          message: `The hunt ended before the host reviewed your appeal for "${appeal.itemDescription}"`,
        });
      }
    }
    this.room.pendingAppeals = [];

    const results = this.buildResults();

    // Commit the finished state and its cleanup alarm together, before any
    // non-storage await reopens the input gate. Previously nextAlarmAction was
    // set to 'cleanup_hunt' with the matching setAlarm 50 lines later, behind a
    // KV write — an alarm delivered in that window ran cleanupHunt(), nulled
    // this.room, and the hunt_finished broadcast never fired.
    await this.persist();
    await this.state.storage.setAlarm(Date.now() + HUNT_EXPIRY_MS);

    // Tell everyone the hunt is over before the KV write below can yield
    this.broadcast({ type: 'hunt_finished', results });

    logEvent(this.env, 'hunt_finished', {
      huntId: this.room.huntId,
      playerCount: this.room.players.length,
      itemCount: this.room.items.length,
      durationMs: Date.now() - (this.room.startedAt ?? this.room.createdAt),
      rankings: results.rankings.map((r) => ({
        username: r.player.username,
        score: r.score,
        itemsFound: r.itemsFound,
      })),
      isGroupGame: !!this.room.config.groupId,
    }).catch(() => {});

    await this.saveHistory(results);
    // saveHistory writes to KV, so a cleanup alarm may have run meanwhile
    if (!this.room) return;

    // "Save photos" off used to mean "don't index them in history" while every
    // photo stayed in R2 forever — cleanupR2Photos' only caller bails unless
    // the hunt is still 'waiting'. Nothing references them once the hunt is
    // over, so delete them for real.
    if (!this.room.config.savePhotos) {
      await this.cleanupR2Photos();
      if (!this.room) return;
    }

    await this.notifyGroupOfUpdate();
  }

  private buildResults(): HuntResults {
    if (!this.room) {
      return { rankings: [], itemBreakdown: {} };
    }

    const rankings = this.room.players
      .map((player) => {
        const progress = this.room!.progress[player.id];
        const itemsFound = progress
          ? Object.values(progress.items).filter((i) => i.status === 'found').length
          : 0;
        return {
          player: { ...player, score: progress?.totalScore || 0 },
          score: progress?.totalScore || 0,
          itemsFound,
          totalItems: this.room!.items.length,
        };
      })
      .sort((a, b) => b.score - a.score);

    const itemBreakdown: Record<string, HuntResultsItemDetail[]> = {};

    for (const player of this.room.players) {
      const progress = this.room.progress[player.id];
      if (!progress) continue;

      itemBreakdown[player.id] = this.room.items.map((item) => {
        const itemProg = progress.items[item.id];
        const cluesUsed = itemProg?.cluesRevealed.length || 0;
        // Use actual per-clue costs instead of flat config cost for accuracy
        const hintDeductions = itemProg?.cluesRevealed.reduce((sum, clueId) => {
          const clue = item.clues.find((c) => c.id === clueId);
          return sum + (clue?.pointCost ?? this.room!.config.hintPointCost);
        }, 0) ?? 0;
        const found = itemProg?.status === 'found';
        const pointsEarned = found ? item.basePoints - hintDeductions : -hintDeductions;

        return {
          itemId: item.id,
          description: item.description,
          found,
          pointsEarned,
          cluesUsed,
          attempts: itemProg?.attemptsUsed || 0,
        };
      });
    }

    return { rankings, itemBreakdown };
  }

  private async expireHunt(): Promise<void> {
    if (!this.room) return;

    if (this.room.phase !== 'waiting') return;

    this.broadcast({ type: 'hunt_expired', message: 'Hunt expired due to inactivity' });

    const sockets = this.state.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.close(1000, 'Hunt expired');
      } catch {
        // Already closed
      }
    }

    // Clean up any uploaded R2 photos
    await this.cleanupR2Photos();

    // Remove from lobby
    const lobbyId = this.env.GAME_LOBBY.idFromName('global');
    const lobby = this.env.GAME_LOBBY.get(lobbyId);
    await lobby.fetch(
      new Request(`http://internal/games/${this.room.huntId}`, { method: 'DELETE' }),
    );

    if (this.room.config.groupId) {
      const groupDoId = this.env.PRIVATE_GROUP.idFromName(this.room.config.groupId);
      const group = this.env.PRIVATE_GROUP.get(groupDoId);
      await group.fetch(
        new Request(`http://internal/games/${this.room.huntId}`, { method: 'DELETE' }),
      );
    }

    this.room = null;
    await this.state.storage.deleteAll();
  }

  private async cleanupHunt(): Promise<void> {
    if (!this.room) return;

    // Photos are preserved for hunt history (only deleted on explicit host deletion)

    // Remove from lobby and group
    const lobbyId = this.env.GAME_LOBBY.idFromName('global');
    const lobby = this.env.GAME_LOBBY.get(lobbyId);
    await lobby.fetch(
      new Request(`http://internal/games/${this.room.huntId}`, { method: 'DELETE' }),
    );

    if (this.room.config.groupId) {
      const groupDoId = this.env.PRIVATE_GROUP.idFromName(this.room.config.groupId);
      const group = this.env.PRIVATE_GROUP.get(groupDoId);
      await group.fetch(
        new Request(`http://internal/games/${this.room.huntId}`, { method: 'DELETE' }),
      );
    }

    this.room = null;
    await this.state.storage.deleteAll();
  }

  // --- Helpers ---

  private async cleanupR2Photos(): Promise<void> {
    if (!this.room) return;
    try {
      let cursor: string | undefined;
      do {
        const listResult = await this.env.R2_HUNT_PHOTOS.list({
          prefix: `${this.room.huntId}/`,
          ...(cursor ? { cursor } : {}),
        });
        for (const obj of listResult.objects) {
          await this.env.R2_HUNT_PHOTOS.delete(obj.key);
        }
        cursor = listResult.truncated ? listResult.cursor : undefined;
      } while (cursor);
    } catch (err) {
      console.error('R2 cleanup error', {
        huntId: this.room.huntId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async saveHistory(results: HuntResults): Promise<void> {
    if (!this.room) return;

    const hostPlayer = this.room.players.find((p) => p.id === this.room!.hostId);
    if (!this.room.hostSecret) {
      this.room.hostSecret = crypto.randomUUID();
      // Bind the secret to whoever holds host *now*. hostId drifts afterwards
      // — an explicit Leave on the results screen transfers it — and the
      // re-issue on rejoin must not follow it to a participant.
      this.room.hostSecretOwnerId = this.room.hostId;
    }
    const hostSecret = this.room.hostSecret;

    // Collect photo R2 keys for found items (only if savePhotos is enabled)
    const photoKeys: Record<string, Record<string, string>> = {};
    if (this.room.config.savePhotos) {
      for (const player of this.room.players) {
        const progress = this.room.progress[player.id];
        if (!progress) continue;
        const playerPhotos: Record<string, string> = {};
        for (const [itemId, itemProgress] of Object.entries(progress.items)) {
          if (itemProgress.status === 'found' && itemProgress.photoUrl) {
            playerPhotos[itemId] = itemProgress.photoUrl;
          }
        }
        if (Object.keys(playerPhotos).length > 0) {
          photoKeys[player.id] = playerPhotos;
        }
      }
    }

    const entry: HuntHistoryEntry = {
      huntId: this.room.huntId,
      config: {
        name: this.room.config.name,
        items: this.room.config.items,
        durationMinutes: this.room.config.durationMinutes,
        maxRetries: this.room.config.maxRetries,
        basePointsPerItem: this.room.config.basePointsPerItem,
        hintPointCost: this.room.config.hintPointCost,
        minPlayers: this.room.config.minPlayers,
        maxPlayers: this.room.config.maxPlayers,
        savePhotos: this.room.config.savePhotos,
      },
      hostUsername: hostPlayer?.username || 'Unknown',
      hostSecret,
      players: this.room.players
        .map((p) => ({ id: p.id, username: p.username, avatar: p.avatar })),
      results,
      photoKeys,
      createdAt: this.room.createdAt,
      startedAt: this.room.startedAt || this.room.createdAt,
      finishedAt: Date.now(),
      groupId: this.room.config.groupId,
    };

    const winner = results.rankings[0];
    const metadata: HuntHistorySummary = {
      huntId: entry.huntId,
      name: entry.config.name,
      hostUsername: entry.hostUsername,
      teamCount: entry.players.length,
      winnerUsername: winner?.player.username || 'N/A',
      winnerScore: winner?.score || 0,
      totalItems: entry.config.items.length,
      finishedAt: entry.finishedAt,
      groupId: this.room.config.groupId,
    };

    // Read these out before the KV write: a cleanup alarm delivered while it
    // is in flight nulls this.room, and everything below used to deref it
    const huntId = this.room.huntId;
    const secretOwnerId = this.room.hostSecretOwnerId ?? this.room.hostId;

    try {
      await this.env.TRIVIA_KV.put(
        `hunt-history:${huntId}`,
        JSON.stringify(entry),
        { expirationTtl: 90 * 24 * 60 * 60, metadata },
      );

      if (!this.room) return;

      // Persist the secret so a host who is offline right now can still be
      // re-issued it when they reconnect (see handleRejoin)
      await this.persist();

      // Send host secret to host for deletion auth
      const hostWs = this.findPlayerWebSocket(secretOwnerId);
      if (hostWs) {
        this.sendTo(hostWs, {
          type: 'hunt_history_saved',
          huntId,
          hostSecret,
        });
      }
    } catch (err) {
      console.error('Failed to save hunt history', {
        huntId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleUpdateConfig(ws: WebSocket, newConfig: Record<string, unknown>): Promise<void> {
    if (!this.room) return;

    if (this.room.phase !== 'waiting') {
      this.sendTo(ws, { type: 'error', message: 'Can only update settings before the hunt starts' });
      return;
    }

    const playerId = this.getPlayerId(ws);
    if (playerId !== this.room.hostId) {
      this.sendTo(ws, { type: 'error', message: 'Only the host can update settings' });
      return;
    }

    const parsed = HuntConfigSchema.safeParse(newConfig);
    if (!parsed.success) {
      this.sendTo(ws, { type: 'error', message: 'Invalid hunt settings' });
      return;
    }

    if (this.room.players.length > parsed.data.maxPlayers) {
      this.sendTo(ws, {
        type: 'error',
        message: `Cannot set max players below current player count (${this.room.players.length})`,
      });
      return;
    }

    // Preserve groupId from original config (not editable)
    const updatedConfig: HuntConfig = {
      ...parsed.data,
      groupId: this.room.config.groupId,
    };

    this.room.config = updatedConfig;
    this.room.items = updatedConfig.items;
    await this.persist();

    // Broadcast full hunt state so all players see updated config
    const sockets = this.state.getWebSockets();
    for (const s of sockets) {
      const pid = this.getPlayerId(s);
      if (pid) {
        this.sendTo(s, { type: 'hunt_state', state: this.getClientHuntState(pid) });
      }
    }

    await this.notifyGroupOfUpdate();
  }

  private async notifyGroupOfUpdate(): Promise<void> {
    if (!this.room?.config.groupId) return;
    try {
      const groupDoId = this.env.PRIVATE_GROUP.idFromName(this.room.config.groupId);
      const group = this.env.PRIVATE_GROUP.get(groupDoId);
      await group.fetch(
        new Request(`http://internal/games/${this.room.huntId}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: this.room.config.name,
            playerCount: this.room.players.length,
            phase: this.room.phase,
            hostUsername: this.room.players.find((p) => p.id === this.room!.hostId)?.username || '',
          }),
        }),
      );
    } catch (err) {
      console.error('Group notification failed', {
        huntId: this.room.huntId,
        groupId: this.room.config.groupId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private getPlayerId(ws: WebSocket): string | null {
    const attachment = ws.deserializeAttachment() as string | { pendingEmail: string } | null;
    return typeof attachment === 'string' ? attachment : null;
  }

  private getPendingEmail(ws: WebSocket): string | null {
    const attachment = ws.deserializeAttachment() as string | { pendingEmail: string } | null;
    return attachment && typeof attachment === 'object' ? attachment.pendingEmail : null;
  }

  /**
   * Close any other sockets attached to this player so async verification
   * results can't be delivered to a dead connection from before a reconnect.
   */
  private closeStaleSockets(playerId: string, currentWs: WebSocket): void {
    for (const other of this.state.getWebSockets()) {
      if (other === currentWs || this.getPlayerId(other) !== playerId) continue;
      try {
        other.close(1000, 'Replaced by a new connection');
      } catch {
        // Already closed
      }
    }
  }

  private findPlayerWebSocket(playerId: string): WebSocket | null {
    const sockets = this.state.getWebSockets();
    for (const ws of sockets) {
      if (this.getPlayerId(ws) === playerId) return ws;
    }
    return null;
  }

  private pickAvatar(): Avatar {
    const usedNames = new Set(this.room!.players.map((p) => p.avatar.name));
    const available = AVATARS.filter((a) => !usedNames.has(a.name));
    const pool = available.length > 0 ? available : AVATARS;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private getClientHuntState(playerId: string): ClientHuntState {
    const r = this.room!;
    const myProgress = r.progress[playerId] || {
      playerId,
      items: {},
      totalScore: 0,
    };

    const timeRemaining = r.endsAt
      ? Math.max(0, Math.floor((r.endsAt - Date.now()) / 1000))
      : r.config.durationMinutes * 60;

    const isHost = playerId === r.hostId;

    return {
      id: r.huntId,
      config: r.config,
      phase: r.phase,
      hostId: r.hostId,
      players: r.players,
      myProgress,
      timeRemaining,
      createdAt: r.createdAt,
      startedAt: r.startedAt,
      endsAt: r.endsAt,
      ...(isHost && (r.phase === 'playing' || r.phase === 'finished')
        ? { allTeams: this.buildTeamSummaries() }
        : {}),
    };
  }

  private buildTeamSummaries(): HuntTeamSummary[] {
    if (!this.room) return [];
    return this.room.players
      .map((player) => {
        const progress = this.room!.progress[player.id];
        const itemEntries = progress ? Object.values(progress.items) : [];
        const itemStatuses: Record<string, HuntItemStatus> = {};
        let totalAttempts = 0;
        for (const ip of itemEntries) {
          itemStatuses[ip.itemId] = ip.status;
          totalAttempts += ip.attemptsUsed;
        }
        return {
          playerId: player.id,
          username: player.username,
          avatar: player.avatar,
          totalScore: progress?.totalScore ?? 0,
          itemsFound: itemEntries.filter((i) => i.status === 'found').length,
          totalItems: this.room!.items.length,
          itemStatuses,
          totalAttempts,
        };
      })
      .sort((a, b) => b.totalScore - a.totalScore);
  }

  private notifyHostOfTeamUpdate(): void {
    if (!this.room || this.room.phase !== 'playing') return;
    const hostWs = this.findPlayerWebSocket(this.room.hostId);
    if (!hostWs) return;
    this.sendTo(hostWs, { type: 'teams_updated', teams: this.buildTeamSummaries() });
  }

  private sendTo(ws: WebSocket, message: HuntServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Dead connection
    }
  }

  private broadcast(message: HuntServerMessage): void {
    const json = JSON.stringify(message);
    const sockets = this.state.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.send(json);
      } catch {
        // Dead connection
      }
    }
  }

  private broadcastExcept(excludeWs: WebSocket, message: HuntServerMessage): void {
    const json = JSON.stringify(message);
    const sockets = this.state.getWebSockets();
    for (const ws of sockets) {
      if (ws === excludeWs) continue;
      try {
        ws.send(json);
      } catch {
        // Dead connection
      }
    }
  }

  private async persist(): Promise<void> {
    await this.state.storage.put('room', this.room);
  }
}
