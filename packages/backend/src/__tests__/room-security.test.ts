import { describe, it, expect } from 'vitest';
import { GameRoom } from '../room';
import {
  createMockDurableObjectState,
  createMockWebSocket,
  createMockEnv,
  getSentMessages,
  type MockDurableObjectState,
} from './mocks';

/**
 * Arrange room state: mutate the DO's live in-memory object *and* make
 * storage agree with it.
 *
 * mocks.ts snapshots on both read and write now, the way the real DO storage
 * API does, so neither half alone is enough: poking at `storage.get('room')`
 * changes nothing a handler will read, and mutating only memory would let a
 * handler that never calls persist() still look correct.
 */
async function arrangeRoom(
  room: GameRoom,
  state: MockDurableObjectState,
  mutate: (live: any) => void,
): Promise<void> {
  const live = (room as unknown as { room: any }).room;
  mutate(live);
  await state.storage.put('room', live);
}

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

  it('does not remove the player on an accidental close, even with no other live socket (lobby identity fix)', async () => {
    const { room, state } = await createInitializedRoom();
    const alice = await joinPlayer(room, state, 'alice');

    // webSocketClose (unlike an explicit leave_game) is what a phone lock or
    // a one-second WiFi blip triggers — it must not delete the player
    await room.webSocketClose(alice.ws);

    const stored = state._storage.get('room') as any;
    expect(stored.players).toHaveLength(1);
    expect(stored.players[0].id).toBe(alice.playerId);
    // Host stays put on a transient drop
    expect(stored.hostId).toBe(alice.playerId);
    // Rejoin token survives — this is what lets handleRejoin find them again
    expect(stored.rejoinTokens[alice.playerId]).toBe(alice.rejoinToken);
  });
});

describe('GameRoom accidental disconnect vs explicit leave (lobby identity fix)', () => {
  it('still fully removes the player on an explicit leave_game message', async () => {
    const { room, state } = await createInitializedRoom();
    const alice = await joinPlayer(room, state, 'alice');

    await room.webSocketMessage(alice.ws, JSON.stringify({ type: 'leave_game' }));

    const stored = state._storage.get('room') as any;
    expect(stored.players).toHaveLength(0);
    expect(stored.rejoinTokens[alice.playerId]).toBeUndefined();
    // Empty waiting room resets hostId so the next joiner becomes host
    expect(stored.hostId).toBe('');
  });

  it('hands host off immediately when the host explicitly leaves and another player remains', async () => {
    const { room, state } = await createInitializedRoom();
    const alice = await joinPlayer(room, state, 'alice');
    const bob = await joinPlayer(room, state, 'bob');

    await room.webSocketMessage(alice.ws, JSON.stringify({ type: 'leave_game' }));

    const stored = state._storage.get('room') as any;
    expect(stored.players).toHaveLength(1);
    expect(stored.hostId).toBe(bob.playerId);
  });

  it('marks the host disconnected (not removed) on an accidental close, and does not hand off host', async () => {
    const { room, state } = await createInitializedRoom();
    const alice = await joinPlayer(room, state, 'alice'); // alice is host (first joiner)
    await joinPlayer(room, state, 'bob');

    await room.webSocketClose(alice.ws);

    const stored = state._storage.get('room') as any;
    expect(stored.players).toHaveLength(2);
    const storedAlice = stored.players.find((p: any) => p.id === alice.playerId);
    expect(storedAlice.disconnectedAt).toBeTypeOf('number');
    // A one-second blip must not cost the host their role
    expect(stored.hostId).toBe(alice.playerId);
  });

  it('does not re-bump an already-set disconnected timestamp (webSocketClose and webSocketError can both fire)', async () => {
    const { room, state } = await createInitializedRoom();
    const alice = await joinPlayer(room, state, 'alice');

    await room.webSocketClose(alice.ws);
    const stored = state._storage.get('room') as any;
    const sentinel = 12345; // distinguishable from any real Date.now() value
    stored.players[0].disconnectedAt = sentinel;

    await room.webSocketError(alice.ws);

    expect((state._storage.get('room') as any).players[0].disconnectedAt).toBe(sentinel);
  });

  it('lets the player rejoin after an accidental close, clearing the disconnected marker and keeping their host role', async () => {
    const { room, state } = await createInitializedRoom();
    const alice = await joinPlayer(room, state, 'alice');

    await room.webSocketClose(alice.ws);

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

    // No PLAYER_NOT_FOUND / INVALID_REJOIN_TOKEN — that's the failure the
    // frontend reacts to by discarding the token and rejoining as a new player
    const messages = getSentMessages(ws2);
    expect(messages.some((m) => m.type === 'error')).toBe(false);
    expect(messages.some((m) => m.type === 'join_confirmed')).toBe(true);
    expect(ws2.deserializeAttachment()).toBe(alice.playerId);

    const stored = state._storage.get('room') as any;
    expect(stored.hostId).toBe(alice.playerId);
    expect(stored.players[0].disconnectedAt).toBeUndefined();
  });

  it('a player can still explicitly leave for good after an earlier blip, freeing their username', async () => {
    const { room, state } = await createInitializedRoom();
    const alice = await joinPlayer(room, state, 'alice');

    await room.webSocketClose(alice.ws); // transient blip — preserved
    // The mock (like the real runtime once a close event has fired) doesn't
    // keep a dead socket in the live set — simulate that explicitly
    state._webSockets.splice(state._webSockets.indexOf(alice.ws), 1);

    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await room.webSocketMessage(ws2, JSON.stringify({
      type: 'rejoin_game', gameId: 'TEST-0001', username: 'alice', rejoinToken: alice.rejoinToken,
    }));

    // ...then genuinely leaves
    await room.webSocketMessage(ws2, JSON.stringify({ type: 'leave_game' }));

    const stored = state._storage.get('room') as any;
    expect(stored.players).toHaveLength(0);
    expect(stored.hostId).toBe('');

    // The username is free again — the room isn't stuck holding a ghost
    const bob = createMockWebSocket();
    state.acceptWebSocket(bob);
    await room.webSocketMessage(
      bob,
      JSON.stringify({ type: 'join_game', gameId: 'TEST-0001', username: 'alice' }),
    );
    expect(getSentMessages(bob).some((m) => m.type === 'join_confirmed')).toBe(true);
  });
});

