import { describe, it, expect, beforeEach } from 'vitest';
import { PrivateGroup } from '../group';
import {
  createMockDurableObjectState,
  createMockWebSocket,
  getSentMessages,
  getLastMessage,
  type MockDurableObjectState,
  type MockWebSocket,
} from './mocks';
import { GAME_EXPIRY_MS, GROUP_LIMITS } from '@lamo-trivia/shared';

async function initGroup(group: PrivateGroup, id = 'brave-mountain-golden-river', name = 'McRae Family') {
  return group.fetch(
    new Request('http://internal/init', {
      method: 'POST',
      body: JSON.stringify({ id, name }),
    }),
  );
}

function makeGroupGame(overrides: Record<string, unknown> = {}) {
  return {
    gameId: 'ABCD-1234',
    name: 'Test Game',
    hostUsername: 'alice',
    playerCount: 1,
    maxPlayers: 8,
    phase: 'waiting',
    createdAt: Date.now(),
    categoryIds: ['general'],
    ...overrides,
  };
}

/** Join a member and return the memberId from join_confirmed */
async function joinAndGetMemberId(
  group: PrivateGroup,
  state: MockDurableObjectState,
  username: string,
  memberId?: string,
): Promise<{ ws: MockWebSocket; memberId: string }> {
  const ws = createMockWebSocket();
  state.acceptWebSocket(ws);
  await group.webSocketMessage(
    ws,
    JSON.stringify({ type: 'join_group', username, ...(memberId ? { memberId } : {}) }),
  );
  const messages = getSentMessages(ws);
  const confirmed = messages.find((m: any) => m.type === 'join_confirmed');
  return { ws, memberId: confirmed?.memberId };
}

describe('PrivateGroup — HTTP endpoints', () => {
  let state: MockDurableObjectState;
  let group: PrivateGroup;

  beforeEach(() => {
    state = createMockDurableObjectState();
    group = new PrivateGroup(state);
  });

  // --- POST /init ---

  it('POST /init creates a new group and returns groupId', async () => {
    const res = await initGroup(group);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.ok).toBe(true);
    expect(data.groupId).toBe('brave-mountain-golden-river');
  });

  it('POST /init returns 409 if group already exists', async () => {
    await initGroup(group);
    const res = await initGroup(group);
    expect(res.status).toBe(409);
    const data = (await res.json()) as any;
    expect(data.error).toBe('Group already exists');
  });

  // --- GET /state ---

  it('GET /state returns group info when group exists', async () => {
    await initGroup(group);
    const res = await group.fetch(new Request('http://internal/state'));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.id).toBe('brave-mountain-golden-river');
    expect(data.name).toBe('McRae Family');
    expect(data.memberCount).toBe(0);
    expect(data.createdAt).toBeDefined();
  });

  it('GET /state returns 404 when group does not exist', async () => {
    const res = await group.fetch(new Request('http://internal/state'));
    expect(res.status).toBe(404);
  });

  // --- POST /games ---

  it('POST /games registers a game and returns ok', async () => {
    await initGroup(group);
    const game = makeGroupGame();
    const res = await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        body: JSON.stringify(game),
      }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.ok).toBe(true);
  });

  it('POST /games returns 404 when group does not exist', async () => {
    const res = await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        body: JSON.stringify(makeGroupGame()),
      }),
    );
    expect(res.status).toBe(404);
  });

  // --- PUT /games/:gameId ---

  it('PUT /games/:gameId updates an existing game', async () => {
    await initGroup(group);
    const game = makeGroupGame();
    await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        body: JSON.stringify(game),
      }),
    );

    const res = await group.fetch(
      new Request('http://internal/games/ABCD-1234', {
        method: 'PUT',
        body: JSON.stringify({ playerCount: 3, phase: 'playing' }),
      }),
    );
    expect(res.status).toBe(200);
  });

  it('PUT /games/:gameId returns ok even for non-existent game (no-op)', async () => {
    await initGroup(group);
    const res = await group.fetch(
      new Request('http://internal/games/ZZZZ-9999', {
        method: 'PUT',
        body: JSON.stringify({ playerCount: 2 }),
      }),
    );
    expect(res.status).toBe(200);
  });

  // --- DELETE /games/:gameId ---

  it('DELETE /games/:gameId removes a game', async () => {
    await initGroup(group);
    await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        body: JSON.stringify(makeGroupGame()),
      }),
    );

    const res = await group.fetch(
      new Request('http://internal/games/ABCD-1234', { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
  });

  // --- WebSocket upgrade ---

  it('rejects WebSocket upgrade when group does not exist', async () => {
    const res = await group.fetch(
      new Request('http://internal/ws', { headers: { Upgrade: 'websocket' } }),
    );
    expect(res.status).toBe(404);
  });

  // --- Unknown route ---

  it('returns 404 for unknown routes', async () => {
    const res = await group.fetch(new Request('http://internal/unknown'));
    expect(res.status).toBe(404);
  });
});

