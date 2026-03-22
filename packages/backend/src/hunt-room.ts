import type {
  Player, GamePhase, Avatar, HuntConfig, HuntItem, HuntItemProgress,
  HuntPlayerProgress, HuntAppeal, HuntResults, HuntResultsItemDetail,
  ClientHuntState, HuntTeamSummary, HuntItemStatus, HuntHistoryEntry,
  HuntHistorySummary,
} from '@lamo-trivia/shared';
import { HuntClientMessageSchema, HuntConfigSchema, AVATARS, HUNT_EXPIRY_MS } from '@lamo-trivia/shared';
import { getAnthropicKey } from './env';
import type { Env } from './env';
import { verifyAndCompare } from './vision';
import { logEvent } from './analytics';
import { getUser, updateUser, addCreditTransaction } from './auth';

type AlarmAction =
  | 'expire_hunt'
  | 'start_playing'
  | 'time_warning_5'
  | 'time_warning_1'
  | 'end_hunt'
  | 'cleanup_hunt';

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
}

// Per-connection message rate limiting
const WS_RATE_WINDOW_MS = 10_000;
const WS_RATE_MAX_MESSAGES = 30;

export class ScavengerHuntRoom {
  private state: DurableObjectState;
  private env: Env;
  private room: HuntRoomState | null = null;
  private wsRates = new Map<WebSocket, { count: number; start: number }>();
  private wsEmails = new Map<WebSocket, string>();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<HuntRoomState>('room');
      if (stored) this.room = stored;
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
        const email = request.headers.get('X-User-Email');
        if (email) {
          this.wsEmails.set(server, email);
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
      // Fallback: end hunt if alarm chain failed and endsAt has passed
      if (this.room.endsAt && now > this.room.endsAt) {
        await this.finishHunt();
        return;
      }
      // Auto-reset items stuck in pending_review for >60s (API failure or DO restart)
      await this.resetStuckPendingReviews(now);
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
          await this.handleJoin(ws, parsed.data.username);
          break;
        case 'rejoin_hunt':
          await this.handleRejoin(ws, parsed.data.username);
          break;
        case 'leave_hunt':
          await this.handleLeave(ws);
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

  private async handleJoin(ws: WebSocket, username: string): Promise<void> {
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
        await this.handleRejoin(ws, username);
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
      ws.serializeAttachment(existingPlayer.id);
      this.sendTo(ws, { type: 'hunt_state', state: this.getClientHuntState(existingPlayer.id) });
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

    ws.serializeAttachment(playerId);

    this.room.players.push(player);

    // Assign host: prefer the creator (matched by email), otherwise first joiner
    const wsEmail = this.wsEmails.get(ws);
    if (this.room.hostEmail && wsEmail && wsEmail === this.room.hostEmail) {
      this.room.hostId = playerId;
      if (this.room.players.length > 1) {
        this.broadcast({ type: 'host_changed', hostId: playerId });
      }
    } else if (this.room.hostId === '') {
      this.room.hostId = playerId;
    }

    // Clean up email mapping — no longer needed
    this.wsEmails.delete(ws);

    await this.persist();

    this.sendTo(ws, { type: 'hunt_state', state: this.getClientHuntState(playerId) });
    this.broadcastExcept(ws, { type: 'player_joined', player });
    await this.notifyGroupOfUpdate();
  }

  private async handleRejoin(ws: WebSocket, username: string): Promise<void> {
    if (!this.room) {
      this.sendTo(ws, { type: 'error', message: 'Hunt not found', code: 'HUNT_NOT_FOUND' });
      return;
    }

    // Find existing player by username (case insensitive)
    const existingPlayer = this.room.players.find(
      (p) => p.username.toLowerCase() === username.toLowerCase(),
    );

    if (!existingPlayer) {
      // If hunt is still in waiting phase, redirect to normal join
      if (this.room.phase === 'waiting') {
        await this.handleJoin(ws, username);
      } else {
        this.sendTo(ws, { type: 'error', message: 'Player not found in this hunt', code: 'PLAYER_NOT_FOUND' });
      }
      return;
    }

    // Re-attach WebSocket to this player
    ws.serializeAttachment(existingPlayer.id);

    // Send current state — includes their progress
    this.sendTo(ws, { type: 'hunt_state', state: this.getClientHuntState(existingPlayer.id) });

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
    }

    // Send any pending appeals to host
    if (existingPlayer.id === this.room.hostId && this.room.pendingAppeals.length > 0) {
      for (const appeal of this.room.pendingAppeals) {
        this.sendTo(ws, { type: 'appeal_received', appeal });
      }
    }
  }