describe('GameRoom disconnect sweep (ghost reclaim fix)', () => {
  // mocks.ts snapshots every value on its way into and out of storage, so
  // `state._storage.get('room')` is now exactly what reached persist() and
  // nothing else — a handler that swept in memory and forgot to persist()
  // reads as unswept here. (This used to need a put-spy that deep-cloned
  // each write; the mock does it centrally now.)
  function persistedRoom(state: MockDurableObjectState): any {
    return state._storage.get('room') as any;
  }

  it('reclaims a ghost past the grace window: removes them, frees their username, and this is genuinely persisted', async () => {
    const { room, state } = await createInitializedRoom();
    const alice = await joinPlayer(room, state, 'alice');
    const ghost = await joinPlayer(room, state, 'ghost');

    await room.webSocketClose(ghost.ws);
    // The mock (like the real runtime once a close event has fired) doesn't
    // keep a dead socket in the live set — simulate that explicitly
    state._webSockets.splice(state._webSockets.indexOf(ghost.ws), 1);

    // Push the disconnect back past the grace window, in memory and in storage
    await arrangeRoom(room, state, (live) => {
      live.players.find((p: any) => p.id === ghost.playerId).disconnectedAt = Date.now() - 61_000;
    });

    // Any subsequent message runs the lazy sweep — alice pings
    await room.webSocketMessage(alice.ws, JSON.stringify({ type: 'ping' }));

    // Genuinely verify persistence: storage was arranged *with* the ghost, so
    // a sweep that only ran in memory leaves them visible here.
    const lastPersisted = persistedRoom(state);
    expect(lastPersisted.players.find((p: any) => p.id === ghost.playerId)).toBeUndefined();
    expect(lastPersisted.rejoinTokens[ghost.playerId]).toBeUndefined();
    expect(lastPersisted.scores[ghost.playerId]).toBeUndefined();
    expect(lastPersisted.streaks[ghost.playerId]).toBeUndefined();

    // Behavioral proof, not just storage inspection: the username is
    // genuinely free again, and the room isn't stuck holding the slot
    const newcomer = createMockWebSocket();
    state.acceptWebSocket(newcomer);
    await room.webSocketMessage(
      newcomer,
      JSON.stringify({ type: 'join_game', gameId: 'TEST-0001', username: 'ghost' }),
    );
    expect(getSentMessages(newcomer).some((m) => m.type === 'join_confirmed')).toBe(true);
  });

  it('keeps identity, scores, rejoin token and host role for a player who returns inside the grace window, even across an intervening sweep-triggering message', async () => {
    const { room, state } = await createInitializedRoom();
    const alice = await joinPlayer(room, state, 'alice'); // host (first joiner)
    const bob = await joinPlayer(room, state, 'bob');

    await room.webSocketClose(alice.ws); // marks disconnectedAt; well inside the window
    state._webSockets.splice(state._webSockets.indexOf(alice.ws), 1);

    // Bob's ping runs the sweep while alice is still inside the grace window
    await room.webSocketMessage(bob.ws, JSON.stringify({ type: 'ping' }));

    let stored = state._storage.get('room') as any;
    expect(stored.players).toHaveLength(2);
    expect(stored.hostId).toBe(alice.playerId);

    // Alice reconnects for real
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
    expect(messages.some((m) => m.type === 'error')).toBe(false);
    expect(ws2.deserializeAttachment()).toBe(alice.playerId);

    stored = state._storage.get('room') as any;
    expect(stored.hostId).toBe(alice.playerId);
    expect(stored.players.find((p: any) => p.id === alice.playerId).disconnectedAt).toBeUndefined();
    // NOTE: this test does not fail against pre-sweep code — with no sweep
    // at all, nothing ever evicts anyone, so "still there after the ping"
    // is trivially true either way. It guards the grace-window boundary
    // itself (see the "does not regress" requirement), not the sweep's
    // existence — the two "past the window" tests above/below are what
    // fail without the sweep.
  });

  it('hands off a disconnected host past the grace window, and this is genuinely persisted', async () => {
    const { room, state } = await createInitializedRoom();
    const alice = await joinPlayer(room, state, 'alice'); // host
    const bob = await joinPlayer(room, state, 'bob');

    await room.webSocketClose(alice.ws);
    state._webSockets.splice(state._webSockets.indexOf(alice.ws), 1);

    await arrangeRoom(room, state, (live) => {
      live.players.find((p: any) => p.id === alice.playerId).disconnectedAt = Date.now() - 61_000;
    });

    (bob.ws as any)._sent.length = 0; // isolate messages from this point on

    await room.webSocketMessage(bob.ws, JSON.stringify({ type: 'ping' }));

    const lastPersisted = persistedRoom(state);
    expect(lastPersisted.players.find((p: any) => p.id === alice.playerId)).toBeUndefined();
    expect(lastPersisted.hostId).toBe(bob.playerId);

    const bobMessages = getSentMessages(bob.ws);
    const leftMsg = bobMessages.find((m: any) => m.type === 'player_left');
    expect(leftMsg).toBeDefined();
    expect(leftMsg.playerId).toBe(alice.playerId);
    expect(leftMsg.newHostId).toBe(bob.playerId);
  });

  it('does not transfer host away from a disconnected host still inside the grace window', async () => {
    const { room, state } = await createInitializedRoom();
    const alice = await joinPlayer(room, state, 'alice'); // host
    const bob = await joinPlayer(room, state, 'bob');

    await room.webSocketClose(alice.ws); // disconnectedAt = now, well inside the window
    state._webSockets.splice(state._webSockets.indexOf(alice.ws), 1);

    (bob.ws as any)._sent.length = 0;
    await room.webSocketMessage(bob.ws, JSON.stringify({ type: 'ping' }));

    const stored = state._storage.get('room') as any;
    expect(stored.hostId).toBe(alice.playerId);
    expect(stored.players).toHaveLength(2);
    const bobMessages = getSentMessages(bob.ws);
    expect(bobMessages.some((m: any) => m.type === 'host_changed' || m.type === 'player_left')).toBe(false);
    // NOTE: like the test above, this does not fail against pre-sweep code
    // (no sweep also never transfers host). It locks in the "must not fire
    // inside the grace window" requirement against a sweep implementation
    // that checks disconnectedAt but botches the grace comparison.
  });

  it('never sweeps mid-game, even if disconnectedAt is somehow already past the grace window (waiting-phase-only gate)', async () => {
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
        {
          id: 'p1', username: 'alice', avatar: { emoji: 'x', name: 'X' }, connectedAt: now, score: 0,
          disconnectedAt: now - 61_000, // stale marker, well past the grace window
        },
        { id: 'p2', username: 'bob', avatar: { emoji: 'y', name: 'Y' }, connectedAt: now, score: 0 },
      ],
      questions: [
        { id: 'q1', text: 'Q1?', options: ['a', 'b', 'c', 'd'], correctIndex: 1, categoryId: 'general' },
      ],
      currentQuestionIndex: 0,
      scores: { p1: 0, p2: 0 },
      streaks: { p1: 0, p2: 0 },
      answersThisRound: {},
      answerTimesThisRound: {},
      answersByQuestion: {},
      questionStartedAt: now,
      lastScoredQuestionIndex: -1,
      nextAlarmAction: 'end_question',
      createdAt: now,
      rejoinTokens: { p1: 'token-p1', p2: 'token-p2' },
    });
    const room = new GameRoom(state, env);
    // Let blockConcurrencyWhile load the stored state
    await new Promise((resolve) => setTimeout(resolve, 0));

    const bobWs = createMockWebSocket();
    bobWs.serializeAttachment('p2');
    state.acceptWebSocket(bobWs);

    await room.webSocketMessage(bobWs, JSON.stringify({ type: 'ping' }));

    const stored = state._storage.get('room') as any;
    expect(stored.players).toHaveLength(2);
    expect(stored.hostId).toBe('p1');
    expect(stored.players.find((p: any) => p.id === 'p1').disconnectedAt).toBe(now - 61_000);
  });

  it('clears a stale disconnected marker instead of evicting a player who genuinely still has a live socket', async () => {
    const { room, state } = await createInitializedRoom();
    const alice = await joinPlayer(room, state, 'alice');
    const bob = await joinPlayer(room, state, 'bob');

    // A marker set without the socket ever actually dropping (defensive
    // edge case — handleRejoin already clears the marker on every real
    // reconnect; this covers a socket that never went through it)
    await arrangeRoom(room, state, (live) => {
      live.players.find((p: any) => p.id === alice.playerId).disconnectedAt = Date.now() - 61_000;
    });

    await room.webSocketMessage(bob.ws, JSON.stringify({ type: 'ping' }));

    // Not evicted — alice's original socket is still in the live set. The
    // stale marker was arranged into storage too, so clearing it only in
    // memory would still read as stale here.
    const lastPersisted = persistedRoom(state);
    const persistedAlice = lastPersisted.players.find((p: any) => p.id === alice.playerId);
    expect(persistedAlice).toBeDefined();
    expect(persistedAlice.disconnectedAt).toBeUndefined();
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

describe('GameRoom rejoin during the between-questions pause (stale question fix)', () => {
  const QUESTIONS = [
    { id: 'q1', text: 'Q1?', options: ['a', 'b', 'c', 'd'], correctIndex: 1, categoryId: 'general' },
    { id: 'q2', text: 'Q2?', options: ['e', 'f', 'g', 'h'], correctIndex: 0, categoryId: 'general' },
  ];

  async function createPlayingRoomWithTokens() {
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
        { id: 'p1', username: 'alice', avatar: { emoji: '🐕', name: 'Dog' }, connectedAt: now, score: 0 },
        { id: 'p2', username: 'bob', avatar: { emoji: '🐈', name: 'Cat' }, connectedAt: now, score: 0 },
      ],
      questions: QUESTIONS,
      currentQuestionIndex: 0,
      scores: { p1: 0, p2: 0 },
      streaks: { p1: 0, p2: 0 },
      answersThisRound: { p1: 1 }, // alice answered correctly; bob dropped before answering
      answerTimesThisRound: { p1: now },
      answersByQuestion: {},
      questionStartedAt: now - 1000,
      lastScoredQuestionIndex: -1,
      nextAlarmAction: 'end_question',
      createdAt: now,
      rejoinTokens: { p1: 'token-p1', p2: 'token-p2' },
    });
    const room = new GameRoom(state, env);
    // Let blockConcurrencyWhile load the stored state
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { room, state };
  }

  it('resends the question plus the matching answer_result (not a live question) when rejoining mid-pause', async () => {
    const { room, state } = await createPlayingRoomWithTokens();

    // Scores question 0; phase stays 'playing' and currentQuestionIndex stays
    // 0 for the whole between-questions pause (advanceOrFinish hasn't run)
    await (room as any).endCurrentQuestion();
    const midPause = state._storage.get('room') as any;
    expect(midPause.phase).toBe('playing');
    expect(midPause.lastScoredQuestionIndex).toBe(0);
    expect(midPause.currentQuestionIndex).toBe(0);

    // Bob reconnects while everyone else is looking at the revealed answer
    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);
    await room.webSocketMessage(
      ws,
      JSON.stringify({ type: 'rejoin_game', gameId: 'TEST-0001', username: 'bob', rejoinToken: 'token-p2' }),
    );

    const messages = getSentMessages(ws);
    const questionMsg = messages.find((m) => m.type === 'question');
    const resultMsg = messages.find((m) => m.type === 'answer_result');

    expect(questionMsg).toBeDefined();
    expect(questionMsg.questionIndex).toBe(0);
    // Closed, not live — there's no time left to answer it
    expect(questionMsg.remainingMs).toBe(0);

    expect(resultMsg).toBeDefined();
    expect(resultMsg.correctIndex).toBe(1);
    expect(resultMsg.correct).toBe(false); // bob never got an answer in
  });

  it('still resends a live question with no answer_result when rejoining before the question is scored', async () => {
    const { room, state } = await createPlayingRoomWithTokens();
    // lastScoredQuestionIndex is -1, currentQuestionIndex is 0 — still live

    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);
    await room.webSocketMessage(
      ws,
      JSON.stringify({ type: 'rejoin_game', gameId: 'TEST-0001', username: 'bob', rejoinToken: 'token-p2' }),
    );

    const messages = getSentMessages(ws);
    expect(messages.some((m) => m.type === 'answer_result')).toBe(false);
    const questionMsg = messages.find((m) => m.type === 'question');
    expect(questionMsg).toBeDefined();
    expect(questionMsg.remainingMs).toBeGreaterThan(0);
  });

  it('rejects a late submit_answer for a question that has already been scored', async () => {
    const { room, state } = await createPlayingRoomWithTokens();

    await (room as any).endCurrentQuestion(); // scores question 0

    const ws = createMockWebSocket();
    ws.serializeAttachment('p2'); // bob, who never got an answer in before scoring
    state.acceptWebSocket(ws);

    await room.webSocketMessage(ws, JSON.stringify({ type: 'submit_answer', questionIndex: 0, answerIndex: 2 }));

    const stored = state._storage.get('room') as any;
    expect(stored.answersThisRound.p2).toBeUndefined();
    expect(stored.answerTimesThisRound.p2).toBeUndefined();
  });

  it('still accepts a timely submit_answer for the current, unscored question', async () => {
    const { room, state } = await createPlayingRoomWithTokens();

    const ws = createMockWebSocket();
    ws.serializeAttachment('p2');
    state.acceptWebSocket(ws);

    await room.webSocketMessage(ws, JSON.stringify({ type: 'submit_answer', questionIndex: 0, answerIndex: 2 }));

    const stored = state._storage.get('room') as any;
    expect(stored.answersThisRound.p2).toBe(2);
  });
});
