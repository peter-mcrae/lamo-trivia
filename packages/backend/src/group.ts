import type { GroupMember, GroupGame, GroupState } from '@lamo-trivia/shared';
import {
  GroupClientMessageSchema,
  GroupMemberLinkSchema,
  GAME_EXPIRY_MS,
  GROUP_LIMITS,
  GROUP_GAME_MAX_AGE_MS,
  GROUP_SWEEP_INTERVAL_MS,
} from '@lamo-trivia/shared';

// Per-connection message rate limiting
const WS_RATE_WINDOW_MS = 10_000; // 10-second window
const WS_RATE_MAX_MESSAGES = 30;  // max 30 messages per window

/**
 * A member as the Durable Object keeps it. `email` is the account the member
 * record belongs to and never leaves this object — member lists are broadcast
 * to the whole group, so `toClientMember` strips it on the way out.
 */
interface StoredGroupMember extends GroupMember {
  email?: string;
}

/**
 * What a socket is allowed to claim about itself, kept in the hibernation
 * attachment.
 *
 * `email` comes only from the `X-User-Email` header the Worker sets after
 * validating a session token — clients cannot supply it, because index.ts
 * strips that header off every inbound request. Note that `X-Caller-Email` is
 * *not* stripped from socket upgrades, so it must never be read here.
 * `memberId` is filled in once the socket joins.
 */
interface SocketIdentity {
  memberId?: string;
  email?: string;
}

interface StoredGroupState {
  id: string;
  name: string;
  createdAt: number;
  ownerEmail?: string;
  members: StoredGroupMember[];
  games: Map<string, GroupGame>;
}

/** Accounts are keyed case-insensitively in KV, so compare them that way here. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The member shape clients see.
 *
 * Both secrets a member record holds are dropped here, because everything this
 * returns is broadcast to the whole group: the linked account's address, and
 * `memberId` — possession of which is the *only* thing that proves a record is
 * yours, on `join_group` and on `POST /members/link` alike. A client learns its
 * own memberId from `join_confirmed` or the link response and never needs
 * anybody else's, so no member list may ever carry one.
 */
function toClientMember(member: StoredGroupMember): Omit<GroupMember, 'memberId'> {
  const { email, memberId, ...clientMember } = member;
  return { ...clientMember, linkedAccount: !!email };
}

export class PrivateGroup {
  private state: DurableObjectState;
  private group: StoredGroupState | null = null;
  private wsRates = new Map<WebSocket, { count: number; start: number }>();

