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
import { GAME_EXPIRY_MS, GROUP_LIMITS, GROUP_GAME_MAX_AGE_MS } from '@lamo-trivia/shared';

/** The Worker only proxies game registration for a signed-in caller */
const CALLER_HEADERS = { 'X-Caller-Email': 'owner@example.com' };

/**
 * The DO's live in-memory group — the object its handlers actually read and
 * mutate. Arranging a scenario has to go through this: `storage.get` returns
 * a snapshot, like the real DO storage API, so poking at that changes nothing
 * a handler will ever see.
 */
function liveGroup(group: PrivateGroup): any {
  return (group as unknown as { group: any }).group;
}

async function initGroup(
  group: PrivateGroup,
  id = 'brave-mountain-golden-river',
  name = 'McRae Family',
  ownerEmail?: string,
) {
  return group.fetch(
    new Request('http://internal/init', {
      method: 'POST',
      body: JSON.stringify({ id, name, ...(ownerEmail ? { ownerEmail } : {}) }),
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

/** Drop a member's socket the way a real disconnect would */
async function disconnect(
  group: PrivateGroup,
  state: MockDurableObjectState,
  ws: MockWebSocket,
): Promise<void> {
  state._webSockets = state._webSockets.filter((s) => s !== ws);
  await group.webSocketClose(ws);
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

  it('GET /state withholds ownerEmail unless the caller asks for it', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', 'owner@example.com');
    const res = await group.fetch(new Request('http://internal/state'));
    const data = (await res.json()) as any;
    expect(data.name).toBe('McRae Family');
    expect(data.ownerEmail).toBeUndefined();
  });

  it('GET /state?includeOwner=1 returns ownerEmail for ownership checks', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', 'owner@example.com');
    const res = await group.fetch(new Request('http://internal/state?includeOwner=1'));
    const data = (await res.json()) as any;
    expect(data.ownerEmail).toBe('owner@example.com');
  });

  // --- POST /games ---

  it('POST /games registers a game and returns ok', async () => {
    await initGroup(group);
    const game = makeGroupGame();
    const res = await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        headers: CALLER_HEADERS,
        body: JSON.stringify(game),
      }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.ok).toBe(true);
  });

  it('POST /games rejects a caller the Worker could not authenticate', async () => {
    await initGroup(group);
    const res = await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        body: JSON.stringify(makeGroupGame()),
      }),
    );
    expect(res.status).toBe(401);

    // ...and nothing was registered
    const stateRes = await group.fetch(new Request('http://internal/state'));
    expect(stateRes.status).toBe(200);
    const stored = (await (state.storage as any).get('group')) as any;
    expect(stored.games.size).toBe(0);
  });

  it('POST /games returns 404 when group does not exist', async () => {
    const res = await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        headers: CALLER_HEADERS,
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
        headers: CALLER_HEADERS,
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
        headers: CALLER_HEADERS,
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
    // join_confirmed is the only place a memberId is handed out. The member
    // list goes to the whole group, so it carries no memberId at all.
    expect(messages[1].state.members[0].memberId).toBeUndefined();
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

    const attached = ws.deserializeAttachment() as { memberId: string };
    // Should be a UUID, not "alice"
    expect(attached.memberId).not.toBe('alice');
    expect(attached.memberId).toMatch(/^[0-9a-f-]{36}$/);
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
    const confirmed = messages.find((m: any) => m.type === 'join_confirmed');
    expect(confirmed.memberId).toBe(memberId);

    // Member should have the updated username, and still be the only one
    const groupState = messages.find((m: any) => m.type === 'group_state');
    expect(groupState.state.members).toHaveLength(1);
    expect(groupState.state.members[0].username).toBe('alice_v2');
  });

  it('backward compat: existing member without memberId gets one assigned on join', async () => {
    // Inject a legacy member (no memberId) by modifying the stored object directly
    // Mock storage returns by reference, so this modifies the group's in-memory state
    const stored = await (state.storage as any).get('group');
    stored.members.push({
      username: 'legacy_user',
      joinedAt: Date.now() - 100000,
      online: false,
    });

    // Legacy user joins again (no memberId)
    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);
    await group.webSocketMessage(ws, JSON.stringify({ type: 'join_group', username: 'legacy_user' }));

    const messages = getSentMessages(ws);
    const confirmed = messages.find((m: any) => m.type === 'join_confirmed');
    expect(confirmed).toBeDefined();
    expect(confirmed.memberId).toBeDefined();
    // Should be a valid UUID
    expect(confirmed.memberId).toMatch(/^[0-9a-f-]{36}$/);

    // It lands on the stored record — but never in the broadcast member list
    const member = (await (state.storage as any).get('group')).members.find(
      (m: any) => m.username === 'legacy_user',
    );
    expect(member.memberId).toBe(confirmed.memberId);

    const groupState = messages.find((m: any) => m.type === 'group_state');
    const broadcast = groupState.state.members.find((m: any) => m.username === 'legacy_user');
    expect(broadcast.memberId).toBeUndefined();
  });

  it('MEMBER_EXISTS check is case-insensitive', async () => {
    // alice joins with lowercase
    await joinAndGetMemberId(group, state, 'alice');

    // Someone tries to join as "Alice" (different case) without memberId
    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await group.webSocketMessage(
      ws2,
      JSON.stringify({ type: 'join_group', username: 'Alice' }),
    );

    const lastMsg = getLastMessage(ws2);
    expect(lastMsg.type).toBe('error');
    expect(lastMsg.code).toBe('MEMBER_EXISTS');
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
    // alice joins, then loses her device
    const { ws: aliceWs } = await joinAndGetMemberId(group, state, 'alice');
    await disconnect(group, state, aliceWs);

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
    const { ws: aliceWs } = await joinAndGetMemberId(group, state, 'alice');
    const { ws: bobWs } = await joinAndGetMemberId(group, state, 'bob');
    await disconnect(group, state, aliceWs);
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
    const { ws: aliceWs } = await joinAndGetMemberId(group, state, 'Alice');
    await disconnect(group, state, aliceWs);

    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await group.webSocketMessage(ws2, JSON.stringify({ type: 'recover_member', username: 'alice' }));

    const messages = getSentMessages(ws2);
    expect(messages[0].type).toBe('join_confirmed');
  });

  it('recover_member with multiple username matches returns error', async () => {
    // Inject two members with the same username (case-insensitive)
    const stored = liveGroup(group);
    stored.members.push(
      { memberId: crypto.randomUUID(), username: 'alice', joinedAt: Date.now(), online: false },
      { memberId: crypto.randomUUID(), username: 'Alice', joinedAt: Date.now(), online: false },
    );

    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);
    await group.webSocketMessage(ws, JSON.stringify({ type: 'recover_member', username: 'alice' }));

    const lastMsg = getLastMessage(ws);
    expect(lastMsg.type).toBe('error');
    expect(lastMsg.message).toContain('Multiple members found');
  });

  it('recover_member refuses to take over a member who is still connected', async () => {
    const { ws: aliceWs, memberId } = await joinAndGetMemberId(group, state, 'alice');

    // An attacker who only knows the username tries to claim her identity
    const attackerWs = createMockWebSocket();
    state.acceptWebSocket(attackerWs);
    await group.webSocketMessage(attackerWs, JSON.stringify({ type: 'recover_member', username: 'alice' }));

    const lastMsg = getLastMessage(attackerWs);
    expect(lastMsg.type).toBe('error');
    expect(lastMsg.code).toBe('MEMBER_ONLINE');
    // alice keeps her identity and the attacker's socket gets nothing
    expect(attackerWs._attachment).toBeNull();
    expect((aliceWs._attachment as { memberId: string }).memberId).toBe(memberId);
  });

  it('recover_member succeeds once the member has disconnected', async () => {
    const { ws: aliceWs, memberId } = await joinAndGetMemberId(group, state, 'alice');
    await disconnect(group, state, aliceWs);

    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await group.webSocketMessage(ws2, JSON.stringify({ type: 'recover_member', username: 'alice' }));

    const messages = getSentMessages(ws2);
    expect(messages[0].type).toBe('join_confirmed');
    expect(messages[0].memberId).toBe(memberId);
  });

  it('recover_member ignores a stale online flag when no socket is attached', async () => {
    // A DO restart can leave `online: true` persisted with every socket gone
    const stored = liveGroup(group);
    stored.members.push({
      memberId: crypto.randomUUID(),
      username: 'ghost',
      joinedAt: Date.now(),
      online: true,
    });

    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);
    await group.webSocketMessage(ws, JSON.stringify({ type: 'recover_member', username: 'ghost' }));

    const messages = getSentMessages(ws);
    expect(messages[0].type).toBe('join_confirmed');
  });

  it('recover_member assigns memberId to legacy member without one', async () => {
    // Inject a legacy member without memberId
    const stored = liveGroup(group);
    stored.members.push({ username: 'legacy', joinedAt: Date.now(), online: false });

    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);
    await group.webSocketMessage(ws, JSON.stringify({ type: 'recover_member', username: 'legacy' }));

    const messages = getSentMessages(ws);
    expect(messages[0].type).toBe('join_confirmed');
    expect(messages[0].memberId).toBeDefined();
    expect(messages[0].memberId).toMatch(/^[0-9a-f-]{36}$/);
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
    // bob's memberId is bob's alone — it goes to bob in join_confirmed, and
    // nowhere near the sockets it is announced to.
    expect(ws1Messages[0].member.memberId).toBeUndefined();
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

  it('webSocketError marks member offline (same as close)', async () => {
    const { ws: ws1 } = await joinAndGetMemberId(group, state, 'alice');
    const { ws: ws2 } = await joinAndGetMemberId(group, state, 'bob');
    ws2._sent.length = 0;

    // Simulate a WebSocket error (not close)
    await group.webSocketError(ws1);

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
        headers: CALLER_HEADERS,
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
        headers: CALLER_HEADERS,
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
        headers: CALLER_HEADERS,
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
        headers: CALLER_HEADERS,
        body: JSON.stringify(makeGroupGame({ gameId: 'FRESH-001', name: 'Fresh Game' })),
      }),
    );

    // Register an expired waiting game
    await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        headers: CALLER_HEADERS,
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
        headers: CALLER_HEADERS,
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