  private async handleLeave(ws: WebSocket): Promise<void> {
    if (!this.room) return;

    const playerId = this.getPlayerId(ws);
    if (!playerId) return;

    // During playing/finished, don't remove the player — just detach the WebSocket
    // so they can rejoin and see their progress/results
    if (this.room.phase === 'playing' || this.room.phase === 'finished') {
      // Transfer host if needed
      const wasHost = this.room.hostId === playerId;
      if (wasHost) {
        const connectedPlayers = this.room.players.filter((p) => {
          if (p.id === playerId) return false;
          return this.findPlayerWebSocket(p.id) !== null;
        });
        if (connectedPlayers.length > 0) {
          this.room.hostId = connectedPlayers[0].id;
          await this.persist();
          this.broadcast({ type: 'host_changed', hostId: this.room.hostId });
        }
      }
      return;
    }

    // During waiting/starting, fully remove the player
    const wasHost = this.room.hostId === playerId;

    this.room.players = this.room.players.filter((p) => p.id !== playerId);
    delete this.room.progress[playerId];

    let newHostId: string | undefined;
    if (wasHost && this.room.players.length > 0) {
      this.room.hostId = this.room.players[0].id;
      newHostId = this.room.hostId;
    }

    await this.persist();
    this.broadcast({ type: 'player_left', playerId, ...(newHostId ? { newHostId } : {}) });
    await this.notifyGroupOfUpdate();
  }

  private async handleStartHunt(ws: WebSocket): Promise<void> {
    if (!this.room) return;

    const playerId = this.getPlayerId(ws);
    if (playerId !== this.room.hostId) {
      this.sendTo(ws, { type: 'error', message: 'Only the host can start the hunt' });
      return;
    }

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

      // Use a KV lock key to prevent concurrent deductions for this hunt
      const lockKey = `credit-lock:${this.room.huntId}`;
      const lockExists = await this.env.TRIVIA_KV.get(lockKey);
      if (lockExists) {
        this.sendTo(ws, { type: 'error', message: 'Hunt is already starting' });
        return;
      }
      await this.env.TRIVIA_KV.put(lockKey, '1', { expirationTtl: 60 });

      const host = await getUser(this.room.hostEmail, this.env);
      if (!host || host.credits < creditsNeeded) {
        await this.env.TRIVIA_KV.delete(lockKey);
        this.sendTo(ws, {
          type: 'error',
          message: 'Not enough credits to start this hunt',
        });
        return;
      }

      host.credits -= creditsNeeded;
      await updateUser(host, this.env);

      await addCreditTransaction(host.userId, {
        type: 'deduction',
        amount: creditsNeeded,
        timestamp: Date.now(),
        details: `Hunt "${this.room.config.name}" — ${this.room.items.length} items × ${this.room.config.maxRetries} retries × ${participantCount} teams`,
        huntId: this.room.huntId,
      }, this.env);

      this.room.creditsDeducted = creditsNeeded;

      // Notify host of deduction
      this.sendTo(ws, {
        type: 'credits_deducted',
        amount: creditsNeeded,
        remaining: host.credits,
      });
    }

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

    // Remove from lobby
    const lobbyId = this.env.GAME_LOBBY.idFromName('global');
    const lobby = this.env.GAME_LOBBY.get(lobbyId);
    await lobby.fetch(
      new Request(`http://internal/games/${this.room.huntId}`, { method: 'DELETE' }),
    );

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

    if (itemProgress.status === 'found') {
      this.sendTo(ws, { type: 'error', message: 'Item already found' });
      return;
    }

    if (itemProgress.attemptsUsed >= this.room.config.maxRetries) {
      this.sendTo(ws, { type: 'error', message: 'No attempts remaining' });
      return;
    }

    // Mark as pending review
    itemProgress.status = 'pending_review';
    itemProgress.pendingReviewSince = Date.now();
    itemProgress.attemptsUsed++;
    itemProgress.lastRejectedPhotoUrl = undefined;
    await this.persist();

    this.sendTo(ws, { type: 'photo_verifying', itemId });