  constructor(state: DurableObjectState) {
    this.state = state;
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<StoredGroupState>('group');
      if (stored) this.group = stored;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      // POST /init — create/initialize the group
      if (request.method === 'POST' && url.pathname === '/init') {
        if (this.group) {
          return Response.json({ error: 'Group already exists' }, { status: 409 });
        }
        const { id, name, ownerEmail } = (await request.json()) as { id: string; name: string; ownerEmail?: string };
        this.group = {
          id,
          name,
          createdAt: Date.now(),
          ownerEmail,
          members: [],
          games: new Map(),
        };
        await this.persist();
        return Response.json({ ok: true, groupId: id });
      }

      // GET /state — check if group exists. ownerEmail is personal data, so it
      // is only included for callers that ask for it (?includeOwner=1) and
      // have checked who they are answering.
      if (request.method === 'GET' && url.pathname === '/state') {
        if (!this.group) {
          return Response.json({ error: 'Group not found' }, { status: 404 });
        }
        const includeOwner = url.searchParams.get('includeOwner') === '1';
        return Response.json({
          id: this.group.id,
          name: this.group.name,
          createdAt: this.group.createdAt,
          ...(includeOwner ? { ownerEmail: this.group.ownerEmail } : {}),
          memberCount: this.group.members.length,
        });
      }

      // POST /delete — delete the group (close all connections, wipe state)
      if (request.method === 'POST' && url.pathname === '/delete') {
        if (!this.group) {
          return Response.json({ error: 'Group not found' }, { status: 404 });
        }
        // Close all WebSocket connections
        const sockets = this.state.getWebSockets();
        for (const ws of sockets) {
          try { ws.close(1000, 'Group deleted'); } catch { /* ignore */ }
        }
        this.group = null;
        await this.state.storage.deleteAll();
        return Response.json({ ok: true });
      }

      // POST /games — register a new game in the group
      if (request.method === 'POST' && url.pathname === '/games') {
        if (!this.group) {
          return Response.json({ error: 'Group not found' }, { status: 404 });
        }

        // The Worker sets this from a validated session before proxying —
        // never register a game on behalf of an anonymous caller
        const callerEmail = request.headers.get('X-Caller-Email');
        if (!callerEmail) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        if (!this.isGroupMember(normalizeEmail(callerEmail))) {
          return Response.json(
            { error: 'Only members of this group can create games in it', code: 'NOT_A_MEMBER' },
            { status: 403 },
          );
        }

        // Enforce active game limit
        const activeCount = Array.from(this.group.games.values()).filter(
          (g) => g.phase === 'waiting' || g.phase === 'playing' || g.phase === 'starting',
        ).length;
        if (activeCount >= GROUP_LIMITS.maxActiveGames) {
          return Response.json(
            { error: 'Too many active games. Wait for some to finish.' },
            { status: 400 },
          );
        }

        const game = (await request.json()) as GroupGame;
        this.group.games.set(game.gameId, game);
        await this.persist();
        this.broadcast({ type: 'game_created', game });

        // Schedule sweep alarm if not already set
        const existingAlarm = await this.state.storage.getAlarm();
        if (!existingAlarm) {
          await this.state.storage.setAlarm(Date.now() + GROUP_SWEEP_INTERVAL_MS);
        }

        return Response.json({ ok: true });
      }

      // PUT /games/:gameId — update game state (player count, phase)
      if (request.method === 'PUT' && url.pathname.startsWith('/games/')) {
        if (!this.group) return Response.json({ error: 'Group not found' }, { status: 404 });
        const gameId = url.pathname.split('/games/')[1];
        const update = (await request.json()) as Partial<GroupGame>;
        const existing = this.group.games.get(gameId);
        if (existing) {
          const updated = { ...existing, ...update };
          this.group.games.set(gameId, updated);
          await this.persist();
          this.broadcast({ type: 'game_updated', game: updated });
        }
        return Response.json({ ok: true });
      }

      // DELETE /games/:gameId — remove a game from the group
      if (request.method === 'DELETE' && url.pathname.startsWith('/games/')) {
        if (!this.group) return Response.json({ error: 'Group not found' }, { status: 404 });
        const gameId = url.pathname.split('/games/')[1];
        if (gameId && this.group.games.has(gameId)) {
          this.group.games.delete(gameId);
          await this.persist();
          this.broadcast({ type: 'game_removed', gameId });
        }
        return Response.json({ ok: true });
      }

      // GET /membership — is the caller a member? X-Caller-Email is set by the
      // Worker from a validated session, so this is the one identity we trust.
      if (request.method === 'GET' && url.pathname === '/membership') {
        if (!this.group) {
          return Response.json({ error: 'Group not found' }, { status: 404 });
        }
        const callerEmail = request.headers.get('X-Caller-Email');
        if (!callerEmail) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const email = normalizeEmail(callerEmail);
        return Response.json({
          isOwner: this.isOwnerEmail(email),
          isMember: this.isGroupMember(email),
          linkedMemberCount: this.group.members.filter((m) => m.email).length,
        });
      }

      // POST /members/link — tie a member record to the caller's account
      if (request.method === 'POST' && url.pathname === '/members/link') {
        return await this.handleLink(request);
      }

      // WebSocket upgrade
      if (request.headers.get('Upgrade') === 'websocket') {
        if (!this.group) {
          return new Response('Group not found', { status: 404 });
        }
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.state.acceptWebSocket(server);
        // Only X-User-Email is trusted: the Worker strips whatever the client
        // sent and re-sets it from a validated session token.
        const verifiedEmail = request.headers.get('X-User-Email');
        if (verifiedEmail) {
          this.setIdentity(server, { email: normalizeEmail(verifiedEmail) });
        }
        return new Response(null, { status: 101, webSocket: client });
      }

      return new Response('Not found', { status: 404 });
    } catch (err) {
      console.error('PrivateGroup fetch error', {
        groupId: this.group?.id,
        method: request.method,
        path: url.pathname,
        error: err instanceof Error ? err.message : String(err),
      });
      return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Per-connection message rate limiting
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

    const raw = typeof message === 'string' ? message : '';
    if (raw.length > 2048) {
      this.sendTo(ws, { type: 'error', message: 'Message too large' });
      return;
    }

    try {
      const data = JSON.parse(raw);
      const parsed = GroupClientMessageSchema.safeParse(data);
      if (!parsed.success) {
        this.sendTo(ws, { type: 'error', message: 'Invalid message format' });
        return;
      }

      switch (parsed.data.type) {
        case 'join_group':
          await this.handleJoin(ws, parsed.data.username, parsed.data.memberId);
          break;
        case 'recover_member':
          await this.handleRecover(ws, parsed.data.username);
          break;
        case 'leave_group':
          await this.handleLeave(ws);
          break;
        case 'invite_to_game':
          this.handleInvite(ws, parsed.data.gameId, parsed.data.gameName);
          break;
        case 'ping':
          this.sendTo(ws, { type: 'pong' });
          break;
      }
    } catch (err) {
      console.error('Group WebSocket message error', {
        groupId: this.group?.id,
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
    await this.handleLeave(ws);
  }

  async alarm(): Promise<void> {
    if (!this.group) return;

    const now = Date.now();
    let changed = false;

    for (const [gameId, game] of this.group.games) {
      const age = now - game.createdAt;
      const isStale = game.phase !== 'playing' && age > GAME_EXPIRY_MS;
      const isOrphaned = age > GROUP_GAME_MAX_AGE_MS;

      if (isStale || isOrphaned) {
        this.group.games.delete(gameId);
        this.broadcast({ type: 'game_removed', gameId });
        changed = true;
      }
    }

    if (changed) {
      await this.persist();
    }

    // Reschedule if games remain
    if (this.group.games.size > 0) {
      await this.state.storage.setAlarm(Date.now() + GROUP_SWEEP_INTERVAL_MS);
    }
  }

  // --- Handlers ---

  private async handleJoin(ws: WebSocket, username: string, memberId?: string): Promise<void> {
    if (!this.group) return;

    const verifiedEmail = this.identity(ws).email;
    let member: StoredGroupMember | undefined;
    let isNew = false;

    // 1. If memberId provided, look up by memberId
    if (memberId) {
      member = this.group.members.find((m) => m.memberId === memberId);
      if (member) {
        if (!this.mayClaim(member, verifiedEmail)) {
          this.sendTo(ws, {
            type: 'error',
            message: 'That member belongs to another account. Sign in with it to continue.',
            code: 'MEMBER_LINKED',
          });
          return;
        }
        // Reject renames that collide with another member — duplicate names
        // would permanently break recover_member
        const taken = this.group.members.some(
          (m) => m.memberId !== memberId && m.username.toLowerCase() === username.toLowerCase(),
        );
        if (taken) {
          this.sendTo(ws, {
            type: 'error',
            message: 'That username is already taken in this group',
            code: 'USERNAME_TAKEN',
          });
          return;
        }
        // Update username if changed
        member.username = username;
        member.online = true;
      }
    }

    // 2. No memberId or memberId not found — check by username
    if (!member) {
      const byUsername = this.group.members.find(
        (m) => m.username.toLowerCase() === username.toLowerCase(),
      );

      if (byUsername && !byUsername.memberId) {
        // Backward compat migration: existing member without memberId
        byUsername.memberId = crypto.randomUUID();
        byUsername.online = true;
        member = byUsername;
      } else if (byUsername && byUsername.memberId) {
        // Username taken by a member who already has a token — new device scenario
        this.sendTo(ws, {
          type: 'error',
          message: 'This username is already in this group. Use recovery to reclaim your account.',
          code: 'MEMBER_EXISTS',
        });
        return;
      } else {
        // Brand new member
        if (this.group.members.length >= GROUP_LIMITS.maxMembers) {
          this.sendTo(ws, { type: 'error', message: 'Group is full', code: 'GROUP_FULL' });
          return;
        }
        const newMemberId = crypto.randomUUID();
        const newMember: StoredGroupMember = {
          memberId: newMemberId,
          username,
          joinedAt: Date.now(),
          online: true,
        };
        this.group.members.push(newMember);
        member = newMember;
        isNew = true;
      }
    }

    // Record the account the moment the Worker vouches for one, so membership
    // is verifiable without a separate link call.
    if (verifiedEmail && !member.email) {
      member.email = verifiedEmail;
      member.linkedAccount = true;
    }

    // Attach identity to the WebSocket for hibernation persistence
    this.setIdentity(ws, { memberId: member.memberId, email: verifiedEmail });

    await this.persist();

    // Send join_confirmed then group_state
    this.sendTo(ws, { type: 'join_confirmed', memberId: member.memberId! });
    this.sendTo(ws, { type: 'group_state', state: this.getClientGroupState() });

    // Broadcast to others
    if (isNew) {
      this.broadcastExcept(ws, {
        type: 'member_joined',
        member: toClientMember(member),
      });
    } else {
      this.broadcastExcept(ws, { type: 'member_online', username });
    }
  }

  private async handleRecover(ws: WebSocket, username: string): Promise<void> {
    if (!this.group) return;

    const matches = this.group.members.filter(
      (m) => m.username.toLowerCase() === username.toLowerCase(),
    );

    if (matches.length === 0) {
      this.sendTo(ws, { type: 'error', message: 'No member found with that username' });
      return;
    }

    if (matches.length > 1) {
      this.sendTo(ws, { type: 'error', message: 'Multiple members found. Contact group admin.' });
      return;
    }

    const member = matches[0];
    const verifiedEmail = this.identity(ws).email;

    // A member linked to an account may only be reclaimed by that account.
    // Username recovery is a guess anyone who can read the member list could
    // make, so it must never hand over an identity that has a real owner: the
    // supported path is signing in and calling POST /members/link, which
    // returns the memberId without involving the username at all.
    if (member.email && normalizeEmail(member.email) !== verifiedEmail) {
      this.sendTo(ws, {
        type: 'error',
        message: 'That member is linked to an account. Sign in with it to continue.',
        code: 'MEMBER_LINKED',
      });
      return;
    }

    // Recovery matches on username alone, so it may only ever reclaim an
    // identity nobody is currently using — otherwise anyone who can see a
    // member's name could take over their live session.
    if (member.memberId && this.hasLiveSocket(member.memberId, ws)) {
      this.sendTo(ws, {
        type: 'error',
        message: 'That member is currently online. Recovery is only possible once they disconnect.',
        code: 'MEMBER_ONLINE',
      });
      return;
    }

    member.online = true;

    // Ensure memberId exists (backward compat)
    if (!member.memberId) {
      member.memberId = crypto.randomUUID();
    }

    if (verifiedEmail && !member.email) {
      member.email = verifiedEmail;
      member.linkedAccount = true;
    }

    this.setIdentity(ws, { memberId: member.memberId, email: verifiedEmail });
    await this.persist();

    this.sendTo(ws, { type: 'join_confirmed', memberId: member.memberId });
    this.sendTo(ws, { type: 'group_state', state: this.getClientGroupState() });
    this.broadcastExcept(ws, { type: 'member_online', username: member.username });
  }

  /**
   * Is a socket currently attached to this member? Live sockets are the
   * authoritative signal — the persisted `online` flag can survive a restart
   * that dropped every connection.
   */
  private hasLiveSocket(memberId: string, exclude?: WebSocket): boolean {
    return this.state.getWebSockets().some((s) => {
      if (s === exclude) return false;
      return this.identity(s).memberId === memberId;
    });
  }

  /**
   * Read a socket's identity out of its hibernation attachment.
   *
   * Sockets that were hibernating across the deploy which introduced account
   * linking still carry the bare memberId string they were attached with.
   */
  private identity(ws: WebSocket): SocketIdentity {
    const raw = ws.deserializeAttachment() as SocketIdentity | string | null;
    if (typeof raw === 'string') return { memberId: raw };
    return raw ?? {};
  }

  private setIdentity(ws: WebSocket, identity: SocketIdentity): void {
    ws.serializeAttachment(identity);
  }

  /**
   * May this socket act as `member`?
   *
   * A record with no account on it is claimable by whoever holds its memberId.
   * Once an account is on it, only that account may claim it — an *un*verified
   * socket must not pass, or anyone who learned the memberId could reconnect
   * with no `?token=` at all and take the record over. That is the same hijack
   * handleRecover refuses, and the two paths have to agree.
   */
  private mayClaim(member: StoredGroupMember, verifiedEmail?: string): boolean {
    if (!member.email) return true;
    return !!verifiedEmail && normalizeEmail(member.email) === verifiedEmail;
  }

  private isOwnerEmail(email: string): boolean {
    const owner = this.group?.ownerEmail;
    return !!owner && normalizeEmail(owner) === email;
  }

  private findMemberByEmail(email: string): StoredGroupMember | undefined {
    return this.group?.members.find((m) => m.email && normalizeEmail(m.email) === email);
  }

  /**
   * Does this account belong to the group?
   *
   * The owner always does; everyone else needs a member record linked to their
   * account (see POST /members/link).
   *
   * Grandfather clause: a group with no owner on record *and* not one linked
   * member predates both mechanisms, so there is nothing here to check a
   * caller against. Refusing everybody would freeze such a group for good, and
   * the Worker has at least proved the caller is signed in.
   *
   * Be clear about what this is NOT: `callerBelongsToGroup` in routes/groups.ts
   * answers by calling this very method over `/membership`, so there is no
   * stricter outer check standing in front of it. For a group in this state,
   * any signed-in caller is treated as a member. Every group created since
   * `/init` started recording `ownerEmail` is unaffected.
   */
  private isGroupMember(email: string): boolean {
    if (!this.group) return false;
    if (this.isOwnerEmail(email)) return true;
    if (this.findMemberByEmail(email)) return true;
    return !this.group.ownerEmail && !this.group.members.some((m) => m.email);
  }

  /**
   * Tie a member record to the signed-in caller's account, or report which
   * record that account already owns.
   *
   * This is the only way an email reaches a member record over HTTP, and it is
   * reachable only through the Worker, which sets X-Caller-Email from a
   * validated session. The caller proves the record is theirs by presenting
   * the memberId the DO issued them on join.
   */
  private async handleLink(request: Request): Promise<Response> {
    if (!this.group) {
      return Response.json({ error: 'Group not found' }, { status: 404 });
    }

    const callerEmail = request.headers.get('X-Caller-Email');
    if (!callerEmail) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const email = normalizeEmail(callerEmail);

    const parsed = GroupMemberLinkSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ error: 'Invalid member id' }, { status: 400 });
    }

    // Already linked somewhere in this group — hand that record back instead
    // of letting one account accumulate member slots. This doubles as
    // account-based recovery: a member who lost their local memberId gets it
    // back by signing in, no username guessing involved.
    const owned = this.findMemberByEmail(email);
    if (owned) {
      return Response.json({ memberId: owned.memberId, username: owned.username, linked: true });
    }

    const member = parsed.data.memberId
      ? this.group.members.find((m) => m.memberId === parsed.data.memberId)
      : undefined;
    if (!member) {
      return Response.json(
        { error: 'No member record to link. Join the group first.', code: 'NO_MEMBER_TO_LINK' },
        { status: 404 },
      );
    }
    if (member.email) {
      // Belongs to another account — an identical one was caught above.
      return Response.json(
        {
          error: 'That member is already linked to another account.',
          code: 'MEMBER_LINKED_TO_OTHER_ACCOUNT',
        },
        { status: 409 },
      );
    }

    member.email = email;
    member.linkedAccount = true;
    await this.persist();

    return Response.json({ memberId: member.memberId, username: member.username, linked: true });
  }