describe('PrivateGroup — Game sweep alarm', () => {
  let state: MockDurableObjectState;
  let group: PrivateGroup;
  let ws: MockWebSocket;

  beforeEach(async () => {
    state = createMockDurableObjectState();
    group = new PrivateGroup(state);
    await initGroup(group);
    const result = await joinAndGetMemberId(group, state, 'alice');
    ws = result.ws;
    ws._sent.length = 0;
  });

  it('alarm deletes stale non-playing games older than GAME_EXPIRY_MS', async () => {
    await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        headers: CALLER_HEADERS,
        body: JSON.stringify(
          makeGroupGame({
            gameId: 'OLD-0001',
            phase: 'waiting',
            createdAt: Date.now() - GAME_EXPIRY_MS - 1000,
          }),
        ),
      }),
    );
    ws._sent.length = 0;

    await group.alarm();

    const messages = getSentMessages(ws);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: 'game_removed', gameId: 'OLD-0001' });
  });

  it('alarm deletes stale finished games older than GAME_EXPIRY_MS', async () => {
    await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        headers: CALLER_HEADERS,
        body: JSON.stringify(
          makeGroupGame({
            gameId: 'DONE-001',
            phase: 'finished',
            createdAt: Date.now() - GAME_EXPIRY_MS - 1000,
          }),
        ),
      }),
    );
    ws._sent.length = 0;

    await group.alarm();

    const messages = getSentMessages(ws);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: 'game_removed', gameId: 'DONE-001' });
  });

  it('alarm keeps playing games under 2 hours', async () => {
    await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        headers: CALLER_HEADERS,
        body: JSON.stringify(
          makeGroupGame({
            gameId: 'PLAY-001',
            phase: 'playing',
            createdAt: Date.now() - GAME_EXPIRY_MS - 5000,
          }),
        ),
      }),
    );
    ws._sent.length = 0;

    await group.alarm();

    const messages = getSentMessages(ws);
    expect(messages).toHaveLength(0);
  });

  it('alarm deletes orphaned playing games older than GROUP_GAME_MAX_AGE_MS', async () => {
    await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        headers: CALLER_HEADERS,
        body: JSON.stringify(
          makeGroupGame({
            gameId: 'ORPH-001',
            phase: 'playing',
            createdAt: Date.now() - GROUP_GAME_MAX_AGE_MS - 1000,
          }),
        ),
      }),
    );
    ws._sent.length = 0;

    await group.alarm();

    const messages = getSentMessages(ws);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: 'game_removed', gameId: 'ORPH-001' });
  });

  it('alarm reschedules when games remain after sweep', async () => {
    await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        headers: CALLER_HEADERS,
        body: JSON.stringify(makeGroupGame({ gameId: 'FRSH-001' })),
      }),
    );
    state._alarm = null;

    await group.alarm();

    expect(state._alarm).not.toBeNull();
  });

  it('alarm does not reschedule when no games remain', async () => {
    await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        headers: CALLER_HEADERS,
        body: JSON.stringify(
          makeGroupGame({
            gameId: 'OLD-0001',
            phase: 'finished',
            createdAt: Date.now() - GAME_EXPIRY_MS - 1000,
          }),
        ),
      }),
    );
    state._alarm = null;

    await group.alarm();

    expect(state._alarm).toBeNull();
  });

  it('POST /games sets alarm when first game is added', async () => {
    expect(state._alarm).toBeNull();

    await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        headers: CALLER_HEADERS,
        body: JSON.stringify(makeGroupGame()),
      }),
    );

    expect(state._alarm).not.toBeNull();
  });

  it('POST /games does not reset alarm when one is already set', async () => {
    await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        headers: CALLER_HEADERS,
        body: JSON.stringify(makeGroupGame({ gameId: 'GAME-001' })),
      }),
    );
    const firstAlarm = state._alarm;

    await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        headers: CALLER_HEADERS,
        body: JSON.stringify(makeGroupGame({ gameId: 'GAME-002' })),
      }),
    );

    expect(state._alarm).toBe(firstAlarm);
  });
});

