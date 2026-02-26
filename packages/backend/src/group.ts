import type { GroupMember, GroupGame, GroupState } from '@lamo-trivia/shared';
import { GroupClientMessageSchema, GAME_EXPIRY_MS, GROUP_LIMITS } from '@lamo-trivia/shared';

interface StoredGroupState {
  id: string;
  name: string;
  createdAt: number;
  members: GroupMember[];
  games: Map<string, GroupGame>;
}

export class PrivateGroup {
  private state: DurableObjectState;
  private group: StoredGroupState | null = null;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<StoredGroupState>('group');
      if (stored) this.group = stored;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // POST /init — create/initialize the group
    if (request.method === 'POST' && url.pathname === '/init') {
      if (this.group) {
        return Response.json({ error: 'Group already exists' }, { status: 409 });
      }
      const { id, name } = (await request.json()) as { id: string; name: string };
      this.group = {
        id,
        name,
        createdAt: Date.now(),
        members: [],
        games: new Map(),
      };
      await this.persist();
      return Response.json({ ok: true, groupId: id });
    }

    // GET /state — check if group exists
    if (request.method === 'GET' && url.pathname === '/state') {
      if (!this.group) {
        return Response.json({ error: 'Group not found' }, { status: 404 });
      }
      return Response.json({
        id: this.group.id,
        name: this.group.name,
        createdAt: this.group.createdAt,
        memberCount: this.group.members.length,
      });
    }

    // POST /games — register a new game in the group
    if (request.method === 'POST' && url.pathname === '/games') {
      if (!this.group) {
        return Response.json({ error: 'Group not found' }, { status: 404 });
      }
      const game = (await request.json()) as GroupGame;
      this.group.games.set(game.gameId, game);
      await this.persist();
      this.broadcast({ type: 'game_created', game });
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

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      if (!this.group) {
        return new Response('Group not found', { status: 404 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
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
        case 'ping':
          this.sendTo(ws, { type: 'pong' });
          break;
      }
    } catch {
      this.sendTo(ws, { type: 'error', message: 'Failed to parse message' });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.handleLeave(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.handleLeave(ws);
  }

  // --- Handlers ---

  private async handleJoin(ws: WebSocket, username: string, memberId?: string): Promise<void> {
    if (!this.group) return;

    let member: GroupMember | undefined;
    let isNew = false;

    // 1. If memberId provided, look up by memberId
    if (memberId) {
      member = this.group.members.find((m) => m.memberId === memberId);
      if (member) {
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
        const newMember: GroupMember = {
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

    // Attach memberId to WebSocket for hibernation persistence
    ws.serializeAttachment(member.memberId);

    await this.persist();

    // Send join_confirmed then group_state
    this.sendTo(ws, { type: 'join_confirmed', memberId: member.memberId! });
    this.sendTo(ws, { type: 'group_state', state: this.getClientGroupState() });

    // Broadcast to others
    if (isNew) {
      this.broadcastExcept(ws, {
        type: 'member_joined',
        member: { memberId: member.memberId, username, joinedAt: Date.now(), online: true },
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
    member.online = true;

    // Ensure memberId exists (backward compat)
    if (!member.memberId) {
      member.memberId = crypto.randomUUID();
    }

    ws.serializeAttachment(member.memberId);
    await this.persist();

    this.sendTo(ws, { type: 'join_confirmed', memberId: member.memberId });
    this.sendTo(ws, { type: 'group_state', state: this.getClientGroupState() });
    this.broadcastExcept(ws, { type: 'member_online', username: member.username });
  }

  private async handleLeave(ws: WebSocket): Promise<void> {
    if (!this.group) return;

    const attachedId = ws.deserializeAttachment() as string | null;
    if (!attachedId) return;

    // Check if member has another active WebSocket (multiple tabs)
    const sockets = this.state.getWebSockets();
    const otherActive = sockets.some((s) => {
      if (s === ws) return false;
      const attached = s.deserializeAttachment() as string | null;
      return attached === attachedId;
    });

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
      members: g.members,
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