  private async handleLeave(ws: WebSocket): Promise<void> {
    if (!this.group) return;

    const attachedId = this.identity(ws).memberId;
    if (!attachedId) return;

    // Check if member has another active WebSocket (multiple tabs)
    const otherActive = this.hasLiveSocket(attachedId, ws);

    if (!otherActive) {
      // Mark offline only if no other connections
      const member = this.group.members.find((m) => m.memberId === attachedId);
      if (member) {
        member.online = false;
        await this.persist();
        this.broadcast({ type: 'member_offline', username: member.username });
      }
    }
  }

  private handleInvite(ws: WebSocket, gameId: string, gameName: string): void {
    if (!this.group) return;

    const attachedId = this.identity(ws).memberId;
    if (!attachedId) return;

    const member = this.group.members.find((m) => m.memberId === attachedId);
    if (!member) return;

    this.broadcastExcept(ws, {
      type: 'game_invite',
      gameId,
      gameName,
      inviterUsername: member.username,
    });
  }

  // --- Helpers ---

  private getClientGroupState(): GroupState {
    const g = this.group!;
    const now = Date.now();
    // Filter out expired games when building client state
    const activeGames = Array.from(g.games.values()).filter(
      (game) => (now - game.createdAt) < GAME_EXPIRY_MS || game.phase === 'playing',
    );
    return {
      id: g.id,
      name: g.name,
      createdAt: g.createdAt,
      members: g.members.map(toClientMember),
      games: activeGames,
    };
  }

  private sendTo(ws: WebSocket, message: object): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Dead connection — ignore
    }
  }

  private broadcast(message: object): void {
    const json = JSON.stringify(message);
    const sockets = this.state.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.send(json);
      } catch {
        // Dead connection — ignore
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
        // Dead connection — ignore
      }
    }
  }

  private async persist(): Promise<void> {
    await this.state.storage.put('group', this.group);
  }
}