describe('PrivateGroup — maxActiveGames enforcement', () => {
  let state: MockDurableObjectState;
  let group: PrivateGroup;

  beforeEach(async () => {
    state = createMockDurableObjectState();
    group = new PrivateGroup(state);
    await initGroup(group);
  });

  it('rejects game creation when at maxActiveGames limit', async () => {
    for (let i = 0; i < GROUP_LIMITS.maxActiveGames; i++) {
      await group.fetch(
        new Request('http://internal/games', {
          method: 'POST',
          headers: CALLER_HEADERS,
          body: JSON.stringify(makeGroupGame({ gameId: `GAME-${String(i).padStart(4, '0')}` })),
        }),
      );
    }

    const res = await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        headers: CALLER_HEADERS,
        body: JSON.stringify(makeGroupGame({ gameId: 'OVER-FLOW' })),
      }),
    );

    expect(res.status).toBe(400);
    const data = (await res.json()) as any;
    expect(data.error).toContain('Too many active games');
  });

  it('allows game creation when finished games bring count under limit', async () => {
    for (let i = 0; i < GROUP_LIMITS.maxActiveGames; i++) {
      await group.fetch(
        new Request('http://internal/games', {
          method: 'POST',
          headers: CALLER_HEADERS,
          body: JSON.stringify(
            makeGroupGame({ gameId: `DONE-${String(i).padStart(4, '0')}`, phase: 'finished' }),
          ),
        }),
      );
    }

    const res = await group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        headers: CALLER_HEADERS,
        body: JSON.stringify(makeGroupGame({ gameId: 'NEW-0001' })),
      }),
    );

    expect(res.status).toBe(200);
  });
});