    // Verify the photo asynchronously
    try {
      const apiKey = await getAnthropicKey(this.env);
      const item = this.room.items.find((i) => i.id === itemId);
      if (!item) return;

      // Fetch photo from R2
      const photoKey = `${this.room.huntId}/${uploadId}`;
      const photoObj = await this.env.R2_HUNT_PHOTOS.get(photoKey);
      if (!photoObj) {
        itemProgress.status = 'searching';
        itemProgress.pendingReviewSince = undefined;
        await this.persist();
        this.sendTo(ws, { type: 'error', message: 'Photo not found. Please try again.' });
        return;
      }

      const photoBytes = await photoObj.arrayBuffer();
      const contentType = photoObj.httpMetadata?.contentType || 'image/jpeg';

      const { sonnetResult: result, comparison } = await verifyAndCompare(
        apiKey, item.description, photoBytes, contentType,
      );

      // Fire-and-forget: log photo verification + vision comparison events
      logEvent(this.env, 'photo_verified', {
        huntId: this.room.huntId,
        model: 'claude-sonnet-4-20250514',
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

      if (result.accepted) {
        currentProgress.status = 'found';
        currentProgress.pendingReviewSince = undefined;
        currentProgress.foundAt = Date.now();
        currentProgress.photoUrl = photoKey;

        // Calculate points: basePoints - hint deductions (already subtracted from totalScore)
        const pointsEarned = item.basePoints;
        this.room.progress[playerId].totalScore += pointsEarned;

        await this.persist();

        this.sendTo(ws, {
          type: 'photo_accepted',
          itemId,
          pointsEarned,
          newScore: this.room.progress[playerId].totalScore,
        });

        this.notifyHostOfTeamUpdate();
        await this.checkAllTeamsComplete();
      } else {
        const attemptsRemaining = this.room.config.maxRetries - currentProgress.attemptsUsed;

        if (attemptsRemaining <= 0) {
          // Auto-create appeal
          currentProgress.status = 'rejected';
          currentProgress.pendingReviewSince = undefined;
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
          await this.persist();

          this.sendTo(ws, { type: 'appeal_submitted', itemId });

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
          currentProgress.lastRejectedPhotoUrl = photoKey;
          await this.persist();

          this.sendTo(ws, {
            type: 'photo_rejected',
            itemId,
            reason: result.reason,
            attemptsRemaining,
          });

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

      // Reset status on error so player can retry
      if (this.room) {
        const currentProgress = this.room.progress[playerId]?.items[itemId];
        if (currentProgress && currentProgress.status === 'pending_review') {
          currentProgress.status = 'searching';
          currentProgress.pendingReviewSince = undefined;
          currentProgress.attemptsUsed--; // Don't count failed verification as an attempt
          await this.persist();
        }
      }

      this.sendTo(ws, { type: 'error', message: 'Photo verification failed. Please try again.' });
    }
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

    // Remove appeal
    this.room.pendingAppeals.splice(appealIdx, 1);

    // Mark item as found
    const progress = this.room.progress[playerId]?.items[itemId];
    if (!progress) return;

    const item = this.room.items.find((i) => i.id === itemId);
    if (!item) return;

    progress.status = 'found';
    progress.foundAt = Date.now();

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

    // If this was a voluntary contest and player has attempts left, return to searching
    const progress = this.room.progress[playerId]?.items[itemId];
    const returnToSearching = !!(
      appeal.isContest &&
      progress &&
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

    this.sendTo(ws, { type: 'appeal_submitted', itemId });

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

    if (this.room.phase !== 'waiting') {
      this.sendTo(ws, { type: 'error', message: 'Can only claim host during waiting phase' });
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

    for (const player of this.room.players) {
      const progress = this.room.progress[player.id];
      if (!progress) continue;

      for (const [itemId, item] of Object.entries(progress.items)) {
        if (
          item.status === 'pending_review' &&
          item.pendingReviewSince &&
          now - item.pendingReviewSince > STUCK_THRESHOLD_MS
        ) {
          item.status = 'searching';
          item.pendingReviewSince = undefined;
          item.attemptsUsed = Math.max(0, item.attemptsUsed - 1);
          anyReset = true;

          const ws = this.findPlayerWebSocket(player.id);
          if (ws) {
            this.sendTo(ws, {
              type: 'photo_rejected',
              itemId,
              reason: 'Verification timed out. Please try again.',
              attemptsRemaining: this.room.config.maxRetries - item.attemptsUsed,
            });
          }
        }
      }
    }

    if (anyReset) {
      await this.persist();
    }
  }

  private async finishHunt(): Promise<void> {
    if (!this.room || this.room.phase === 'finished') return;

    this.room.phase = 'finished';
    this.room.nextAlarmAction = 'cleanup_hunt';

    // Clear any pending appeals since the hunt is over
    this.room.pendingAppeals = [];

    const results = this.buildResults();

    await this.saveHistory(results);
    await this.persist();

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

    this.broadcast({ type: 'hunt_finished', results });
    await this.notifyGroupOfUpdate();

    // Clean up after 20 minutes
    await this.state.storage.setAlarm(Date.now() + HUNT_EXPIRY_MS);
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
    const hostSecret = crypto.randomUUID();

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

    try {
      await this.env.TRIVIA_KV.put(
        `hunt-history:${this.room.huntId}`,
        JSON.stringify(entry),
        { expirationTtl: 90 * 24 * 60 * 60, metadata },
      );

      // Send host secret to host for deletion auth
      const hostWs = this.findPlayerWebSocket(this.room.hostId);
      if (hostWs) {
        this.sendTo(hostWs, {
          type: 'hunt_history_saved',
          huntId: this.room.huntId,
          hostSecret,
        });
      }
    } catch (err) {
      console.error('Failed to save hunt history', {
        huntId: this.room.huntId,
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
    return ws.deserializeAttachment() as string | null;
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

  private sendTo(ws: WebSocket, message: object): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Dead connection
    }
  }

  private broadcast(message: object): void {
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

  private broadcastExcept(excludeWs: WebSocket, message: object): void {
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
