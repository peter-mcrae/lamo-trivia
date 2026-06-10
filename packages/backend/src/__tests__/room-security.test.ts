import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameRoom } from '../room';
import {
  createMockDurableObjectState,
  createMockWebSocket,
  createMockEnv,
  getSentMessages,
  type MockDurableObjectState,
} from './mocks';

async function createInitializedRoom() {
  const state = createMockDurableObjectState();
  const env = createMockEnv();
  const room = new GameRoom(state, env);

  // Initialize room with config
  await room.fetch(
    new Request('http://internal/config', {
      method: 'POST',
      body: JSON.stringify({
        gameId: 'TEST-0001',
        name: 'Test Game',
        categoryIds: ['general'],
        questionCount: 5,
        minPlayers: 1,
        maxPlayers: 8,
        timePerQuestion: 15,
        scoringMethod: 'correct-only',
        streakBonus: false,
        showAnswers: true,
        timeBetweenQuestions: 5,
        isPrivate: false,
      }),
    }),
  );

  return { state, env, room };
}

describe('GameRoom Security', () => {
  it('rejects oversized WebSocket messages (>8192 chars) with error', async () => {
    const { room } = await createInitializedRoom();
    const ws = createMockWebSocket();

    // Create a message larger than 8192 characters
    const oversizedMessage = JSON.stringify({
      type: 'join_game',
      username: 'A'.repeat(9000),
    });
    expect(oversizedMessage.length).toBeGreaterThan(8192);

    await room.webSocketMessage(ws, oversizedMessage);

    const messages = getSentMessages(ws);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: 'error', message: 'Message too large' });
  });

  it('processes normal-sized JSON messages within size limit', async () => {
    const { room } = await createInitializedRoom();
    const ws = createMockWebSocket();

    // A valid ping message (well under 8192 chars)
    const normalMessage = JSON.stringify({ type: 'ping' });
    expect(normalMessage.length).toBeLessThan(8192);

    await room.webSocketMessage(ws, normalMessage);

    const messages = getSentMessages(ws);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: 'pong' });
  });

  it('rejects binary/ArrayBuffer messages (extracted as empty string, parsed as error)', async () => {
    const { room } = await createInitializedRoom();
    const ws = createMockWebSocket();

    // ArrayBuffer message gets converted to empty string, which fails JSON.parse
    const binaryMessage = new ArrayBuffer(10);
    await room.webSocketMessage(ws, binaryMessage);

    const messages = getSentMessages(ws);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: 'error', message: 'Failed to parse message' });
  });
});

async function joinPlayer(room: GameRoom, state: MockDurableObjectState, username: string) {
  const ws = createMockWebSocket();
  state.acceptWebSocket(ws);
  await room.webSocketMessage(
    ws,
    JSON.stringify({ type: 'join_game', gameId: 'TEST-0001', username }),
  );
  const confirmed = getSentMessages(ws).find((m) => m.type === 'join_confirmed');
  return { ws, playerId: confirmed?.playerId as string, rejoinToken: confirmed?.rejoinToken as string };
}

describe('GameRoom rejoin token (identity hijack fix)', () => {
  it('issues a secret rejoin token on join, only to the joining socket', async () => {
    const { room, state } = await createInitializedRoom();
    const alice = await joinPlayer(room, state, 'alice');
    const bob = await joinPlayer(room, state, 'bob');

    expect(alice.rejoinToken).toBeTruthy();

    // Bob must never see Alice's token (or any token in broadcasts/state)
    const bobMessages = getSentMessages(bob.ws);
    const serialized = JSON.stringify(bobMessages);
    expect(serialized).not.toContain(alice.rejoinToken);
    // game_state players must not carry tokens
    const stateMsg = bobMessages.find((m) => m.type === 'game_state');
    for (const p of stateMsg.state.players) {
      expect(p.rejoinToken).toBeUndefined();
    }
  });

  it('rejects rejoin_game with a wrong token and does not attach the socket', async () => {
    const { room, state } = await createInitializedRoom();
    await joinPlayer(room, state, 'alice');

    const attacker = createMockWebSocket();
    state.acceptWebSocket(attacker);
    await room.webSocketMessage(
      attacker,
      JSON.stringify({
        type: 'rejoin_game',
        gameId: 'TEST-0001',
        username: 'alice',
        rejoinToken: 'not-the-real-token',
      }),
    );

    const messages = getSentMessages(attacker);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('error');
    expect(messages[0].code).toBe('INVALID_REJOIN_TOKEN');
    expect(attacker.deserializeAttachment()).toBeNull();
  });

  it('accepts rejoin_game with the correct token', async () => {
    const { room, state } = await createInitializedRoom();
    const alice = await joinPlayer(room, state, 'alice');

    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await room.webSocketMessage(
      ws2,
      JSON.stringify({
        type: 'rejoin_game',
        gameId: 'TEST-0001',
        username: 'alice',
        rejoinToken: alice.rejoinToken,
      }),
    );

    const messages = getSentMessages(ws2);
    expect(messages.some((m) => m.type === 'game_state')).toBe(true);
    expect(ws2.deserializeAttachment()).toBe(alice.playerId);
  });
});