describe('PrivateGroup — Member identity', () => {
  let state: MockDurableObjectState;
  let group: PrivateGroup;

  beforeEach(async () => {
    state = createMockDurableObjectState();
    group = new PrivateGroup(state);
    await initGroup(group);
  });

  it('join_group sends join_confirmed then group_state', async () => {
    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);

    await group.webSocketMessage(ws, JSON.stringify({ type: 'join_group', username: 'alice' }));

    const messages = getSentMessages(ws);
    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe('join_confirmed');
    expect(messages[0].memberId).toBeDefined();
    expect(typeof messages[0].memberId).toBe('string');
    expect(messages[1].type).toBe('group_state');
    expect(messages[1].state.members[0].username).toBe('alice');
    expect(messages[1].state.members[0].memberId).toBe(messages[0].memberId);
  });

  it('join_group with valid memberId returns same memberId', async () => {
    // First join to get a memberId
    const { memberId } = await joinAndGetMemberId(group, state, 'alice');
    expect(memberId).toBeDefined();

    // Rejoin with the memberId
    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await group.webSocketMessage(
      ws2,
      JSON.stringify({ type: 'join_group', username: 'alice', memberId }),
    );

    const messages = getSentMessages(ws2);
    const confirmed = messages.find((m: any) => m.type === 'join_confirmed');
    expect(confirmed.memberId).toBe(memberId);
  });

  it('join_group with unknown memberId creates a new member', async () => {
    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);
    const fakeMemberId = '00000000-0000-0000-0000-000000000000';

    await group.webSocketMessage(
      ws,
      JSON.stringify({ type: 'join_group', username: 'alice', memberId: fakeMemberId }),
    );

    const messages = getSentMessages(ws);
    const confirmed = messages.find((m: any) => m.type === 'join_confirmed');
    expect(confirmed).toBeDefined();
    // Should get a NEW memberId, not the fake one
    expect(confirmed.memberId).not.toBe(fakeMemberId);
  });

  it('join_group with taken username (member has memberId) returns MEMBER_EXISTS error', async () => {
    // First member joins and gets a memberId
    await joinAndGetMemberId(group, state, 'alice');

    // New user tries to join with same username but no memberId
    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await group.webSocketMessage(
      ws2,
      JSON.stringify({ type: 'join_group', username: 'alice' }),
    );

    const lastMsg = getLastMessage(ws2);
    expect(lastMsg.type).toBe('error');
    expect(lastMsg.code).toBe('MEMBER_EXISTS');
  });

  it('WS attachment stores memberId (not username)', async () => {
    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);

    await group.webSocketMessage(ws, JSON.stringify({ type: 'join_group', username: 'alice' }));

    const attached = ws.deserializeAttachment() as string;
    // Should be a UUID, not "alice"
    expect(attached).not.toBe('alice');
    expect(attached).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('join_group with memberId allows username change', async () => {
    const { memberId } = await joinAndGetMemberId(group, state, 'alice');

    // Rejoin with same memberId but different username
    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await group.webSocketMessage(
      ws2,
      JSON.stringify({ type: 'join_group', username: 'alice_v2', memberId }),
    );

    const messages = getSentMessages(ws2);
    const groupState = messages.find((m: any) => m.type === 'group_state');
    // Member should have the updated username
    const member = groupState.state.members.find((m: any) => m.memberId === memberId);
    expect(member.username).toBe('alice_v2');
  });
});

