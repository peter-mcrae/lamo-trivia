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

describe('PrivateGroup — WebSocket messages', () => {
  let state: MockDurableObjectState;
  let group: PrivateGroup;

  beforeEach(async () => {
    state = createMockDurableObjectState();
    group = new PrivateGroup(state);
    await initGroup(group);
  });

  // --- join_group ---

  it('join_group sends group_state to the joining member', async () => {
    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);

    await group.webSocketMessage(ws, JSON.stringify({ type: 'join_group', username: 'alice' }));

    const messages = getSentMessages(ws);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('group_state');
    expect(messages[0].state.id).toBe('brave-mountain-golden-river');
    expect(messages[0].state.name).toBe('McRae Family');
    expect(messages[0].state.members).toHaveLength(1);
    expect(messages[0].state.members[0].username).toBe('alice');
    expect(messages[0].state.members[0].online).toBe(true);
  });

  it('join_group broadcasts member_joined to other connected members', async () => {
    const ws1 = createMockWebSocket();
    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws1);
    state.acceptWebSocket(ws2);

    // First member joins
    await group.webSocketMessage(ws1, JSON.stringify({ type: 'join_group', username: 'alice' }));
    // Clear ws1 messages after join
    ws1._sent.length = 0;

    // Second member joins
    await group.webSocketMessage(ws2, JSON.stringify({ type: 'join_group', username: 'bob' }));

    // ws1 should receive member_joined broadcast
    const ws1Messages = getSentMessages(ws1);
    expect(ws1Messages).toHaveLength(1);
    expect(ws1Messages[0].type).toBe('member_joined');
    expect(ws1Messages[0].member.username).toBe('bob');
  });

  it('returning member triggers member_online instead of member_joined', async () => {
    const ws1 = createMockWebSocket();
    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws1);

    // alice joins
    await group.webSocketMessage(ws1, JSON.stringify({ type: 'join_group', username: 'alice' }));
    // alice disconnects
    await group.webSocketClose(ws1);

    // alice reconnects on new WebSocket
    state.acceptWebSocket(ws2);
    // Add a third member to check broadcast
    const ws3 = createMockWebSocket();
    state.acceptWebSocket(ws3);
    await group.webSocketMessage(ws3, JSON.stringify({ type: 'join_group', username: 'bob' }));
    ws3._sent.length = 0;

    await group.webSocketMessage(ws2, JSON.stringify({ type: 'join_group', username: 'alice' }));

    // ws3 (bob) should see member_online, not member_joined
    const ws3Messages = getSentMessages(ws3);
    expect(ws3Messages).toHaveLength(1);
    expect(ws3Messages[0].type).toBe('member_online');
    expect(ws3Messages[0].username).toBe('alice');
  });

  it('join_group rejects when group is full', async () => {
    // Manually fill up the group via repeated joins
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
    const ws1 = createMockWebSocket();
    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws1);
    state.acceptWebSocket(ws2);

    await group.webSocketMessage(ws1, JSON.stringify({ type: 'join_group', username: 'alice' }));
    await group.webSocketMessage(ws2, JSON.stringify({ type: 'join_group', username: 'bob' }));
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
    const ws1 = createMockWebSocket();
    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws1);
    state.acceptWebSocket(ws2);

    await group.webSocketMessage(ws1, JSON.stringify({ type: 'join_group', username: 'alice' }));
    await group.webSocketMessage(ws2, JSON.stringify({ type: 'join_group', username: 'bob' }));
    ws2._sent.length = 0;

    await group.webSocketClose(ws1);

    const bobMessages = getSentMessages(ws2);
    expect(bobMessages).toHaveLength(1);
    expect(bobMessages[0].type).toBe('member_offline');
    expect(bobMessages[0].username).toBe('alice');
  });

  it('multi-tab: closing one tab does not mark member offline if another is active', async () => {
    const ws1 = createMockWebSocket();
    const ws2 = createMockWebSocket();
    const ws3 = createMockWebSocket();
    state.acceptWebSocket(ws1);
    state.acceptWebSocket(ws2);
    state.acceptWebSocket(ws3);

    // alice joins on two tabs
    await group.webSocketMessage(ws1, JSON.stringify({ type: 'join_group', username: 'alice' }));
    await group.webSocketMessage(ws2, JSON.stringify({ type: 'join_group', username: 'alice' }));
    // bob joins to observe
    await group.webSocketMessage(ws3, JSON.stringify({ type: 'join_group', username: 'bob' }));
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
    ws = createMockWebSocket();
    state.acceptWebSocket(ws);
    await group.webSocketMessage(ws, JSON.stringify({ type: 'join_group', username: 'alice' }));
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

    // Register an expired waiting game (manipulate via another POST with old createdAt)
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
    const groupState = messages[0].state;

    // Should have 2 games: the fresh one and the still-playing one
    expect(groupState.games).toHaveLength(2);
    const gameIds = groupState.games.map((g: any) => g.gameId);
    expect(gameIds).toContain('FRESH-001');
    expect(gameIds).toContain('PLAY-001');
    expect(gameIds).not.toContain('OLD-0001');
  });
});