describe('GameRoom stale socket close (reconnect race fix)', () => {
  it('does not remove a player when another live socket has the same playerId', async () => {
    const { room, state } = await createInitializedRoom();
    const alice = await joinPlayer(room, state, 'alice');

    // Reconnect on a second socket
    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await room.webSocketMessage(
      ws2,
      JSON.stringify({
        type: 'rejoin_game',
        gameId: 'TEST-0001',
        username: 'alice',
        rejoinToken: alice.rejoinToken,
      }),
    );

    // The old socket closes after the reconnect
    await room.webSocketClose(alice.ws);

    const stored = state._storage.get('room') as any;
    expect(stored.players).toHaveLength(1);
    expect(stored.players[0].username).toBe('alice');
    expect(stored.hostId).toBe(alice.playerId);
  });

  it('still removes the player when no other live socket remains', async () => {
    const { room, state } = await createInitializedRoom();
    const alice = await joinPlayer(room, state, 'alice');

    await room.webSocketClose(alice.ws);

    const stored = state._storage.get('room') as any;
    expect(stored.players).toHaveLength(0);
    // Empty waiting room resets hostId so the next joiner becomes host
    expect(stored.hostId).toBe('');
  });
});

describe('GameRoom claim_host guard', () => {
  it('rejects claim_host while the current host has a live socket', async () => {
    const { room, state } = await createInitializedRoom();
    const alice = await joinPlayer(room, state, 'alice');
    const bob = await joinPlayer(room, state, 'bob');

    await room.webSocketMessage(bob.ws, JSON.stringify({ type: 'claim_host' }));

    const bobMessages = getSentMessages(bob.ws);
    const last = bobMessages[bobMessages.length - 1];
    expect(last.type).toBe('error');
    expect(last.message).toBe('The host is still connected');

    const stored = state._storage.get('room') as any;
    expect(stored.hostId).toBe(alice.playerId);
  });

  it('allows claim_host once the host has no live socket', async () => {
    const { room, state } = await createInitializedRoom();
    const alice = await joinPlayer(room, state, 'alice');
    const bob = await joinPlayer(room, state, 'bob');

    // Simulate the host's socket dying without a close event
    state._webSockets.splice(state._webSockets.indexOf(alice.ws), 1);

    await room.webSocketMessage(bob.ws, JSON.stringify({ type: 'claim_host' }));

    const bobMessages = getSentMessages(bob.ws);
    const last = bobMessages[bobMessages.length - 1];
    expect(last).toEqual({ type: 'host_changed', hostId: bob.playerId });

    const stored = state._storage.get('room') as any;
    expect(stored.hostId).toBe(bob.playerId);
  });
});

describe('GameRoom alarm retry idempotency (double-scoring fix)', () => {
  async function createPlayingRoom() {
    const state = createMockDurableObjectState();
    const env = createMockEnv();
    const now = Date.now();
    state._storage.set('room', {
      gameId: 'TEST-0001',
      config: {
        name: 'Test Game',
        categoryIds: ['general'],
        questionCount: 2,
        minPlayers: 1,
        maxPlayers: 8,
        timePerQuestion: 15,
        scoringMethod: 'correct-only',
        streakBonus: false,
        showAnswers: true,
        timeBetweenQuestions: 5,
        isPrivate: false,
      },
      phase: 'playing',
      hostId: 'p1',
      players: [
        { id: 'p1', username: 'alice', avatar: { emoji: 'x', name: 'X' }, connectedAt: now, score: 0 },
      ],
      questions: [
        { id: 'q1', text: 'Q1?', options: ['a', 'b', 'c', 'd'], correctIndex: 1, categoryId: 'general' },
        { id: 'q2', text: 'Q2?', options: ['a', 'b', 'c', 'd'], correctIndex: 0, categoryId: 'general' },
      ],
      currentQuestionIndex: 0,
      scores: { p1: 0 },
      streaks: { p1: 0 },
      answersThisRound: { p1: 1 },
      answerTimesThisRound: { p1: now },
      questionStartedAt: now - 1000,
      lastScoredQuestionIndex: -1,
      nextAlarmAction: 'end_question',
      createdAt: now,
      rejoinTokens: {},
    });
    const room = new GameRoom(state, env);
    // Let blockConcurrencyWhile load the stored state
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { room, state };
  }

  it('does not apply scores twice when endCurrentQuestion runs again (alarm retry)', async () => {
    const { room, state } = await createPlayingRoom();

    await (room as any).endCurrentQuestion();
    let stored = state._storage.get('room') as any;
    expect(stored.scores.p1).toBe(1000);
    expect(stored.lastScoredQuestionIndex).toBe(0);

    // Cloudflare retries alarm() if it threw after the persist — re-running
    // the handler must not re-apply the points
    await (room as any).endCurrentQuestion();
    stored = state._storage.get('room') as any;
    expect(stored.scores.p1).toBe(1000);
    expect(stored.streaks.p1).toBe(1);
  });
});