describe('PrivateGroup — Recovery flow', () => {
  let state: MockDurableObjectState;
  let group: PrivateGroup;

  beforeEach(async () => {
    state = createMockDurableObjectState();
    group = new PrivateGroup(state);
    await initGroup(group);
  });

  it('recover_member with valid username sends join_confirmed and group_state', async () => {
    // alice joins first
    await joinAndGetMemberId(group, state, 'alice');

    // New WS tries to recover alice
    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await group.webSocketMessage(ws2, JSON.stringify({ type: 'recover_member', username: 'alice' }));

    const messages = getSentMessages(ws2);
    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe('join_confirmed');
    expect(messages[0].memberId).toBeDefined();
    expect(messages[1].type).toBe('group_state');
  });

  it('recover_member broadcasts member_online to others', async () => {
    await joinAndGetMemberId(group, state, 'alice');
    const { ws: bobWs } = await joinAndGetMemberId(group, state, 'bob');
    bobWs._sent.length = 0;

    // Recover alice from new device
    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await group.webSocketMessage(ws2, JSON.stringify({ type: 'recover_member', username: 'alice' }));

    const bobMessages = getSentMessages(bobWs);
    expect(bobMessages).toHaveLength(1);
    expect(bobMessages[0].type).toBe('member_online');
    expect(bobMessages[0].username).toBe('alice');
  });

  it('recover_member with non-existent username returns error', async () => {
    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);
    await group.webSocketMessage(ws, JSON.stringify({ type: 'recover_member', username: 'nobody' }));

    const lastMsg = getLastMessage(ws);
    expect(lastMsg.type).toBe('error');
    expect(lastMsg.message).toContain('No member found');
  });

  it('recover_member is case-insensitive', async () => {
    await joinAndGetMemberId(group, state, 'Alice');

    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await group.webSocketMessage(ws2, JSON.stringify({ type: 'recover_member', username: 'alice' }));

    const messages = getSentMessages(ws2);
    expect(messages[0].type).toBe('join_confirmed');
  });
});