describe('PrivateGroup — Account-linked membership', () => {
  const OWNER = 'owner@example.com';
  const ALICE = 'alice@example.com';
  const STRANGER = 'stranger@example.com';

  let state: MockDurableObjectState;
  let group: PrivateGroup;

  beforeEach(() => {
    state = createMockDurableObjectState();
    group = new PrivateGroup(state);
  });

  /** The Worker sets X-Caller-Email from a validated session before proxying. */
  function callerHeaders(email: string) {
    return { 'X-Caller-Email': email };
  }

  function linkMember(email: string, memberId?: string) {
    return group.fetch(
      new Request('http://internal/members/link', {
        method: 'POST',
        headers: callerHeaders(email),
        body: JSON.stringify(memberId ? { memberId } : {}),
      }),
    );
  }

  function createGame(email: string | null, gameId = 'ABCD-1234') {
    return group.fetch(
      new Request('http://internal/games', {
        method: 'POST',
        ...(email ? { headers: callerHeaders(email) } : {}),
        body: JSON.stringify(makeGroupGame({ gameId })),
      }),
    );
  }

  function membership(email: string) {
    return group.fetch(
      new Request('http://internal/membership', { headers: callerHeaders(email) }),
    );
  }

  /** A socket the Worker vouched for, the way the upgrade handler attaches it. */
  function acceptSocket(verifiedEmail?: string): MockWebSocket {
    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);
    if (verifiedEmail) ws.serializeAttachment({ email: verifiedEmail });
    return ws;
  }

  async function storedGroup(): Promise<any> {
    return (state.storage as any).get('group');
  }

  // --- POST /members/link ---

  it('links a member record to the account that holds its memberId', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', OWNER);
    const { memberId } = await joinAndGetMemberId(group, state, 'alice');

    const res = await linkMember(ALICE, memberId);

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data).toMatchObject({ memberId, username: 'alice', linked: true });
  });

  it('returns the record an account already owns when no memberId is sent', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', OWNER);
    const { memberId } = await joinAndGetMemberId(group, state, 'alice');
    await linkMember(ALICE, memberId);

    // Same account, new device: no memberId in local storage to offer.
    const res = await linkMember(ALICE);

    expect(res.status).toBe(200);
    expect((await res.json()) as any).toMatchObject({ memberId, username: 'alice' });
  });

  it('refuses to link a member that already belongs to another account', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', OWNER);
    const { memberId } = await joinAndGetMemberId(group, state, 'alice');
    await linkMember(ALICE, memberId);

    const res = await linkMember(STRANGER, memberId);

    expect(res.status).toBe(409);
    expect(((await res.json()) as any).code).toBe('MEMBER_LINKED_TO_OTHER_ACCOUNT');
  });

  it('returns 404 when there is no member record to link', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', OWNER);

    const res = await linkMember(STRANGER, crypto.randomUUID());

    expect(res.status).toBe(404);
    expect(((await res.json()) as any).code).toBe('NO_MEMBER_TO_LINK');
  });

  it('rejects a link the Worker could not authenticate', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', OWNER);
    const { memberId } = await joinAndGetMemberId(group, state, 'alice');

    const res = await group.fetch(
      new Request('http://internal/members/link', {
        method: 'POST',
        body: JSON.stringify({ memberId }),
      }),
    );

    expect(res.status).toBe(401);
    expect((await storedGroup()).members[0].email).toBeUndefined();
  });

  // --- GET /membership ---

  it('reports owner, linked member and stranger correctly', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', OWNER);
    const { memberId } = await joinAndGetMemberId(group, state, 'alice');
    await linkMember(ALICE, memberId);

    expect((await (await membership(OWNER)).json()) as any).toMatchObject({
      isOwner: true,
      isMember: true,
    });
    expect((await (await membership(ALICE)).json()) as any).toMatchObject({
      isOwner: false,
      isMember: true,
    });
    expect((await (await membership(STRANGER)).json()) as any).toMatchObject({
      isOwner: false,
      isMember: false,
    });
  });

  it('rejects a membership probe with no caller identity', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', OWNER);

    const res = await group.fetch(new Request('http://internal/membership'));

    expect(res.status).toBe(401);
  });

  // --- POST /games ---

  it('lets a linked member create a game', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', OWNER);
    const { memberId } = await joinAndGetMemberId(group, state, 'alice');
    await linkMember(ALICE, memberId);

    const res = await createGame(ALICE);

    expect(res.status).toBe(200);
    expect((await storedGroup()).games.size).toBe(1);
  });

  it('lets the owner create a game without ever joining the socket', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', OWNER);
    const { memberId } = await joinAndGetMemberId(group, state, 'alice');
    await linkMember(ALICE, memberId);

    expect((await createGame(OWNER)).status).toBe(200);
  });

  it('refuses a signed-in caller who is not in the group', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', OWNER);
    const { memberId } = await joinAndGetMemberId(group, state, 'alice');
    await linkMember(ALICE, memberId);

    const res = await createGame(STRANGER);

    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe('NOT_A_MEMBER');
    expect((await storedGroup()).games.size).toBe(0);
  });

  it('refuses an unauthenticated caller', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', OWNER);
    const { memberId } = await joinAndGetMemberId(group, state, 'alice');
    await linkMember(ALICE, memberId);

    const res = await createGame(null);

    expect(res.status).toBe(401);
    expect((await storedGroup()).games.size).toBe(0);
  });

  // --- Members who predate account linking ---

  it('grandfathers a group with no owner and no linked member', async () => {
    // Nothing on record to check a caller against — refusing everyone would
    // freeze the group for the very people who have been using it.
    await initGroup(group);
    await joinAndGetMemberId(group, state, 'alice');

    expect((await createGame(ALICE)).status).toBe(200);
  });

  it('lets a pre-existing member link with nothing but the memberId they already hold', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', OWNER);

    // A member record written before account linking existed: no email on it.
    const { memberId } = await joinAndGetMemberId(group, state, 'alice');
    expect((await storedGroup()).members[0].email).toBeUndefined();
    expect((await createGame(ALICE, 'NOPE-0001')).status).toBe(403);

    // Their client links on the next visit, with no extra proof required.
    expect((await linkMember(ALICE, memberId)).status).toBe(200);
    expect((await createGame(ALICE)).status).toBe(200);
  });

  // --- Privacy ---

  it('never puts a linked email in the member list it broadcasts', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', OWNER);
    const { memberId } = await joinAndGetMemberId(group, state, 'alice');
    await linkMember(ALICE, memberId);

    const ws = acceptSocket();
    await group.webSocketMessage(ws, JSON.stringify({ type: 'join_group', username: 'bob' }));
    const groupState = getSentMessages(ws).find((m: any) => m.type === 'group_state');

    const alice = groupState.state.members.find((m: any) => m.username === 'alice');
    expect(alice.linkedAccount).toBe(true);
    expect(alice.email).toBeUndefined();
    expect(JSON.stringify(groupState)).not.toContain(ALICE);
  });

  it('never puts another member\'s memberId in the member list it broadcasts', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', OWNER);
    const { memberId: aliceId } = await joinAndGetMemberId(group, state, 'alice');

    const ws = acceptSocket();
    await group.webSocketMessage(ws, JSON.stringify({ type: 'join_group', username: 'bob' }));
    const messages = getSentMessages(ws);

    // bob gets his own memberId, and only his own
    const confirmed = messages.find((m: any) => m.type === 'join_confirmed');
    expect(confirmed.memberId).toBeDefined();
    expect(confirmed.memberId).not.toBe(aliceId);

    const groupState = messages.find((m: any) => m.type === 'group_state');
    expect(groupState.state.members.map((m: any) => m.username).sort()).toEqual(['alice', 'bob']);
    for (const m of groupState.state.members) {
      expect(m.memberId).toBeUndefined();
    }
    expect(JSON.stringify(groupState)).not.toContain(aliceId);
  });

  it('gives a stranger who watched the group nothing to link an unlinked member with', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', OWNER);
    const { memberId: aliceId } = await joinAndGetMemberId(group, state, 'alice');

    // An attacker joins the group and reads everything it is told: group_state
    // plus every member_joined it sees afterwards.
    const attackerWs = acceptSocket();
    await group.webSocketMessage(
      attackerWs,
      JSON.stringify({ type: 'join_group', username: 'mallory' }),
    );
    await joinAndGetMemberId(group, state, 'carol');

    const seen = getSentMessages(attackerWs).filter((m: any) => m.type !== 'join_confirmed');
    const harvested: string[] = [];
    for (const msg of seen) {
      const members = msg.type === 'group_state' ? msg.state.members : [msg.member ?? {}];
      for (const m of members) if (m.memberId) harvested.push(m.memberId);
    }

    // linkedAccount marks alice as an unclaimed record, but her memberId — the
    // bearer token /members/link needs — never crossed the wire.
    const alice = (seen.find((m: any) => m.type === 'group_state') as any)
      .state.members.find((m: any) => m.username === 'alice');
    expect(alice.linkedAccount).toBe(false);
    expect(harvested).toEqual([]);
    expect(JSON.stringify(seen)).not.toContain(aliceId);
  });

  // --- Identity on the socket ---

  it('links the member on join when the Worker verified the socket', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', OWNER);

    const ws = acceptSocket(ALICE);
    await group.webSocketMessage(ws, JSON.stringify({ type: 'join_group', username: 'alice' }));

    expect((await storedGroup()).members[0].email).toBe(ALICE);
    expect((await createGame(ALICE)).status).toBe(200);
  });

  it('refuses an anonymous socket claiming an account-linked member', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', OWNER);
    const { ws: aliceWs, memberId } = await joinAndGetMemberId(group, state, 'alice');
    await linkMember(ALICE, memberId);
    await disconnect(group, state, aliceWs);

    // No ?token= at all — the hijack recover_member already refuses. Arriving
    // with no identity must not be a way around a record that has an owner.
    const attackerWs = acceptSocket();
    await group.webSocketMessage(
      attackerWs,
      JSON.stringify({ type: 'join_group', username: 'mallory', memberId }),
    );

    const lastMsg = getLastMessage(attackerWs);
    expect(lastMsg.type).toBe('error');
    expect(lastMsg.code).toBe('MEMBER_LINKED');
    // Nothing was taken over: no identity attached, name and account intact.
    expect(attackerWs._attachment).toBeNull();
    const stored = await storedGroup();
    expect(stored.members[0].email).toBe(ALICE);
    expect(stored.members[0].username).toBe('alice');
  });

  it('still lets an anonymous socket claim a member with no account on it', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', OWNER);
    const { ws: aliceWs, memberId } = await joinAndGetMemberId(group, state, 'alice');
    await disconnect(group, state, aliceWs);

    // The device that holds the memberId and never signed in keeps working.
    const sameDeviceWs = acceptSocket();
    await group.webSocketMessage(
      sameDeviceWs,
      JSON.stringify({ type: 'join_group', username: 'alice', memberId }),
    );

    const confirmed = getSentMessages(sameDeviceWs).find((m: any) => m.type === 'join_confirmed');
    expect(confirmed.memberId).toBe(memberId);
  });

  it('lets the linked account itself rejoin by memberId once its socket is verified', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', OWNER);
    const { ws: aliceWs, memberId } = await joinAndGetMemberId(group, state, 'alice');
    await linkMember(ALICE, memberId);
    await disconnect(group, state, aliceWs);

    const newDeviceWs = acceptSocket(ALICE);
    await group.webSocketMessage(
      newDeviceWs,
      JSON.stringify({ type: 'join_group', username: 'alice', memberId }),
    );

    const confirmed = getSentMessages(newDeviceWs).find((m: any) => m.type === 'join_confirmed');
    expect(confirmed.memberId).toBe(memberId);
  });

  it('refuses a verified socket claiming a member linked to another account', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', OWNER);
    const { memberId } = await joinAndGetMemberId(group, state, 'alice');
    await linkMember(ALICE, memberId);

    const ws = acceptSocket(STRANGER);
    await group.webSocketMessage(
      ws,
      JSON.stringify({ type: 'join_group', username: 'alice', memberId }),
    );

    const lastMsg = getLastMessage(ws);
    expect(lastMsg.type).toBe('error');
    expect(lastMsg.code).toBe('MEMBER_LINKED');
    expect((await storedGroup()).members[0].email).toBe(ALICE);
  });

  // --- recover_member ---

  it('refuses username recovery of an account-linked member', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', OWNER);
    const { ws: aliceWs, memberId } = await joinAndGetMemberId(group, state, 'alice');
    await linkMember(ALICE, memberId);
    await disconnect(group, state, aliceWs);

    const attackerWs = acceptSocket();
    await group.webSocketMessage(
      attackerWs,
      JSON.stringify({ type: 'recover_member', username: 'alice' }),
    );

    const lastMsg = getLastMessage(attackerWs);
    expect(lastMsg.type).toBe('error');
    expect(lastMsg.code).toBe('MEMBER_LINKED');
    expect(attackerWs._attachment).toBeNull();
  });

  it('lets the linked account itself recover, once its socket is verified', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', OWNER);
    const { ws: aliceWs, memberId } = await joinAndGetMemberId(group, state, 'alice');
    await linkMember(ALICE, memberId);
    await disconnect(group, state, aliceWs);

    const newDeviceWs = acceptSocket(ALICE);
    await group.webSocketMessage(
      newDeviceWs,
      JSON.stringify({ type: 'recover_member', username: 'alice' }),
    );

    const confirmed = getSentMessages(newDeviceWs).find((m: any) => m.type === 'join_confirmed');
    expect(confirmed.memberId).toBe(memberId);
  });

  it('still lets an unlinked member recover, and still refuses a live one', async () => {
    await initGroup(group, 'brave-mountain-golden-river', 'McRae Family', OWNER);
    const { ws: aliceWs, memberId } = await joinAndGetMemberId(group, state, 'alice');

    // Liveness protection is unchanged for members with no account on record.
    const tooSoonWs = acceptSocket();
    await group.webSocketMessage(
      tooSoonWs,
      JSON.stringify({ type: 'recover_member', username: 'alice' }),
    );
    expect(getLastMessage(tooSoonWs).code).toBe('MEMBER_ONLINE');

    await disconnect(group, state, aliceWs);

    const laterWs = acceptSocket();
    await group.webSocketMessage(
      laterWs,
      JSON.stringify({ type: 'recover_member', username: 'alice' }),
    );
    const confirmed = getSentMessages(laterWs).find((m: any) => m.type === 'join_confirmed');
    expect(confirmed.memberId).toBe(memberId);
  });
});