describe('PrivateGroup — WebSocket messages', () => {
  let state: MockDurableObjectState;
  let group: PrivateGroup;

  beforeEach(async () => {
    state = createMockDurableObjectState();
    group = new PrivateGroup(state);
    await initGroup(group);
  });

  it('join_group broadcasts member_joined to other connected members', async () => {
    const { ws: ws1 } = await joinAndGetMemberId(group, state, 'alice');
    ws1._sent.length = 0;

    // Second member joins
    await joinAndGetMemberId(group, state, 'bob');

    // ws1 should receive member_joined broadcast
    const ws1Messages = getSentMessages(ws1);
    expect(ws1Messages).toHaveLength(1);
    expect(ws1Messages[0].type).toBe('member_joined');
    expect(ws1Messages[0].member.username).toBe('bob');
    expect(ws1Messages[0].member.memberId).toBeDefined();
  });

  it('returning member (with memberId) triggers member_online instead of member_joined', async () => {
    // alice joins and gets memberId
    const { ws: ws1, memberId } = await joinAndGetMemberId(group, state, 'alice');
    // alice disconnects
    await group.webSocketClose(ws1);

    // bob joins to observe
    const { ws: bobWs } = await joinAndGetMemberId(group, state, 'bob');
    bobWs._sent.length = 0;

    // alice reconnects with memberId
    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await group.webSocketMessage(
      ws2,
      JSON.stringify({ type: 'join_group', username: 'alice', memberId }),
    );

    // bob should see member_online, not member_joined
    const bobMessages = getSentMessages(bobWs);
    expect(bobMessages).toHaveLength(1);
    expect(bobMessages[0].type).toBe('member_online');
    expect(bobMessages[0].username).toBe('alice');
  });

  it('join_group rejects when group is full', async () => {
    // Fill up the group
    for (let i = 0; i < GROUP_LIMITS.maxMembers; i++) {
      const ws = createMockWebSocket();
      state.acceptWebSocket(ws);
      await group.webSocketMessage(ws, JSON.stringify({ type: 'join_group', username: `user${i}` }));
    }

    // One more should be rejected
    const extraWs = createMockWebSocket();
    state.acceptWebSocket(extraWs);
    await group.webSocketMessage(extraWs, JSON.stringify({ type: 'join_group', username: 'overflow' }));

    const lastMsg = getLastMessage(extraWs);
    expect(lastMsg.type).toBe('error');
    expect(lastMsg.code).toBe('GROUP_FULL');
  });

  // --- leave_group / webSocketClose ---

  it('leave marks member as offline and broadcasts member_offline', async () => {
    const { ws: ws1 } = await joinAndGetMemberId(group, state, 'alice');
    const { ws: ws2 } = await joinAndGetMemberId(group, state, 'bob');
    ws2._sent.length = 0;

    // alice leaves
    await group.webSocketMessage(ws1, JSON.stringify({ type: 'leave_group' }));

    // bob should receive member_offline
    const bobMessages = getSentMessages(ws2);
    expect(bobMessages).toHaveLength(1);
    expect(bobMessages[0].type).toBe('member_offline');
    expect(bobMessages[0].username).toBe('alice');
  });

  it('webSocketClose marks member offline', async () => {
    const { ws: ws1 } = await joinAndGetMemberId(group, state, 'alice');
    const { ws: ws2 } = await joinAndGetMemberId(group, state, 'bob');
    ws2._sent.length = 0;

    await group.webSocketClose(ws1);

    const bobMessages = getSentMessages(ws2);
    expect(bobMessages).toHaveLength(1);
    expect(bobMessages[0].type).toBe('member_offline');
    expect(bobMessages[0].username).toBe('alice');
  });

  it('multi-tab: closing one tab does not mark member offline if another is active', async () => {
    // alice joins on two tabs (same memberId)
    const { ws: ws1, memberId } = await joinAndGetMemberId(group, state, 'alice');
    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await group.webSocketMessage(
      ws2,
      JSON.stringify({ type: 'join_group', username: 'alice', memberId }),
    );

    // bob joins to observe
    const { ws: ws3 } = await joinAndGetMemberId(group, state, 'bob');
    ws3._sent.length = 0;

    // Close alice's first tab
    await group.webSocketClose(ws1);

    // bob should NOT receive member_offline since alice still has ws2 open
    const bobMessages = getSentMessages(ws3);
    expect(bobMessages).toHaveLength(0);
  });

  // --- ping ---

  it('ping responds with pong', async () => {
    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);
    await group.webSocketMessage(ws, JSON.stringify({ type: 'join_group', username: 'alice' }));
    ws._sent.length = 0;

    await group.webSocketMessage(ws, JSON.stringify({ type: 'ping' }));

    const messages = getSentMessages(ws);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: 'pong' });
  });

  // --- Message validation ---

  it('rejects oversized messages (>2048 chars)', async () => {
    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);

    const oversized = JSON.stringify({ type: 'join_group', username: 'A'.repeat(3000) });
    expect(oversized.length).toBeGreaterThan(2048);

    await group.webSocketMessage(ws, oversized);

    const messages = getSentMessages(ws);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: 'error', message: 'Message too large' });
  });

  it('rejects binary/ArrayBuffer messages', async () => {
    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);

    await group.webSocketMessage(ws, new ArrayBuffer(10));

    const messages = getSentMessages(ws);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: 'error', message: 'Failed to parse message' });
  });

  it('rejects invalid message format', async () => {
    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);

    await group.webSocketMessage(ws, JSON.stringify({ type: 'unknown_type' }));

    const messages = getSentMessages(ws);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: 'error', message: 'Invalid message format' });
  });

  it('rejects malformed JSON', async () => {
    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);

    await group.webSocketMessage(ws, 'not-json{{{');

    const messages = getSentMessages(ws);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: 'error', message: 'Failed to parse message' });
  });
});

describe('PrivateGroup — Game broadcasts', () => {
  let state: MockDurableObjectState;
  let group: PrivateGroup;
  let ws: MockWebSocket;

  beforeEach(async () => {
    state = createMockDurableObjectState();
    group = new PrivateGroup(state);
    await initGroup(group);

    // Connect a member to receive broadcasts
    const result = await joinAndGetMemberId(group, state, 'alice');
    ws = result.ws;
    ws._sent.length = 0;
  });

  it('POST /games broadcasts game_created to connected members', async () => {
    const game = makeGroupGame();
    await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        body: JSON.stringify(game),
      }),
    );

    const messages = getSentMessages(ws);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('game_created');
    expect(messages[0].game.gameId).toBe('ABCD-1234');
    expect(messages[0].game.name).toBe('Test Game');
  });

  it('PUT /games/:gameId broadcasts game_updated to connected members', async () => {
    const game = makeGroupGame();
    await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        body: JSON.stringify(game),
      }),
    );
    ws._sent.length = 0;

    await group.fetch(
      new Request('http://internal/games/ABCD-1234', {
        method: 'PUT',
        body: JSON.stringify({ playerCount: 3, phase: 'playing' }),
      }),
    );

    const messages = getSentMessages(ws);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('game_updated');
    expect(messages[0].game.playerCount).toBe(3);
    expect(messages[0].game.phase).toBe('playing');
  });

  it('DELETE /games/:gameId broadcasts game_removed to connected members', async () => {
    const game = makeGroupGame();
    await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        body: JSON.stringify(game),
      }),
    );
    ws._sent.length = 0;

    await group.fetch(
      new Request('http://internal/games/ABCD-1234', { method: 'DELETE' }),
    );

    const messages = getSentMessages(ws);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('game_removed');
    expect(messages[0].gameId).toBe('ABCD-1234');
  });
});

describe('PrivateGroup — Expired game filtering', () => {
  it('group_state filters out expired games but keeps playing games', async () => {
    const state = createMockDurableObjectState();
    const group = new PrivateGroup(state);
    await initGroup(group);

    // Register a fresh game
    await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        body: JSON.stringify(makeGroupGame({ gameId: 'FRESH-001', name: 'Fresh Game' })),
      }),
    );

    // Register an expired waiting game
    await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        body: JSON.stringify(
          makeGroupGame({
            gameId: 'OLD-0001',
            name: 'Old Game',
            phase: 'waiting',
            createdAt: Date.now() - GAME_EXPIRY_MS - 1000,
          }),
        ),
      }),
    );

    // Register an expired but still playing game (should be kept)
    await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        body: JSON.stringify(
          makeGroupGame({
            gameId: 'PLAY-001',
            name: 'Playing Game',
            phase: 'playing',
            createdAt: Date.now() - GAME_EXPIRY_MS - 1000,
          }),
        ),
      }),
    );

    // Connect and join to get the group_state
    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);
    await group.webSocketMessage(ws, JSON.stringify({ type: 'join_group', username: 'alice' }));

    const messages = getSentMessages(ws);
    // messages[0] = join_confirmed, messages[1] = group_state
    const groupState = messages[1].state;

    // Should have 2 games: the fresh one and the still-playing one
    expect(groupState.games).toHaveLength(2);
    const gameIds = groupState.games.map((g: any) => g.gameId);
    expect(gameIds).toContain('FRESH-001');
    expect(gameIds).toContain('PLAY-001');
    expect(gameIds).not.toContain('OLD-0001');
  });
});
