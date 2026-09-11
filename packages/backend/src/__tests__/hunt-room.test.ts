import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScavengerHuntRoom } from '../hunt-room';
import {
  createMockDurableObjectState,
  createMockWebSocket,
  createMockEnv,
  getSentMessages,
  getLastMessage,
} from './mocks';
import type { MockDurableObjectState, MockWebSocket } from './mocks';
import type { Env } from '../env';
import { HUNT_EXPIRY_MS, HUNT_LIMITS } from '@lamo-trivia/shared';

/**
 * Stub the vision module so submit_photo can reach a real verdict.
 *
 * Until this existed the mock env had no ANTHROPIC_API_KEY, so every
 * submit_photo threw at getAnthropicKey before R2 was even touched: all three
 * verdict branches, every rememberCompletedUpload on a verdict, every
 * clearRefundedFailures, the R2-missing refund and the supersession guard had
 * zero execution in the whole suite. Tests that don't opt in still use the
 * keyless env and still exercise the failure path.
 */
const vision = vi.hoisted(() => ({
  impl: null as null | ((...args: unknown[]) => Promise<unknown>),
}));

vi.mock('../vision', () => ({
  VERIFICATION_MODEL: 'claude-sonnet-5',
  COMPARISON_MODEL: 'claude-haiku-4-5',
  verifyAndCompare: async (...args: unknown[]) => {
    if (!vision.impl) throw new Error('verifyAndCompare called without a stub');
    return vision.impl(...args);
  },
}));

beforeEach(() => {
  vision.impl = null;
});

/** A ComparisonResult carrying the given Sonnet verdict. */
function verdict(accepted: boolean, reason = accepted ? 'Looks right' : 'Wrong item') {
  return {
    sonnetResult: { accepted, confidence: 0.9, reason },
    comparison: {
      haikuResult: { accepted, confidence: 0.9, reason },
      agreement: true,
      sonnetLatencyMs: 10,
      haikuLatencyMs: 10,
    },
  };
}

/**
 * An env whose verification path actually runs end to end: a key for
 * getAnthropicKey and an R2 object for the photo fetch.
 */
function createVerifyingEnv(): Env {
  const env = createMockEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' });
  (env.R2_HUNT_PHOTOS as any).get = async () => ({
    arrayBuffer: async () => new ArrayBuffer(8),
    httpMetadata: { contentType: 'image/jpeg' },
  });
  return env;
}

/** Let an in-flight handler run up to its next awaited I/O. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The DO's live in-memory room — the object its handlers actually read and
 * mutate.
 *
 * mocks.ts snapshots on both read and write now (as the real DO storage API
 * does), so `storage.get('room')` hands back a copy. Arranging a scenario, or
 * holding a handle that stays live across a handler call, has to go through
 * this instead; poking at the copy changes nothing a handler will ever see.
 */
function liveRoom(room: ScavengerHuntRoom): any {
  return (room as unknown as { room: any }).room;
}

// --- Test config ---

function makeHuntConfig(overrides: Record<string, unknown> = {}) {
  return {
    huntId: 'HUNT-TEST',
    name: 'Test Hunt',
    items: [
      {
        id: 'item-1',
        description: 'A red fire hydrant',
        basePoints: 1000,
        clues: [
          { id: 'clue-1a', text: 'Look near the street corner', pointCost: 200 },
          { id: 'clue-1b', text: 'It is bright red', pointCost: 200 },
        ],
      },
      {
        id: 'item-2',
        description: 'A blue mailbox',
        basePoints: 1000,
        clues: [
          { id: 'clue-2a', text: 'Near the post office', pointCost: 200 },
        ],
      },
      {
        id: 'item-3',
        description: 'A park bench',
        basePoints: 1000,
        clues: [
          { id: 'clue-3a', text: 'In the green area', pointCost: 200 },
          { id: 'clue-3b', text: 'People sit on it', pointCost: 200 },
        ],
      },
    ],
    durationMinutes: 30,
    maxRetries: 3,
    basePointsPerItem: 1000,
    hintPointCost: 200,
    minPlayers: 1,
    maxPlayers: 8,
    isPrivate: false,
    ...overrides,
  };
}

async function createInitializedHunt(
  overrides: Record<string, unknown> = {},
  env: Env = createMockEnv(),
) {
  const state = createMockDurableObjectState();
  const room = new ScavengerHuntRoom(state, env);

  const config = makeHuntConfig(overrides);
  const response = await room.fetch(
    new Request('http://internal/config', {
      method: 'POST',
      body: JSON.stringify(config),
    }),
  );

  const data = (await response.json()) as any;
  expect(data.ok).toBe(true);

  return { state, env, room };
}

async function joinPlayer(
  room: ScavengerHuntRoom,
  state: MockDurableObjectState,
  username: string,
): Promise<MockWebSocket> {
  const ws = createMockWebSocket();
  state.acceptWebSocket(ws);
  await room.webSocketMessage(
    ws,
    JSON.stringify({ type: 'join_hunt', huntId: 'HUNT-TEST', username }),
  );
  return ws;
}

/** Fetch the persisted rejoin token issued to a player at join time. */
async function getRejoinToken(
  state: MockDurableObjectState,
  username: string,
): Promise<string> {
  const stored = (await state.storage.get('room')) as any;
  const player = stored.players.find(
    (p: any) => p.username.toLowerCase() === username.toLowerCase(),
  );
  return stored.rejoinTokens[player.id];
}

/**
 * Helper: join host + one player, start the hunt, enter playing phase.
 * Returns { hostWs, playerWs, hostId, playerId }.
 */
async function startHuntWithPlayer(
  room: ScavengerHuntRoom,
  state: MockDurableObjectState,
) {
  const hostWs = await joinPlayer(room, state, 'Host');
  const playerWs = await joinPlayer(room, state, 'Player1');
  hostWs._sent.length = 0;
  playerWs._sent.length = 0;

  // Start the hunt (host starts)
  await room.webSocketMessage(hostWs, JSON.stringify({ type: 'start_hunt' }));
  hostWs._sent.length = 0;
  playerWs._sent.length = 0;

  // Trigger start_playing alarm to enter playing phase
  await room.alarm();
  hostWs._sent.length = 0;
  playerWs._sent.length = 0;

  const stored = (await state.storage.get('room')) as any;
  const hostId = stored.players.find((p: any) => p.username === 'Host').id;
  const playerId = stored.players.find((p: any) => p.username === 'Player1').id;

  return { hostWs, playerWs, hostId, playerId };
}

// ============================================================
// Tests
// ============================================================

describe('ScavengerHuntRoom -- Config', () => {
  it('POST /config validates input and rejects invalid config', async () => {
    const state = createMockDurableObjectState();
    const env = createMockEnv();
    const room = new ScavengerHuntRoom(state, env);

    // Missing huntId
    const res1 = await room.fetch(
      new Request('http://internal/config', {
        method: 'POST',
        body: JSON.stringify({ name: 'Bad Hunt', items: [] }),
      }),
    );
    expect(res1.status).toBe(400);
    const data1 = (await res1.json()) as any;
    expect(data1.error).toBe('Missing huntId');

    // Invalid config (no items)
    const res2 = await room.fetch(
      new Request('http://internal/config', {
        method: 'POST',
        body: JSON.stringify({
          huntId: 'HUNT-BAD',
          name: 'Bad Hunt',
          items: [],
          durationMinutes: 30,
          maxRetries: 3,
          basePointsPerItem: 1000,
          hintPointCost: 200,
          minPlayers: 1,
          maxPlayers: 8,
          isPrivate: false,
        }),
      }),
    );
    expect(res2.status).toBe(400);
    const data2 = (await res2.json()) as any;
    expect(data2.error).toBe('Invalid hunt config');
  });

  it('POST /config initializes room state correctly', async () => {
    const { state } = await createInitializedHunt();

    const stored = (await state.storage.get('room')) as any;
    expect(stored).toBeDefined();
    expect(stored.huntId).toBe('HUNT-TEST');
    expect(stored.phase).toBe('waiting');
    expect(stored.hostId).toBe('');
    expect(stored.players).toEqual([]);
    expect(stored.items).toHaveLength(3);
    expect(stored.progress).toEqual({});
    expect(stored.pendingAppeals).toEqual([]);
    expect(stored.nextAlarmAction).toBe('expire_hunt');
    expect(stored.createdAt).toBeGreaterThan(0);
  });

  it('POST /config sets expiry alarm', async () => {
    const { state } = await createInitializedHunt();

    expect(state._alarm).not.toBeNull();
    // Alarm should be set roughly HUNT_EXPIRY_MS from now
    const now = Date.now();
    expect(state._alarm!).toBeGreaterThanOrEqual(now);
    expect(state._alarm!).toBeLessThanOrEqual(now + HUNT_EXPIRY_MS + 1000);
  });
});

describe('ScavengerHuntRoom -- Join/Leave', () => {
  let state: MockDurableObjectState;
  let env: Env;
  let room: ScavengerHuntRoom;

  beforeEach(async () => {
    const initialized = await createInitializedHunt();
    state = initialized.state;
    env = initialized.env;
    room = initialized.room;
  });

  it('join_hunt adds player and sends join_confirmed + hunt_state', async () => {
    const ws = await joinPlayer(room, state, 'Alice');

    const msgs = getSentMessages(ws);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].type).toBe('join_confirmed');
    expect(msgs[0].rejoinToken).toBeTruthy();
    expect(msgs[1].type).toBe('hunt_state');
    expect(msgs[1].state.id).toBe('HUNT-TEST');
    expect(msgs[1].state.phase).toBe('waiting');
    expect(msgs[1].state.players).toHaveLength(1);
    expect(msgs[1].state.players[0].username).toBe('Alice');
  });

  it('join_hunt broadcasts player_joined to others', async () => {
    const ws1 = await joinPlayer(room, state, 'Alice');
    ws1._sent.length = 0;

    const ws2 = await joinPlayer(room, state, 'Bob');

    // ws2 gets join_confirmed then hunt_state
    const ws2Msgs = getSentMessages(ws2);
    expect(ws2Msgs[0].type).toBe('join_confirmed');
    expect(ws2Msgs[1].type).toBe('hunt_state');
    expect(ws2Msgs[1].state.players).toHaveLength(2);

    // ws1 gets player_joined broadcast
    const ws1Msgs = getSentMessages(ws1);
    expect(ws1Msgs.some((m: any) => m.type === 'player_joined')).toBe(true);
    const joinedMsg = ws1Msgs.find((m: any) => m.type === 'player_joined');
    expect(joinedMsg.player.username).toBe('Bob');
  });

  it('join_hunt first player becomes host', async () => {
    const ws = await joinPlayer(room, state, 'Alice');

    const msgs = getSentMessages(ws);
    const huntState = msgs.find((m: any) => m.type === 'hunt_state').state;
    expect(huntState.hostId).toBe(huntState.players[0].id);
  });

  it('join_hunt re-attaches duplicate usernames during waiting phase (case insensitive)', async () => {
    await joinPlayer(room, state, 'Alice');
    const token = await getRejoinToken(state, 'Alice');

    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await room.webSocketMessage(
      ws2,
      JSON.stringify({ type: 'join_hunt', huntId: 'HUNT-TEST', username: 'alice', rejoinToken: token }),
    );

    const msgs = getSentMessages(ws2);
    expect(msgs[0].type).toBe('join_confirmed');
    expect(msgs[1].type).toBe('hunt_state');
    // Should re-attach to existing player, not create a new one
    expect(msgs[1].state.players).toHaveLength(1);
  });

  it('join_hunt rejects a duplicate username without the rejoin token', async () => {
    await joinPlayer(room, state, 'Alice');

    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await room.webSocketMessage(
      ws2,
      JSON.stringify({ type: 'join_hunt', huntId: 'HUNT-TEST', username: 'alice' }),
    );

    const msgs = getSentMessages(ws2);
    expect(msgs[0].type).toBe('error');
    expect(msgs[0].code).toBe('USERNAME_TAKEN');
  });

  it('join_hunt rejects when hunt is full', async () => {
    // Create a hunt with maxPlayers: 2
    const initialized = await createInitializedHunt({ maxPlayers: 2 });
    const smallState = initialized.state;
    const smallRoom = initialized.room;

    await joinPlayer(smallRoom, smallState, 'Alice');
    await joinPlayer(smallRoom, smallState, 'Bob');

    const ws3 = createMockWebSocket();
    smallState.acceptWebSocket(ws3);
    await smallRoom.webSocketMessage(
      ws3,
      JSON.stringify({ type: 'join_hunt', huntId: 'HUNT-TEST', username: 'Charlie' }),
    );

    const msgs = getSentMessages(ws3);
    expect(msgs[0].type).toBe('error');
    expect(msgs[0].code).toBe('HUNT_FULL');
  });

  it('join_hunt rejects after hunt started', async () => {
    const ws1 = await joinPlayer(room, state, 'Alice');
    const ws2 = await joinPlayer(room, state, 'Bob');
    ws1._sent.length = 0;
    ws2._sent.length = 0;

    // Start the hunt (now Alice is host, Bob is the participant)
    await room.webSocketMessage(ws1, JSON.stringify({ type: 'start_hunt' }));
    ws1._sent.length = 0;

    // Try to join after start
    const ws3 = createMockWebSocket();
    state.acceptWebSocket(ws3);
    await room.webSocketMessage(
      ws3,
      JSON.stringify({ type: 'join_hunt', huntId: 'HUNT-TEST', username: 'Charlie' }),
    );

    const msgs = getSentMessages(ws3);
    expect(msgs[0].type).toBe('error');
    expect(msgs[0].code).toBe('HUNT_STARTED');
  });

  it('join_hunt rejects invalid username (too short, special chars) via UsernameSchema', async () => {
    // Too short (1 char)
    const ws1 = createMockWebSocket();
    state.acceptWebSocket(ws1);
    await room.webSocketMessage(
      ws1,
      JSON.stringify({ type: 'join_hunt', huntId: 'HUNT-TEST', username: 'A' }),
    );

    const msgs1 = getSentMessages(ws1);
    expect(msgs1[0].type).toBe('error');
    expect(msgs1[0].message).toBe('Invalid message format');

    // Special characters
    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await room.webSocketMessage(
      ws2,
      JSON.stringify({ type: 'join_hunt', huntId: 'HUNT-TEST', username: 'Al!ce@#' }),
    );

    const msgs2 = getSentMessages(ws2);
    expect(msgs2[0].type).toBe('error');
    expect(msgs2[0].message).toBe('Invalid message format');
  });

  it('leave_hunt removes player and broadcasts', async () => {
    const ws1 = await joinPlayer(room, state, 'Alice');
    const ws2 = await joinPlayer(room, state, 'Bob');
    ws1._sent.length = 0;
    ws2._sent.length = 0;

    await room.webSocketMessage(ws2, JSON.stringify({ type: 'leave_hunt' }));

    // ws1 should receive player_left
    const ws1Msgs = getSentMessages(ws1);
    expect(ws1Msgs.some((m: any) => m.type === 'player_left')).toBe(true);

    // Verify player list in storage
    const stored = (await state.storage.get('room')) as any;
    expect(stored.players).toHaveLength(1);
    expect(stored.players[0].username).toBe('Alice');
  });

  it('leave_hunt transfers host to next player', async () => {
    const ws1 = await joinPlayer(room, state, 'Alice');
    const ws2 = await joinPlayer(room, state, 'Bob');
    ws1._sent.length = 0;
    ws2._sent.length = 0;

    // Alice (host) leaves
    await room.webSocketMessage(ws1, JSON.stringify({ type: 'leave_hunt' }));

    // ws2 should get player_left with newHostId
    const ws2Msgs = getSentMessages(ws2);
    const leftMsg = ws2Msgs.find((m: any) => m.type === 'player_left');
    expect(leftMsg).toBeDefined();
    expect(leftMsg.newHostId).toBeDefined();

    // Verify storage
    const stored = (await state.storage.get('room')) as any;
    expect(stored.hostId).toBe(stored.players[0].id);
  });

  it('webSocketClose marks the player disconnected; sweep removes them after the grace period', async () => {
    const ws1 = await joinPlayer(room, state, 'Alice');
    const ws2 = await joinPlayer(room, state, 'Bob');
    ws1._sent.length = 0;
    ws2._sent.length = 0;

    // Drop Bob's socket and close it — within the grace period he stays
    state._webSockets = state._webSockets.filter((w: any) => w !== ws2);
    await room.webSocketClose(ws2);

    let stored = liveRoom(room);
    expect(stored.players).toHaveLength(2);
    const bob = stored.players.find((p: any) => p.username === 'Bob');
    expect(bob.disconnectedAt).toBeDefined();

    // Past the grace period, the next message sweeps him out
    bob.disconnectedAt = Date.now() - 61_000;
    await room.webSocketMessage(ws1, JSON.stringify({ type: 'ping' }));

    stored = (await state.storage.get('room')) as any;
    expect(stored.players).toHaveLength(1);
    expect(stored.players[0].username).toBe('Alice');
    expect(getSentMessages(ws1).some((m: any) => m.type === 'player_left')).toBe(true);
  });
});

describe('ScavengerHuntRoom -- Start Hunt', () => {
  let state: MockDurableObjectState;
  let env: Env;
  let room: ScavengerHuntRoom;

  beforeEach(async () => {
    const initialized = await createInitializedHunt();
    state = initialized.state;
    env = initialized.env;
    room = initialized.room;
  });

  it('start_hunt only host can start', async () => {
    const ws1 = await joinPlayer(room, state, 'Alice');
    const ws2 = await joinPlayer(room, state, 'Bob');
    ws1._sent.length = 0;
    ws2._sent.length = 0;

    // Bob (not host) tries to start
    await room.webSocketMessage(ws2, JSON.stringify({ type: 'start_hunt' }));

    const msgs = getSentMessages(ws2);
    expect(msgs[0].type).toBe('error');
    expect(msgs[0].message).toBe('Only the host can start the hunt');
  });

  it('start_hunt requires minimum players (including host)', async () => {
    // Create hunt with minPlayers: 3
    const initialized = await createInitializedHunt({ minPlayers: 3 });
    const s = initialized.state;
    const r = initialized.room;

    // Host + one player = 2 players (< 3)
    const ws1 = await joinPlayer(r, s, 'Alice');
    const ws2 = await joinPlayer(r, s, 'Bob');
    ws1._sent.length = 0;

    await r.webSocketMessage(ws1, JSON.stringify({ type: 'start_hunt' }));

    const msgs = getSentMessages(ws1);
    expect(msgs[0].type).toBe('error');
    expect(msgs[0].message).toContain('Need at least 3 teams');
  });

  it('start_hunt initializes progress for all players including host', async () => {
    const ws1 = await joinPlayer(room, state, 'Alice');
    const ws2 = await joinPlayer(room, state, 'Bob');
    ws1._sent.length = 0;
    ws2._sent.length = 0;

    // Host (Alice) starts the hunt
    await room.webSocketMessage(ws1, JSON.stringify({ type: 'start_hunt' }));

    const stored = (await state.storage.get('room')) as any;
    const hostId = stored.hostId;
    const bobId = stored.players.find((p: any) => p.username === 'Bob').id;

    // Host should have progress (host plays too)
    expect(stored.progress[hostId]).toBeDefined();
    expect(stored.progress[hostId].playerId).toBe(hostId);
    expect(stored.progress[hostId].totalScore).toBe(0);

    // Bob (participant) should have progress
    expect(stored.progress[bobId]).toBeDefined();
    expect(stored.progress[bobId].playerId).toBe(bobId);
    expect(stored.progress[bobId].totalScore).toBe(0);

    // Both should have progress for all 3 items
    for (const pid of [hostId, bobId]) {
      const itemIds = Object.keys(stored.progress[pid].items);
      expect(itemIds).toHaveLength(3);

      for (const itemId of itemIds) {
        expect(stored.progress[pid].items[itemId].status).toBe('searching');
        expect(stored.progress[pid].items[itemId].cluesRevealed).toEqual([]);
        expect(stored.progress[pid].items[itemId].attemptsUsed).toBe(0);
      }
    }
  });

  it('start_hunt sets phase to starting and schedules alarm', async () => {
    const ws1 = await joinPlayer(room, state, 'Alice');
    const ws2 = await joinPlayer(room, state, 'Bob');
    ws1._sent.length = 0;
    ws2._sent.length = 0;

    await room.webSocketMessage(ws1, JSON.stringify({ type: 'start_hunt' }));

    const stored = (await state.storage.get('room')) as any;
    expect(stored.phase).toBe('starting');
    expect(stored.nextAlarmAction).toBe('start_playing');
    expect(stored.startedAt).toBeGreaterThan(0);

    // Should have set an alarm (~3 seconds from now)
    expect(state._alarm).not.toBeNull();

    // Players should receive hunt_starting message
    const msgs = getSentMessages(ws1);
    expect(msgs.some((m: any) => m.type === 'hunt_starting')).toBe(true);
    const startingMsg = msgs.find((m: any) => m.type === 'hunt_starting');
    expect(startingMsg.countdown).toBe(3);
  });

  it('alarm with start_playing transitions to playing phase', async () => {
    const ws1 = await joinPlayer(room, state, 'Alice');
    const ws2 = await joinPlayer(room, state, 'Bob');
    ws1._sent.length = 0;
    ws2._sent.length = 0;

    // Start the hunt
    await room.webSocketMessage(ws1, JSON.stringify({ type: 'start_hunt' }));
    ws1._sent.length = 0;
    ws2._sent.length = 0;

    // Trigger the alarm (simulating the 3-second countdown)
    await room.alarm();

    const stored = (await state.storage.get('room')) as any;
    expect(stored.phase).toBe('playing');
    expect(stored.endsAt).toBeGreaterThan(0);

    // Should broadcast hunt_started to participant
    const msgs = getSentMessages(ws2);
    expect(msgs.some((m: any) => m.type === 'hunt_started')).toBe(true);
    const startedMsg = msgs.find((m: any) => m.type === 'hunt_started');
    expect(startedMsg.items).toHaveLength(3);
    expect(startedMsg.endsAt).toBe(stored.endsAt);

    // Should set next alarm for time_warning_5 (30 min hunt > 5 min)
    expect(stored.nextAlarmAction).toBe('time_warning_5');
    expect(state._alarm).not.toBeNull();
  });
});

describe('ScavengerHuntRoom -- Reveal Clue', () => {
  let state: MockDurableObjectState;
  let room: ScavengerHuntRoom;
  let hostWs: MockWebSocket;
  let playerWs: MockWebSocket;
  let playerId: string;

  beforeEach(async () => {
    const initialized = await createInitializedHunt();
    state = initialized.state;
    room = initialized.room;

    const started = await startHuntWithPlayer(room, state);
    hostWs = started.hostWs;
    playerWs = started.playerWs;
    playerId = started.playerId;
  });

  it('reveal_clue deducts points and sends clue text', async () => {
    await room.webSocketMessage(
      playerWs,
      JSON.stringify({ type: 'reveal_clue', itemId: 'item-1', clueId: 'clue-1a' }),
    );

    const msgs = getSentMessages(playerWs);
    const clueMsg = msgs.find((m: any) => m.type === 'clue_revealed');
    expect(clueMsg).toBeDefined();
    expect(clueMsg.itemId).toBe('item-1');
    expect(clueMsg.clueId).toBe('clue-1a');
    expect(clueMsg.clueText).toBe('Look near the street corner');
    expect(clueMsg.newScore).toBe(-200); // Started at 0, deducted 200
  });

  it('reveal_clue rejects already-revealed clue', async () => {
    // Reveal the clue once
    await room.webSocketMessage(
      playerWs,
      JSON.stringify({ type: 'reveal_clue', itemId: 'item-1', clueId: 'clue-1a' }),
    );
    playerWs._sent.length = 0;

    // Try to reveal the same clue again
    await room.webSocketMessage(
      playerWs,
      JSON.stringify({ type: 'reveal_clue', itemId: 'item-1', clueId: 'clue-1a' }),
    );

    const msgs = getSentMessages(playerWs);
    expect(msgs[0].type).toBe('error');
    expect(msgs[0].message).toBe('Clue already revealed');
  });

  it('reveal_clue rejects for found items', async () => {
    // Directly mark item as found on the in-memory room state
    const internalRoom = (room as any).room;
    internalRoom.progress[playerId].items['item-1'].status = 'found';

    await room.webSocketMessage(
      playerWs,
      JSON.stringify({ type: 'reveal_clue', itemId: 'item-1', clueId: 'clue-1a' }),
    );

    const msgs = getSentMessages(playerWs);
    expect(msgs[0].type).toBe('error');
    expect(msgs[0].message).toBe('Item already found');
  });

  it('reveal_clue rejects invalid item/clue IDs', async () => {
    // Invalid item ID
    await room.webSocketMessage(
      playerWs,
      JSON.stringify({ type: 'reveal_clue', itemId: 'item-nonexistent', clueId: 'clue-1a' }),
    );

    const msgs1 = getSentMessages(playerWs);
    expect(msgs1[0].type).toBe('error');
    expect(msgs1[0].message).toBe('Item not found');

    playerWs._sent.length = 0;

    // Invalid clue ID on valid item
    await room.webSocketMessage(
      playerWs,
      JSON.stringify({ type: 'reveal_clue', itemId: 'item-1', clueId: 'clue-nonexistent' }),
    );

    const msgs2 = getSentMessages(playerWs);
    expect(msgs2[0].type).toBe('error');
    expect(msgs2[0].message).toBe('Clue not found');
  });

  it('reveal_clue allowed for host (host plays too)', async () => {
    hostWs._sent.length = 0;

    await room.webSocketMessage(
      hostWs,
      JSON.stringify({ type: 'reveal_clue', itemId: 'item-1', clueId: 'clue-1a' }),
    );

    const msgs = getSentMessages(hostWs);
    expect(msgs[0].type).toBe('clue_revealed');
    expect(msgs[0].itemId).toBe('item-1');
    expect(msgs[0].clueId).toBe('clue-1a');
  });

  it('reveal_clue sends teams_updated to host', async () => {
    hostWs._sent.length = 0;

    await room.webSocketMessage(
      playerWs,
      JSON.stringify({ type: 'reveal_clue', itemId: 'item-1', clueId: 'clue-1a' }),
    );

    const hostMsgs = getSentMessages(hostWs);
    const teamsUpdate = hostMsgs.find((m: any) => m.type === 'teams_updated');
    expect(teamsUpdate).toBeDefined();
    // Teams now include host (2 players total)
    expect(teamsUpdate.teams).toHaveLength(2);
    const player1Team = teamsUpdate.teams.find((t: any) => t.username === 'Player1');
    expect(player1Team).toBeDefined();
    expect(player1Team.totalScore).toBe(-200);
  });
});

describe('ScavengerHuntRoom -- Claim Host', () => {
  let state: MockDurableObjectState;
  let room: ScavengerHuntRoom;

  beforeEach(async () => {
    const initialized = await createInitializedHunt();
    state = initialized.state;
    room = initialized.room;
  });

  it('claim_host only works when current host is disconnected', async () => {
    const ws1 = await joinPlayer(room, state, 'Alice');
    const ws2 = await joinPlayer(room, state, 'Bob');
    ws1._sent.length = 0;
    ws2._sent.length = 0;

    // Simulate Alice disconnecting by removing her WebSocket from the list
    // WITHOUT calling handleLeave (so she remains in players but has no WS)
    const idx = state._webSockets.indexOf(ws1);
    if (idx !== -1) state._webSockets.splice(idx, 1);

    // Bob claims host
    await room.webSocketMessage(ws2, JSON.stringify({ type: 'claim_host' }));

    const msgs = getSentMessages(ws2);
    const hostChanged = msgs.find((m: any) => m.type === 'host_changed');
    expect(hostChanged).toBeDefined();

    const stored = (await state.storage.get('room')) as any;
    const bobId = ws2.deserializeAttachment() as string;
    expect(stored.hostId).toBe(bobId);
  });

  it('claim_host rejects when current host is still connected', async () => {
    const ws1 = await joinPlayer(room, state, 'Alice');
    const ws2 = await joinPlayer(room, state, 'Bob');
    ws1._sent.length = 0;
    ws2._sent.length = 0;

    // Bob tries to claim host while Alice is still connected
    await room.webSocketMessage(ws2, JSON.stringify({ type: 'claim_host' }));

    const msgs = getSentMessages(ws2);
    expect(msgs[0].type).toBe('error');
    expect(msgs[0].message).toBe('Current host is still connected');
  });

  it('claim_host during playing requires the current host to be disconnected', async () => {
    const { hostWs, playerWs } = await startHuntWithPlayer(room, state);

    // Host still connected → rejected
    await room.webSocketMessage(playerWs, JSON.stringify({ type: 'claim_host' }));
    const rejected = getSentMessages(playerWs).find((m: any) => m.type === 'error');
    expect(rejected.message).toBe('Current host is still connected');

    // Host's socket gone → claim succeeds
    state._webSockets = state._webSockets.filter((w: any) => w !== hostWs);
    playerWs._sent.length = 0;
    await room.webSocketMessage(playerWs, JSON.stringify({ type: 'claim_host' }));

    const msgs = getSentMessages(playerWs);
    expect(msgs.some((m: any) => m.type === 'host_changed')).toBe(true);
  });
});

describe('ScavengerHuntRoom -- Security', () => {
  let state: MockDurableObjectState;
  let room: ScavengerHuntRoom;

  beforeEach(async () => {
    const initialized = await createInitializedHunt();
    state = initialized.state;
    room = initialized.room;
  });

  it('rejects oversized messages (>8192 chars)', async () => {
    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);

    const oversizedMessage = JSON.stringify({
      type: 'join_hunt',
      huntId: 'HUNT-TEST',
      username: 'A'.repeat(9000),
    });
    expect(oversizedMessage.length).toBeGreaterThan(8192);

    await room.webSocketMessage(ws, oversizedMessage);

    const msgs = getSentMessages(ws);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ type: 'error', message: 'Message too large' });
  });

  it('rate limits excessive messages', async () => {
    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);

    // Send 31 pings (limit is 30 per 10s window — the 31st should be rate limited)
    for (let i = 0; i < 31; i++) {
      await room.webSocketMessage(ws, JSON.stringify({ type: 'ping' }));
    }

    const msgs = getSentMessages(ws);
    // First 30 messages get pong, 31st triggers rate limit error
    expect(msgs).toHaveLength(31);
    // First 30 should be pongs
    for (let i = 0; i < 30; i++) {
      expect(msgs[i].type).toBe('pong');
    }
    // 31st should be rate limit error
    expect(msgs[30].type).toBe('error');
    expect(msgs[30].message).toBe('Rate limit exceeded');
    expect(ws._closed).toBe(true);
  });

  it('rejects invalid message format', async () => {
    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);

    // Valid JSON but not a recognized message type
    await room.webSocketMessage(ws, JSON.stringify({ type: 'unknown_action', data: 123 }));

    const msgs = getSentMessages(ws);
    expect(msgs[0].type).toBe('error');
    expect(msgs[0].message).toBe('Invalid message format');
  });

  it('rejects binary/ArrayBuffer messages', async () => {
    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);

    const binaryMessage = new ArrayBuffer(10);
    await room.webSocketMessage(ws, binaryMessage);

    const msgs = getSentMessages(ws);
    expect(msgs[0].type).toBe('error');
    expect(msgs[0].message).toBe('Failed to parse message');
  });

  it('ping responds with pong', async () => {
    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);

    await room.webSocketMessage(ws, JSON.stringify({ type: 'ping' }));

    const msgs = getSentMessages(ws);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ type: 'pong' });
  });

  it('host can submit photos (host plays too)', async () => {
    const { state: s, room: r } = await createInitializedHunt();
    const { hostWs } = await startHuntWithPlayer(r, s);

    await r.webSocketMessage(
      hostWs,
      JSON.stringify({
        type: 'submit_photo',
        itemId: 'item-1',
        uploadId: '12345678-1234-1234-1234-123456789abc.jpg',
      }),
    );

    const msgs = getSentMessages(hostWs);
    // Host should get a photo_verifying or verification result, not an error
    expect(msgs[0].type).not.toBe('error');
  });
});

describe('ScavengerHuntRoom -- Alarm Chain', () => {
  it('expire_hunt cleans up waiting hunt', async () => {
    const { state, room } = await createInitializedHunt();

    // Add a player so we can check cleanup
    const ws = await joinPlayer(room, state, 'Alice');
    ws._sent.length = 0;

    // nextAlarmAction is already 'expire_hunt' from config initialization
    // Trigger the expire alarm directly on the same room instance
    await room.alarm();

    // Player should receive hunt_expired
    const msgs = getSentMessages(ws);
    expect(msgs.some((m: any) => m.type === 'hunt_expired')).toBe(true);

    // WebSocket should be closed
    expect(ws._closed).toBe(true);

    // Storage should be cleared
    const clearedRoom = await state.storage.get('room');
    expect(clearedRoom).toBeNull();
  });

  it('time warnings broadcast correctly', async () => {
    const { state, room } = await createInitializedHunt();

    const hostWs = await joinPlayer(room, state, 'Host');
    const playerWs = await joinPlayer(room, state, 'Player1');
    hostWs._sent.length = 0;
    playerWs._sent.length = 0;

    // Start the hunt
    await room.webSocketMessage(hostWs, JSON.stringify({ type: 'start_hunt' }));
    hostWs._sent.length = 0;
    playerWs._sent.length = 0;

    // Trigger start_playing alarm
    await room.alarm();
    hostWs._sent.length = 0;
    playerWs._sent.length = 0;

    // Now nextAlarmAction should be time_warning_5 (30 min > 5 min)
    const stored1 = (await state.storage.get('room')) as any;
    expect(stored1.nextAlarmAction).toBe('time_warning_5');

    // Trigger 5-minute warning
    await room.alarm();

    const msgs1 = getSentMessages(playerWs);
    expect(msgs1.some((m: any) => m.type === 'time_warning' && m.secondsRemaining === 300)).toBe(
      true,
    );
    playerWs._sent.length = 0;

    const stored2 = (await state.storage.get('room')) as any;
    expect(stored2.nextAlarmAction).toBe('time_warning_1');

    // Trigger 1-minute warning
    await room.alarm();

    const msgs2 = getSentMessages(playerWs);
    expect(msgs2.some((m: any) => m.type === 'time_warning' && m.secondsRemaining === 60)).toBe(
      true,
    );

    const stored3 = (await state.storage.get('room')) as any;
    expect(stored3.nextAlarmAction).toBe('end_hunt');
  });

  it('end_hunt finishes and computes results (host included)', async () => {
    const { state, room } = await createInitializedHunt();

    const hostWs = await joinPlayer(room, state, 'Host');
    const ws1 = await joinPlayer(room, state, 'Alice');
    const ws2 = await joinPlayer(room, state, 'Bob');
    hostWs._sent.length = 0;
    ws1._sent.length = 0;
    ws2._sent.length = 0;

    // Start the hunt
    await room.webSocketMessage(hostWs, JSON.stringify({ type: 'start_hunt' }));
    hostWs._sent.length = 0;
    ws1._sent.length = 0;
    ws2._sent.length = 0;

    // Trigger start_playing alarm
    await room.alarm();
    hostWs._sent.length = 0;
    ws1._sent.length = 0;
    ws2._sent.length = 0;

    // Alice reveals a clue (to have a score change)
    await room.webSocketMessage(
      ws1,
      JSON.stringify({ type: 'reveal_clue', itemId: 'item-1', clueId: 'clue-1a' }),
    );
    ws1._sent.length = 0;
    hostWs._sent.length = 0;

    // Set the in-memory alarm action to end_hunt and trigger it
    (room as any).room.nextAlarmAction = 'end_hunt';
    await room.alarm();

    // All players should receive hunt_finished
    const msgs1 = getSentMessages(ws1);
    const finishedMsg1 = msgs1.find((m: any) => m.type === 'hunt_finished');
    expect(finishedMsg1).toBeDefined();
    expect(finishedMsg1.results).toBeDefined();
    // Rankings should have 3 (Host + Alice + Bob — host plays too)
    expect(finishedMsg1.results.rankings).toHaveLength(3);

    const msgs2 = getSentMessages(ws2);
    const finishedMsg2 = msgs2.find((m: any) => m.type === 'hunt_finished');
    expect(finishedMsg2).toBeDefined();

    // Verify the results structure
    const results = finishedMsg1.results;
    expect(results.rankings[0]).toHaveProperty('score');
    expect(results.rankings[0]).toHaveProperty('itemsFound');
    expect(results.rankings[0]).toHaveProperty('totalItems', 3);
    expect(results.itemBreakdown).toBeDefined();

    // Host SHOULD be in rankings and itemBreakdown
    const stored = (await state.storage.get('room')) as any;
    expect(results.rankings.some((r: any) => r.player.id === stored.hostId)).toBe(true);
    expect(results.itemBreakdown[stored.hostId]).toBeDefined();

    // Phase should be finished
    expect(stored.phase).toBe('finished');
    expect(stored.nextAlarmAction).toBe('cleanup_hunt');
  });
});

// ============================================================
// Host Dashboard
// ============================================================

describe('ScavengerHuntRoom -- Host Dashboard', () => {
  it('host receives allTeams in hunt_state during playing phase', async () => {
    const { state, room } = await createInitializedHunt();
    const hostWs = await joinPlayer(room, state, 'Host');
    const playerWs = await joinPlayer(room, state, 'Player1');
    hostWs._sent.length = 0;
    playerWs._sent.length = 0;

    // Start + enter playing phase
    await room.webSocketMessage(hostWs, JSON.stringify({ type: 'start_hunt' }));
    await room.alarm();

    // Rejoin host to get a fresh hunt_state
    const hostToken = await getRejoinToken(state, 'Host');
    state._webSockets = state._webSockets.filter((ws: any) => ws !== hostWs);
    const hostWs2 = createMockWebSocket();
    state.acceptWebSocket(hostWs2);
    await room.webSocketMessage(
      hostWs2,
      JSON.stringify({ type: 'rejoin_hunt', huntId: 'HUNT-TEST', username: 'Host', rejoinToken: hostToken }),
    );

    const msgs = getSentMessages(hostWs2);
    const stateMsg = msgs.find((m: any) => m.type === 'hunt_state');
    expect(stateMsg).toBeDefined();
    expect(stateMsg.state.allTeams).toBeDefined();
    // allTeams now includes all players (host + Player1)
    expect(stateMsg.state.allTeams).toHaveLength(2);
    expect(stateMsg.state.allTeams.some((t: any) => t.username === 'Player1')).toBe(true);
    expect(stateMsg.state.allTeams.some((t: any) => t.username === 'Host')).toBe(true);
  });

  it('player does NOT receive allTeams in hunt_state', async () => {
    const { state, room } = await createInitializedHunt();
    const hostWs = await joinPlayer(room, state, 'Host');
    const playerWs = await joinPlayer(room, state, 'Player1');
    hostWs._sent.length = 0;
    playerWs._sent.length = 0;

    // Start + enter playing phase
    await room.webSocketMessage(hostWs, JSON.stringify({ type: 'start_hunt' }));
    await room.alarm();

    // Rejoin player to get a fresh hunt_state
    const playerToken = await getRejoinToken(state, 'Player1');
    state._webSockets = state._webSockets.filter((ws: any) => ws !== playerWs);
    const playerWs2 = createMockWebSocket();
    state.acceptWebSocket(playerWs2);
    await room.webSocketMessage(
      playerWs2,
      JSON.stringify({ type: 'rejoin_hunt', huntId: 'HUNT-TEST', username: 'Player1', rejoinToken: playerToken }),
    );

    const msgs = getSentMessages(playerWs2);
    const stateMsg = msgs.find((m: any) => m.type === 'hunt_state');
    expect(stateMsg).toBeDefined();
    expect(stateMsg.state.allTeams).toBeUndefined();
  });

  it('host receives teams_updated when player reveals a clue', async () => {
    const { state, room } = await createInitializedHunt();
    const { hostWs, playerWs } = await startHuntWithPlayer(room, state);

    hostWs._sent.length = 0;
    await room.webSocketMessage(
      playerWs,
      JSON.stringify({ type: 'reveal_clue', itemId: 'item-1', clueId: 'clue-1a' }),
    );

    const hostMsgs = getSentMessages(hostWs);
    const teamsUpdate = hostMsgs.find((m: any) => m.type === 'teams_updated');
    expect(teamsUpdate).toBeDefined();
    // Teams now include host (2 players total)
    expect(teamsUpdate.teams).toHaveLength(2);
    const player1Team = teamsUpdate.teams.find((t: any) => t.username === 'Player1');
    expect(player1Team).toBeDefined();
    expect(player1Team.totalScore).toBe(-200);
  });

  it('host progress is initialized (host plays too)', async () => {
    const { state, room } = await createInitializedHunt();
    const { hostId, playerId } = await startHuntWithPlayer(room, state);

    const stored = (await state.storage.get('room')) as any;
    expect(stored.progress[hostId]).toBeDefined();
    expect(stored.progress[playerId]).toBeDefined();
  });

  it('minPlayers check includes host', async () => {
    // minPlayers: 2, host + 1 player = 2 players, so it should start
    const { state, room } = await createInitializedHunt({ minPlayers: 2 });
    const hostWs = await joinPlayer(room, state, 'Host');
    const playerWs = await joinPlayer(room, state, 'Player1');
    hostWs._sent.length = 0;

    await room.webSocketMessage(hostWs, JSON.stringify({ type: 'start_hunt' }));

    const msgs = getSentMessages(hostWs);
    // Should succeed (2 players >= minPlayers 2)
    expect(msgs[0].type).toBe('hunt_starting');
  });
});

// ============================================================
// Rejoin / Reconnect
// ============================================================

describe('ScavengerHuntRoom -- Rejoin', () => {
  it('rejoin_hunt reconnects existing player during playing phase', async () => {
    const { state, room } = await createInitializedHunt();
    const { playerWs } = await startHuntWithPlayer(room, state);

    // Simulate disconnect of player
    const token = await getRejoinToken(state, 'Player1');
    state._webSockets = state._webSockets.filter((ws: any) => ws !== playerWs);

    // Rejoin with a new WebSocket
    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await room.webSocketMessage(
      ws2,
      JSON.stringify({ type: 'rejoin_hunt', huntId: 'HUNT-TEST', username: 'Player1', rejoinToken: token }),
    );

    const msgs = getSentMessages(ws2);
    // Should receive hunt_state then hunt_started (with items)
    expect(msgs.some((m: any) => m.type === 'hunt_state')).toBe(true);
    expect(msgs.some((m: any) => m.type === 'hunt_started')).toBe(true);

    const stateMsg = msgs.find((m: any) => m.type === 'hunt_state');
    expect(stateMsg.state.phase).toBe('playing');
    expect(stateMsg.state.myProgress).toBeDefined();

    const startedMsg = msgs.find((m: any) => m.type === 'hunt_started');
    expect(startedMsg.items).toHaveLength(3);
    expect(startedMsg.endsAt).toBeDefined();
  });

  it('rejoin_hunt reconnects and shows results during finished phase', async () => {
    const { state, room } = await createInitializedHunt();
    const hostWs = await joinPlayer(room, state, 'Host');
    const playerWs = await joinPlayer(room, state, 'Bob');
    hostWs._sent.length = 0;
    playerWs._sent.length = 0;

    // Start and finish the hunt
    await room.webSocketMessage(hostWs, JSON.stringify({ type: 'start_hunt' }));
    await room.alarm(); // start_playing
    (room as any).room.nextAlarmAction = 'end_hunt';
    await room.alarm(); // end_hunt

    // Simulate disconnect
    const token = await getRejoinToken(state, 'Bob');
    state._webSockets = state._webSockets.filter((ws: any) => ws !== playerWs);

    // Rejoin
    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await room.webSocketMessage(
      ws2,
      JSON.stringify({ type: 'rejoin_hunt', huntId: 'HUNT-TEST', username: 'Bob', rejoinToken: token }),
    );

    const msgs = getSentMessages(ws2);
    expect(msgs.some((m: any) => m.type === 'hunt_state')).toBe(true);
    expect(msgs.some((m: any) => m.type === 'hunt_finished')).toBe(true);

    const stateMsg = msgs.find((m: any) => m.type === 'hunt_state');
    expect(stateMsg.state.phase).toBe('finished');
  });

  it('join_hunt auto-redirects to rejoin for existing player after hunt starts', async () => {
    const { state, room } = await createInitializedHunt();
    const { playerWs } = await startHuntWithPlayer(room, state);

    // Disconnect player
    const token = await getRejoinToken(state, 'Player1');
    state._webSockets = state._webSockets.filter((ws: any) => ws !== playerWs);

    // Try join_hunt (not rejoin_hunt) — should auto-redirect to rejoin
    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await room.webSocketMessage(
      ws2,
      JSON.stringify({ type: 'join_hunt', huntId: 'HUNT-TEST', username: 'Player1', rejoinToken: token }),
    );

    const msgs = getSentMessages(ws2);
    expect(msgs.some((m: any) => m.type === 'hunt_state')).toBe(true);
    expect(msgs.some((m: any) => m.type === 'hunt_started')).toBe(true);
  });

  it('rejoin_hunt falls back to join during waiting phase for unknown player', async () => {
    const { state, room } = await createInitializedHunt();

    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);
    await room.webSocketMessage(
      ws,
      JSON.stringify({ type: 'rejoin_hunt', huntId: 'HUNT-TEST', username: 'NewPlayer' }),
    );

    const msgs = getSentMessages(ws);
    expect(msgs.some((m: any) => m.type === 'hunt_state')).toBe(true);
    // Should have been added as a player
    const stateMsg = msgs.find((m: any) => m.type === 'hunt_state');
    expect(stateMsg.state.players).toHaveLength(1);
    expect(stateMsg.state.players[0].username).toBe('NewPlayer');
  });

  it('rejoin_hunt rejects unknown player during playing phase', async () => {
    const { state, room } = await createInitializedHunt();
    await startHuntWithPlayer(room, state);

    // New player tries to rejoin (never was in the hunt)
    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await room.webSocketMessage(
      ws2,
      JSON.stringify({ type: 'rejoin_hunt', huntId: 'HUNT-TEST', username: 'Stranger' }),
    );

    const msgs = getSentMessages(ws2);
    expect(msgs[0].type).toBe('error');
    expect(msgs[0].code).toBe('PLAYER_NOT_FOUND');
  });

  it('leave during playing phase does not remove player (allows rejoin)', async () => {
    const { state, room } = await createInitializedHunt();
    const { playerWs, playerId } = await startHuntWithPlayer(room, state);

    // Simulate WebSocket close (disconnect)
    await room.webSocketClose(playerWs);

    // Player should still be in the room
    const stored = (await state.storage.get('room')) as any;
    expect(stored.players.some((p: any) => p.username === 'Player1')).toBe(true);
    expect(stored.progress[playerId]).toBeDefined();
  });

  it('rejoin resends pending appeals to reconnected host', async () => {
    const { state, room } = await createInitializedHunt({ minPlayers: 1 });
    const { hostWs, playerWs, hostId, playerId } = await startHuntWithPlayer(room, state);

    // Manually create an appeal in the room state
    const roomState = (room as any).room;
    roomState.pendingAppeals.push({
      playerId,
      playerUsername: 'Player1',
      itemId: 'item-1',
      itemDescription: 'A red fire hydrant',
      photoUrl: 'HUNT-TEST/test-photo.jpg',
      timestamp: Date.now(),
    });

    // Disconnect host
    const token = await getRejoinToken(state, 'Host');
    state._webSockets = state._webSockets.filter((ws: any) => ws !== hostWs);

    // Host reconnects
    const hostWs2 = createMockWebSocket();
    state.acceptWebSocket(hostWs2);
    await room.webSocketMessage(
      hostWs2,
      JSON.stringify({ type: 'rejoin_hunt', huntId: 'HUNT-TEST', username: 'Host', rejoinToken: token }),
    );

    const msgs = getSentMessages(hostWs2);
    expect(msgs.some((m: any) => m.type === 'appeal_received')).toBe(true);
    const appealMsg = msgs.find((m: any) => m.type === 'appeal_received');
    expect(appealMsg.appeal.playerUsername).toBe('Player1');
    expect(appealMsg.appeal.itemId).toBe('item-1');
  });
});

// ============================================================
// Hunt History
// ============================================================

describe('ScavengerHuntRoom -- Hunt History', () => {
  it('saves hunt history to KV when hunt finishes', async () => {
    const { state, env, room } = await createInitializedHunt();
    const { hostWs, playerWs } = await startHuntWithPlayer(room, state);

    // Trigger end_hunt alarm (skip time warnings)
    const stored = liveRoom(room);
    stored.nextAlarmAction = 'end_hunt';
    await state.storage.put('room', stored);
    await room.alarm();

    // Check KV was written
    const kvValue = await env.TRIVIA_KV.get('hunt-history:HUNT-TEST');
    expect(kvValue).not.toBeNull();

    const entry = JSON.parse(kvValue!);
    expect(entry.huntId).toBe('HUNT-TEST');
    expect(entry.config.name).toBe('Test Hunt');
    expect(entry.hostUsername).toBe('Host');
    expect(entry.hostSecret).toBeDefined();
    // Players now include host (host plays too)
    expect(entry.players).toHaveLength(2);
    expect(entry.players.some((p: any) => p.username === 'Player1')).toBe(true);
    expect(entry.players.some((p: any) => p.username === 'Host')).toBe(true);
    expect(entry.results.rankings).toHaveLength(2);
    expect(entry.finishedAt).toBeGreaterThan(0);
  });

  it('sends hunt_history_saved to host with hostSecret', async () => {
    const { state, env, room } = await createInitializedHunt();
    const { hostWs, playerWs } = await startHuntWithPlayer(room, state);

    // Trigger end_hunt
    const stored = liveRoom(room);
    stored.nextAlarmAction = 'end_hunt';
    await state.storage.put('room', stored);
    await room.alarm();

    const hostMsgs = getSentMessages(hostWs);
    const historySaved = hostMsgs.find((m: any) => m.type === 'hunt_history_saved');
    expect(historySaved).toBeDefined();
    expect(historySaved.huntId).toBe('HUNT-TEST');
    expect(historySaved.hostSecret).toBeDefined();

    // Verify it matches what's in KV
    const kvValue = JSON.parse((await env.TRIVIA_KV.get('hunt-history:HUNT-TEST'))!);
    expect(historySaved.hostSecret).toBe(kvValue.hostSecret);
  });

  it('does not send hunt_history_saved to players', async () => {
    const { state, room } = await createInitializedHunt();
    const { hostWs, playerWs } = await startHuntWithPlayer(room, state);

    const stored = liveRoom(room);
    stored.nextAlarmAction = 'end_hunt';
    await state.storage.put('room', stored);
    await room.alarm();

    const playerMsgs = getSentMessages(playerWs);
    expect(playerMsgs.some((m: any) => m.type === 'hunt_history_saved')).toBe(false);
  });

  it('preserves R2 photos during cleanup of finished hunts', async () => {
    const { state, env, room } = await createInitializedHunt();
    await startHuntWithPlayer(room, state);

    // Finish the hunt
    let stored = liveRoom(room);
    stored.nextAlarmAction = 'end_hunt';
    await state.storage.put('room', stored);
    await room.alarm();

    // Trigger cleanup alarm
    stored = liveRoom(room);
    stored.nextAlarmAction = 'cleanup_hunt';
    await state.storage.put('room', stored);

    // Track if R2 list was called (it shouldn't be for cleanup)
    let r2ListCalled = false;
    (env.R2_HUNT_PHOTOS as any).list = async () => {
      r2ListCalled = true;
      return { objects: [], truncated: false };
    };

    await room.alarm();

    // R2 photos should NOT be deleted during cleanup
    expect(r2ListCalled).toBe(false);
  });

  it('stores KV metadata for listing', async () => {
    const { state, env, room } = await createInitializedHunt();
    await startHuntWithPlayer(room, state);

    const stored = liveRoom(room);
    stored.nextAlarmAction = 'end_hunt';
    await state.storage.put('room', stored);
    await room.alarm();

    // List KV entries with prefix
    const listResult = await env.TRIVIA_KV.list({ prefix: 'hunt-history:' });
    expect(listResult.keys).toHaveLength(1);
    expect(listResult.keys[0].metadata).toBeDefined();

    const meta = listResult.keys[0].metadata as any;
    expect(meta.huntId).toBe('HUNT-TEST');
    expect(meta.name).toBe('Test Hunt');
    expect(meta.hostUsername).toBe('Host');
    // teamCount now includes host (host plays too)
    expect(meta.teamCount).toBe(2);
    expect(meta.totalItems).toBe(3);
  });
});

describe('ScavengerHuntRoom -- Stuck verification recovery', () => {
  let state: MockDurableObjectState;
  let env: Env;
  let room: ScavengerHuntRoom;

  beforeEach(async () => {
    ({ state, env, room } = await createInitializedHunt());
  });

  it('resets a stuck pending_review and sends a well-formed photo_rejected', async () => {
    const { playerWs, playerId } = await startHuntWithPlayer(room, state);

    const stored = liveRoom(room);
    const itemProgress = stored.progress[playerId].items['item-1'];
    itemProgress.status = 'pending_review';
    itemProgress.pendingReviewSince = Date.now() - 61_000;
    itemProgress.attemptsUsed = 1;
    itemProgress.activeUploadId = 'upload-stuck';

    // Any message during play triggers the stuck-review sweep
    await room.webSocketMessage(playerWs, JSON.stringify({ type: 'ping' }));

    const rejected = getSentMessages(playerWs).find(
      (m: any) => m.type === 'photo_rejected',
    ) as any;
    expect(rejected).toBeDefined();
    // Regression: this message used to omit attemptsUsed, which the frontend
    // trusts blindly — undefined made the remaining-attempts math NaN and
    // permanently disabled the submit button for that item
    expect(rejected.attemptsUsed).toBe(0);
    expect(rejected.attemptsRemaining).toBe(3);

    expect(itemProgress.status).toBe('searching');
    expect(itemProgress.activeUploadId).toBeUndefined();
  });

  it('rejects a duplicate start_hunt instead of re-initializing a live hunt', async () => {
    const { hostWs, playerId } = await startHuntWithPlayer(room, state);

    const stored = liveRoom(room);
    stored.progress[playerId].items['item-1'].status = 'found';

    await room.webSocketMessage(hostWs, JSON.stringify({ type: 'start_hunt' }));

    const last = getLastMessage(hostWs) as any;
    expect(last.type).toBe('error');
    expect(last.message).toMatch(/already started/i);
    // Progress must not have been wiped
    expect(stored.phase).toBe('playing');
    expect(stored.progress[playerId].items['item-1'].status).toBe('found');
  });
});

describe('ScavengerHuntRoom -- End-of-hunt verification grace', () => {
  let state: MockDurableObjectState;
  let env: Env;
  let room: ScavengerHuntRoom;

  beforeEach(async () => {
    ({ state, env, room } = await createInitializedHunt());
  });

  it('defers finishing while a verification is pending within the grace window', async () => {
    const { playerId } = await startHuntWithPlayer(room, state);

    const stored = liveRoom(room);
    stored.endsAt = Date.now() - 1000;
    stored.nextAlarmAction = 'end_hunt';
    const itemProgress = stored.progress[playerId].items['item-1'];
    itemProgress.status = 'pending_review';
    itemProgress.pendingReviewSince = Date.now() - 5000;

    await room.alarm();

    // A photo submitted before the deadline is still verifying — the hunt
    // must wait for the result instead of discarding it
    expect(stored.phase).toBe('playing');
    expect(stored.nextAlarmAction).toBe('end_hunt');
  });

  it('finishes once the grace window expires, clearing stuck pending reviews', async () => {
    const { playerId } = await startHuntWithPlayer(room, state);

    const stored = liveRoom(room);
    stored.endsAt = Date.now() - 61_000;
    stored.nextAlarmAction = 'end_hunt';
    const itemProgress = stored.progress[playerId].items['item-1'];
    itemProgress.status = 'pending_review';
    itemProgress.pendingReviewSince = Date.now() - 70_000;

    await room.alarm();

    expect(stored.phase).toBe('finished');
    // No permanent "Verifying..." badge after the hunt ends
    expect(itemProgress.status).toBe('searching');
  });
});

describe('ScavengerHuntRoom -- Rejoin tokens & host stability', () => {
  let state: MockDurableObjectState;
  let env: Env;
  let room: ScavengerHuntRoom;

  beforeEach(async () => {
    ({ state, env, room } = await createInitializedHunt());
  });

  it('rejoin_hunt rejects a wrong token', async () => {
    const { playerWs } = await startHuntWithPlayer(room, state);
    state._webSockets = state._webSockets.filter((w: any) => w !== playerWs);

    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await room.webSocketMessage(
      ws2,
      JSON.stringify({ type: 'rejoin_hunt', huntId: 'HUNT-TEST', username: 'Player1', rejoinToken: 'wrong-token' }),
    );

    const msgs = getSentMessages(ws2);
    expect(msgs[0].type).toBe('error');
    expect(msgs[0].code).toBe('USERNAME_TAKEN');

    // The impostor socket must not be attached to the player
    const stored = (await state.storage.get('room')) as any;
    const playerId = stored.players.find((p: any) => p.username === 'Player1').id;
    expect((ws2 as any).deserializeAttachment()).not.toBe(playerId);
  });

  it('grandfathers players from hunts created before tokens existed', async () => {
    const { playerWs, playerId } = await startHuntWithPlayer(room, state);

    // Simulate a pre-token room: no stored token for this player
    const stored = liveRoom(room);
    delete stored.rejoinTokens[playerId];

    state._webSockets = state._webSockets.filter((w: any) => w !== playerWs);
    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await room.webSocketMessage(
      ws2,
      JSON.stringify({ type: 'rejoin_hunt', huntId: 'HUNT-TEST', username: 'Player1' }),
    );

    // Rejoin succeeds and a token is issued for next time
    const msgs = getSentMessages(ws2);
    expect(msgs[0].type).toBe('join_confirmed');
    expect(msgs[0].rejoinToken).toBeTruthy();
    expect(stored.rejoinTokens[playerId]).toBe(msgs[0].rejoinToken);
  });

  it('host disconnect mid-hunt only transfers host after the grace period, with appeals pushed', async () => {
    const { hostWs, playerWs, hostId, playerId } = await startHuntWithPlayer(room, state);

    const stored = liveRoom(room);
    stored.pendingAppeals.push({
      playerId,
      playerUsername: 'Player1',
      itemId: 'item-1',
      itemDescription: 'A red fire hydrant',
      photoUrl: 'HUNT-TEST/test-photo.jpg',
      timestamp: Date.now(),
      isContest: false,
    });

    // Host's socket drops
    state._webSockets = state._webSockets.filter((w: any) => w !== hostWs);
    await room.webSocketClose(hostWs);

    // Within the grace period the host keeps the role
    expect(stored.hostId).toBe(hostId);
    const host = stored.players.find((p: any) => p.id === hostId);
    expect(host.disconnectedAt).toBeDefined();

    // Past the grace period, the next message hands host to Player1
    host.disconnectedAt = Date.now() - 61_000;
    playerWs._sent.length = 0;
    await room.webSocketMessage(playerWs, JSON.stringify({ type: 'ping' }));

    expect(stored.hostId).toBe(playerId);
    const msgs = getSentMessages(playerWs);
    expect(msgs.some((m: any) => m.type === 'host_changed')).toBe(true);
    // The incoming host receives the pending appeals
    expect(msgs.some((m: any) => m.type === 'appeal_received')).toBe(true);
  });

  it('restores host to the creator on rejoin after the role drifted', async () => {
    const initialized = await createInitializedHunt({ hostEmail: 'creator@example.com' });
    const emailState = initialized.state;
    const emailRoom = initialized.room;

    // Creator joins with their email riding the socket attachment (set at upgrade)
    const creatorWs = createMockWebSocket();
    (creatorWs as any).serializeAttachment({ pendingEmail: 'creator@example.com' });
    emailState.acceptWebSocket(creatorWs);
    await emailRoom.webSocketMessage(
      creatorWs,
      JSON.stringify({ type: 'join_hunt', huntId: 'HUNT-TEST', username: 'Creator' }),
    );
    const bobWs = await joinPlayer(emailRoom, emailState, 'Bob');

    const stored = liveRoom(emailRoom);
    const creatorId = stored.players.find((p: any) => p.username === 'Creator').id;
    const bobId = stored.players.find((p: any) => p.username === 'Bob').id;
    expect(stored.hostId).toBe(creatorId);

    // Simulate the role drifting to Bob while the creator was away
    stored.hostId = bobId;
    const token = stored.rejoinTokens[creatorId];
    emailState._webSockets = emailState._webSockets.filter((w: any) => w !== creatorWs);

    const creatorWs2 = createMockWebSocket();
    (creatorWs2 as any).serializeAttachment({ pendingEmail: 'creator@example.com' });
    emailState.acceptWebSocket(creatorWs2);
    await emailRoom.webSocketMessage(
      creatorWs2,
      JSON.stringify({ type: 'rejoin_hunt', huntId: 'HUNT-TEST', username: 'Creator', rejoinToken: token }),
    );

    expect(stored.hostId).toBe(creatorId);
    expect(getSentMessages(bobWs).some((m: any) => m.type === 'host_changed')).toBe(true);
  });

  it('start_hunt sweeps players gone past the grace period before counting teams', async () => {
    const hostWs = await joinPlayer(room, state, 'Host');
    await joinPlayer(room, state, 'Ghost');

    const stored = liveRoom(room);
    const ghost = stored.players.find((p: any) => p.username === 'Ghost');
    ghost.disconnectedAt = Date.now() - 61_000;
    state._webSockets = state._webSockets.filter(
      (w: any) => (w as any).deserializeAttachment() !== ghost.id,
    );

    await room.webSocketMessage(hostWs, JSON.stringify({ type: 'start_hunt' }));

    expect(stored.players).toHaveLength(1);
    expect(stored.players[0].username).toBe('Host');
    expect(stored.progress[ghost.id]).toBeUndefined();
    expect(stored.phase).toBe('starting');
  });
});

// ============================================================
// Regression tests for the confirmed hunt-room bug audit
// ============================================================

/** Join the hunt creator, with their email riding the socket attachment. */
async function joinCreator(
  room: ScavengerHuntRoom,
  state: MockDurableObjectState,
  email: string,
  username = 'Creator',
): Promise<MockWebSocket> {
  const ws = createMockWebSocket();
  (ws as any).serializeAttachment({ pendingEmail: email });
  state.acceptWebSocket(ws);
  await room.webSocketMessage(
    ws,
    JSON.stringify({ type: 'join_hunt', huntId: 'HUNT-TEST', username }),
  );
  return ws;
}

/**
 * Record every room write. mocks.ts snapshots on write now, so the stored
 * value already is exactly what reached persist() — no hand-rolled deep clone
 * needed. What this still buys is the *count*: it lets lastPersisted() fail a
 * handler that never persisted at all, which reading storage alone cannot.
 */
function recordPersists(state: MockDurableObjectState): any[] {
  const snapshots: any[] = [];
  const original = (state.storage.put as any).bind(state.storage);
  (state.storage as any).put = async (key: any, value: any) => {
    const result = await original(key, value);
    if (key === 'room') snapshots.push(state._storage.get('room'));
    return result;
  };
  return snapshots;
}

/**
 * The newest room state that actually reached storage. Asserting on the DO's
 * in-memory object proves nothing: a handler that mutates and forgets to
 * persist() reads identically to one that doesn't.
 */
function lastPersisted(snapshots: any[]): any {
  expect(snapshots.length).toBeGreaterThan(0);
  return snapshots[snapshots.length - 1];
}

/** A well-formed uploadId — the schema wants a UUID plus an image extension. */
function uploadId(n: number): string {
  return `${n.toString(16).padStart(8, '0')}-1234-1234-1234-123456789abc.jpg`;
}

async function submitPhoto(
  room: ScavengerHuntRoom,
  ws: MockWebSocket,
  upload: string,
  itemId = 'item-1',
) {
  await room.webSocketMessage(
    ws,
    JSON.stringify({ type: 'submit_photo', itemId, uploadId: upload }),
  );
}

function makeAppeal(playerId: string, overrides: Record<string, unknown> = {}) {
  return {
    playerId,
    playerUsername: 'Player1',
    itemId: 'item-1',
    itemDescription: 'A red fire hydrant',
    photoUrl: 'HUNT-TEST/appealed.jpg',
    timestamp: Date.now(),
    isContest: false,
    ...overrides,
  };
}

describe('ScavengerHuntRoom -- Concurrent start_hunt', () => {
  const EMAIL = 'creator@example.com';

  async function seedHost(env: Env, credits: number) {
    await env.TRIVIA_KV.put(
      `user:${EMAIL}`,
      JSON.stringify({ userId: 'user-1', email: EMAIL, credits, createdAt: Date.now() }),
    );
  }

  async function hostCredits(env: Env): Promise<number> {
    return JSON.parse((await env.TRIVIA_KV.get(`user:${EMAIL}`))!).credits;
  }

  it('deducts credits once when two start_hunt messages overlap', async () => {
    const { state, env, room } = await createInitializedHunt({ hostEmail: EMAIL });
    await seedHost(env, 1000);
    const hostWs = await joinCreator(room, state, EMAIL);
    hostWs._sent.length = 0;

    // Park the first start on its credit-lock read. That await reopens the DO
    // input gate mid-charge, which is exactly the interleaving that used to
    // bill the host twice.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const originalGet = (env.TRIVIA_KV.get as any).bind(env.TRIVIA_KV);
    let parked = false;
    (env.TRIVIA_KV as any).get = async (key: string, opts?: any) => {
      if (key.startsWith('credit-lock:') && !parked) {
        parked = true;
        await gate;
      }
      return originalGet(key, opts);
    };

    const first = room.webSocketMessage(hostWs, JSON.stringify({ type: 'start_hunt' }));
    const second = room.webSocketMessage(hostWs, JSON.stringify({ type: 'start_hunt' }));
    setTimeout(release, 0);
    await Promise.all([first, second]);

    // 3 items x 3 retries x 1 team = 9, charged once
    expect(parked).toBe(true); // the race was actually exercised
    expect(await hostCredits(env)).toBe(991);

    // The ledger has to agree with the balance, not just the balance with itself
    const txs = JSON.parse((await env.TRIVIA_KV.get('transactions:user-1'))!);
    expect(txs.filter((t: any) => t.type === 'deduction')).toHaveLength(1);

    const stored = (await state.storage.get('room')) as any;
    expect(stored.creditsDeducted).toBe(9);
    expect(stored.phase).toBe('starting');

    const msgs = getSentMessages(hostWs);
    expect(msgs.filter((m: any) => m.type === 'credits_deducted')).toHaveLength(1);
    expect(
      msgs.some((m: any) => m.type === 'error' && /already started/i.test(m.message)),
    ).toBe(true);
  });

  it('leaves the room startable after a start that failed on credits', async () => {
    const { state, env, room } = await createInitializedHunt({ hostEmail: EMAIL });
    await seedHost(env, 5); // needs 9
    const hostWs = await joinCreator(room, state, EMAIL);
    hostWs._sent.length = 0;

    await room.webSocketMessage(hostWs, JSON.stringify({ type: 'start_hunt' }));
    expect(getLastMessage(hostWs).message).toMatch(/not enough credits/i);
    expect(((await state.storage.get('room')) as any).phase).toBe('waiting');

    // The in-memory guard must roll back, or a failed start wedges the room
    await seedHost(env, 100);
    hostWs._sent.length = 0;
    await room.webSocketMessage(hostWs, JSON.stringify({ type: 'start_hunt' }));

    expect(((await state.storage.get('room')) as any).phase).toBe('starting');
    expect(await hostCredits(env)).toBe(91);
  });

  /** A second hunt for the same host, sharing one KV so the balances collide. */
  async function createHuntSharing(env: Env, huntId: string) {
    const state = createMockDurableObjectState();
    const room = new ScavengerHuntRoom(state, env);
    const response = await room.fetch(
      new Request('http://internal/config', {
        method: 'POST',
        body: JSON.stringify(makeHuntConfig({ huntId, hostEmail: EMAIL })),
      }),
    );
    expect(((await response.json()) as any).ok).toBe(true);
    return { state, room };
  }

  it('does not overdraw a host who starts two hunts at once', async () => {
    const { state: stateA, env, room: roomA } = await createInitializedHunt({
      hostEmail: EMAIL,
      huntId: 'HUNT-A',
    });
    const { state: stateB, room: roomB } = await createHuntSharing(env, 'HUNT-B');
    await seedHost(env, 12); // 9 apiece: enough for one hunt, not for two

    const wsA = await joinCreator(roomA, stateA, EMAIL);
    const wsB = await joinCreator(roomB, stateB, EMAIL);
    wsA._sent.length = 0;
    wsB._sent.length = 0;

    // Park whichever hunt reaches the affordability read first, and let the
    // other one run to completion underneath it — release is a macrotask, so
    // every pending microtask drains before the parked hunt resumes. Two hunts
    // are two rooms, so the old per-hunt lock never serialised them: the
    // parked one woke holding a balance of 12 that was really 3, passed the
    // check on it, and started a hunt it had not paid for.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const originalGet = (env.TRIVIA_KV.get as any).bind(env.TRIVIA_KV);
    let parked = false;
    (env.TRIVIA_KV as any).get = async (key: string, opts?: any) => {
      const value = await originalGet(key, opts);
      if (key === `user:${EMAIL}` && !parked) {
        parked = true;
        await gate;
      }
      // Deliberately stale: the balance this caller checks is the one it read
      // before the other hunt was paid for.
      return value;
    };

    const startB = roomB.webSocketMessage(wsB, JSON.stringify({ type: 'start_hunt' }));
    const startA = roomA.webSocketMessage(wsA, JSON.stringify({ type: 'start_hunt' }));
    setTimeout(release, 0);
    await Promise.all([startA, startB]);

    expect(parked).toBe(true); // the race was actually exercised
    expect(await hostCredits(env)).toBe(3);

    const charged = [...getSentMessages(wsA), ...getSentMessages(wsB)].filter(
      (m: any) => m.type === 'credits_deducted',
    );
    expect(charged).toHaveLength(1);

    // Whichever hunt lost stays startable rather than half-paid-for
    const phases = [
      ((await stateA.storage.get('room')) as any).phase,
      ((await stateB.storage.get('room')) as any).phase,
    ].sort();
    expect(phases).toEqual(['starting', 'waiting']);
    expect(
      [...getSentMessages(wsA), ...getSentMessages(wsB)].some((m: any) => m.type === 'error'),
    ).toBe(true);
  });

  it("refuses the second hunt with 'not enough credits' once the first is paid for", async () => {
    const { state: stateA, env, room: roomA } = await createInitializedHunt({
      hostEmail: EMAIL,
      huntId: 'HUNT-A',
    });
    const { state: stateB, room: roomB } = await createHuntSharing(env, 'HUNT-B');
    await seedHost(env, 12);

    const wsA = await joinCreator(roomA, stateA, EMAIL);
    const wsB = await joinCreator(roomB, stateB, EMAIL);
    await roomA.webSocketMessage(wsA, JSON.stringify({ type: 'start_hunt' }));
    expect(await hostCredits(env)).toBe(3);

    wsB._sent.length = 0;
    await roomB.webSocketMessage(wsB, JSON.stringify({ type: 'start_hunt' }));

    // Not a lock-contention error — the host genuinely can't afford this one
    expect(getLastMessage(wsB).message).toMatch(/not enough credits/i);
    expect(await hostCredits(env)).toBe(3);
    expect(((await stateB.storage.get('room')) as any).phase).toBe('waiting');
  });

  it('charges the balance as of the charge, not one read earlier', async () => {
    const { state, env, room } = await createInitializedHunt({ hostEmail: EMAIL });
    await seedHost(env, 100);
    const hostWs = await joinCreator(room, state, EMAIL);
    hostWs._sent.length = 0;

    // A grant landing after start_hunt begins must survive it. This room never
    // reads the balance itself any more — the whole read-modify-write is one
    // adjustUserCredits call — so nothing here can carry a stale figure across
    // the lock and write it back.
    const originalGet = (env.TRIVIA_KV.get as any).bind(env.TRIVIA_KV);
    const originalPut = (env.TRIVIA_KV.put as any).bind(env.TRIVIA_KV);
    let injected = false;
    (env.TRIVIA_KV as any).get = async (key: string, opts?: any) => {
      const value = await originalGet(key, opts);
      if (key === `hunt-start-lock:${EMAIL}` && !injected) {
        injected = true;
        const current = JSON.parse((await originalGet(`user:${EMAIL}`))!);
        await originalPut(
          `user:${EMAIL}`,
          JSON.stringify({ ...current, credits: current.credits + 50 }),
        );
      }
      return value;
    };

    await room.webSocketMessage(hostWs, JSON.stringify({ type: 'start_hunt' }));

    expect(injected).toBe(true);
    expect(await hostCredits(env)).toBe(141); // 100 + a 50 grant - 9 charged

    const deducted = getSentMessages(hostWs).find((m: any) => m.type === 'credits_deducted');
    expect(deducted.remaining).toBe(141);
  });

  it('maps a refused overdraw to the reason, not a generic failure', async () => {
    const { state, env, room } = await createInitializedHunt({ hostEmail: EMAIL });
    await seedHost(env, 5); // needs 9
    const hostWs = await joinCreator(room, state, EMAIL);
    hostWs._sent.length = 0;

    await room.webSocketMessage(hostWs, JSON.stringify({ type: 'start_hunt' }));

    // adjustUserCredits refuses an overdraw by throwing rather than flooring
    // it; caught generically that reads "Failed to start hunt. Please try
    // again.", which is true but tells the host nothing they can act on
    expect(getLastMessage(hostWs)).toEqual({
      type: 'error',
      message: 'Not enough credits to start this hunt',
    });
    expect(await hostCredits(env)).toBe(5);
  });

  it('starts a hunt whose charge already committed on an earlier attempt', async () => {
    const { state, env, room } = await createInitializedHunt({ hostEmail: EMAIL });
    await seedHost(env, 9); // exactly one hunt's worth
    const hostWs = await joinCreator(room, state, EMAIL);

    // The charge landed, then the DO died before the phase reached 'starting'
    await room.webSocketMessage(hostWs, JSON.stringify({ type: 'start_hunt' }));
    expect(await hostCredits(env)).toBe(0);
    const stored = liveRoom(room);
    stored.phase = 'waiting';
    stored.creditsDeducted = undefined;
    hostWs._sent.length = 0;

    await room.webSocketMessage(hostWs, JSON.stringify({ type: 'start_hunt' }));

    // An affordability pre-check compares the *post-charge* balance against
    // the full price and refuses a hunt the host has already paid for. The
    // idempotency key is what settles this, and it says the charge is done.
    expect(stored.phase).toBe('starting');
    expect(await hostCredits(env)).toBe(0);
    const deducted = getSentMessages(hostWs).find((m: any) => m.type === 'credits_deducted');
    expect(deducted).toEqual({ type: 'credits_deducted', amount: 0, remaining: 0 });
  });
});

describe('ScavengerHuntRoom -- Appeals vs. resubmission', () => {
  let state: MockDurableObjectState;
  let env: Env;
  let room: ScavengerHuntRoom;

  beforeEach(async () => {
    ({ state, env, room } = await createInitializedHunt());
  });

  it('blocks a new submission while an appeal is pending', async () => {
    const { playerWs, playerId } = await startHuntWithPlayer(room, state);

    const stored = liveRoom(room);
    const itemProgress = stored.progress[playerId].items['item-1'];
    itemProgress.status = 'rejected';
    itemProgress.attemptsUsed = 1;
    stored.pendingAppeals.push(makeAppeal(playerId));

    playerWs._sent.length = 0;
    await submitPhoto(room, playerWs, uploadId(1));

    const last = getLastMessage(playerWs) as any;
    expect(last.type).toBe('error');
    expect(last.message).toMatch(/waiting on the host/i);
    // The item must not be re-opened for scoring behind the host's back
    expect(itemProgress.status).toBe('rejected');
    expect(itemProgress.attemptsUsed).toBe(1);
  });

  it('does not score an item twice when a stale appeal is approved', async () => {
    const { hostWs, playerId } = await startHuntWithPlayer(room, state);

    const stored = liveRoom(room);
    stored.pendingAppeals.push(makeAppeal(playerId));
    // The player resubmitted and won the item while the appeal sat in the queue
    const itemProgress = stored.progress[playerId].items['item-1'];
    itemProgress.status = 'found';
    itemProgress.foundAt = Date.now();
    itemProgress.photoUrl = 'HUNT-TEST/winning.jpg';
    stored.progress[playerId].totalScore = 1000;

    hostWs._sent.length = 0;
    await room.webSocketMessage(
      hostWs,
      JSON.stringify({ type: 'approve_appeal', playerId, itemId: 'item-1' }),
    );

    expect(stored.progress[playerId].totalScore).toBe(1000);
    expect(stored.progress[playerId].items['item-1'].photoUrl).toBe('HUNT-TEST/winning.jpg');
    expect(stored.pendingAppeals).toHaveLength(0);
    expect(
      getSentMessages(hostWs).some(
        (m: any) => m.type === 'error' && /already resolved/i.test(m.message),
      ),
    ).toBe(true);
  });

  it('does not unwind a won item when a stale contest is rejected', async () => {
    const { hostWs, playerWs, playerId } = await startHuntWithPlayer(room, state);

    const stored = liveRoom(room);
    stored.pendingAppeals.push(makeAppeal(playerId, { isContest: true }));
    const itemProgress = stored.progress[playerId].items['item-1'];
    itemProgress.status = 'found';
    itemProgress.attemptsUsed = 1;
    stored.progress[playerId].totalScore = 1000;

    playerWs._sent.length = 0;
    await room.webSocketMessage(
      hostWs,
      JSON.stringify({ type: 'reject_appeal', playerId, itemId: 'item-1' }),
    );

    // Flipping it back to 'searching' would strand its points on the total,
    // so buildResults and totalScore would disagree
    expect(itemProgress.status).toBe('found');
    expect(stored.progress[playerId].totalScore).toBe(1000);
    const rejected = getSentMessages(playerWs).find((m: any) => m.type === 'appeal_rejected') as any;
    expect(rejected.returnToSearching).toBe(false);
  });

  it('carries the appealed photo onto an approved item', async () => {
    const { hostWs, playerId } = await startHuntWithPlayer(room, state);

    const stored = liveRoom(room);
    stored.pendingAppeals.push(makeAppeal(playerId));
    const itemProgress = stored.progress[playerId].items['item-1'];
    itemProgress.status = 'rejected';
    itemProgress.attemptsUsed = 3;

    await room.webSocketMessage(
      hostWs,
      JSON.stringify({ type: 'approve_appeal', playerId, itemId: 'item-1' }),
    );

    expect(itemProgress.status).toBe('found');
    // saveHistory only keeps photos for items that are both found and carry a
    // photoUrl, so without this the appealed photo is missing from history
    expect(itemProgress.photoUrl).toBe('HUNT-TEST/appealed.jpg');
    expect(stored.progress[playerId].totalScore).toBe(1000);
  });

  it('persists the appeal queue when approval bails out early', async () => {
    const { hostWs, playerId } = await startHuntWithPlayer(room, state);

    const snapshots = recordPersists(state);
    const stored = liveRoom(room);
    stored.pendingAppeals.push(makeAppeal(playerId, { itemId: 'ghost-item' }));

    await room.webSocketMessage(
      hostWs,
      JSON.stringify({ type: 'approve_appeal', playerId, itemId: 'ghost-item' }),
    );

    // The appeal used to vanish from memory but survive in storage, where it
    // reappeared after eviction and blocked the hunt from finishing early
    expect(stored.pendingAppeals).toHaveLength(0);
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots[snapshots.length - 1].pendingAppeals).toHaveLength(0);
  });
});

describe('ScavengerHuntRoom -- Verification failure accounting', () => {
  let state: MockDurableObjectState;
  let env: Env;
  let room: ScavengerHuntRoom;

  // The mock env has no ANTHROPIC_API_KEY, so every submit_photo lands in the
  // verification catch block — the server-side-failure path under test.
  beforeEach(async () => {
    ({ state, env, room } = await createInitializedHunt());
  });

  it('refunds the first failures, then starts charging the attempt', async () => {
    const { playerWs, playerId } = await startHuntWithPlayer(room, state);
    const stored = liveRoom(room);
    const itemProgress = stored.progress[playerId].items['item-1'];

    // A genuine transient error must not eat the player's attempt
    await submitPhoto(room, playerWs, uploadId(1));
    expect(itemProgress.attemptsUsed).toBe(0);
    await submitPhoto(room, playerWs, uploadId(2));
    expect(itemProgress.attemptsUsed).toBe(0);

    // ...but the refund is capped, or a client loops a failing upload forever
    // at two Sonnet calls plus a Haiku call per iteration
    await submitPhoto(room, playerWs, uploadId(3));
    expect(itemProgress.attemptsUsed).toBe(1);
    await submitPhoto(room, playerWs, uploadId(4));
    expect(itemProgress.attemptsUsed).toBe(2);
    await submitPhoto(room, playerWs, uploadId(5));
    expect(itemProgress.attemptsUsed).toBe(3);

    // The item is now with the host as an appeal (see the escape-hatch tests
    // below), so a further submission is refused for *that* reason
    playerWs._sent.length = 0;
    await submitPhoto(room, playerWs, uploadId(6));
    expect(getLastMessage(playerWs).message).toMatch(/appeal for this item is waiting/i);
  });

  it('replays a real verdict instead of consuming another attempt', async () => {
    const { state, room } = await createInitializedHunt({}, createVerifyingEnv());
    const { playerWs, playerId } = await startHuntWithPlayer(room, state);
    const snapshots = recordPersists(state);

    let calls = 0;
    vision.impl = async () => {
      calls++;
      return verdict(false, 'Not a hydrant');
    };

    await submitPhoto(room, playerWs, uploadId(1));
    const first = getLastMessage(playerWs) as any;
    expect(first.type).toBe('photo_rejected');
    expect(first.reason).toBe('Not a hydrant');

    // The client re-sends the same uploadId when an ack goes missing; without
    // the replay cache that burns a second and third attempt on one photo
    playerWs._sent.length = 0;
    await submitPhoto(room, playerWs, uploadId(1));
    await submitPhoto(room, playerWs, uploadId(1));

    expect(getSentMessages(playerWs)).toEqual([first, first]);
    expect(calls).toBe(1);
    expect(lastPersisted(snapshots).progress[playerId].items['item-1'].attemptsUsed).toBe(1);
  });

  it('re-acks a retry of the upload that is still verifying', async () => {
    const { playerWs, playerId } = await startHuntWithPlayer(room, state);
    const stored = liveRoom(room);
    const itemProgress = stored.progress[playerId].items['item-1'];
    itemProgress.status = 'pending_review';
    itemProgress.pendingReviewSince = Date.now();
    itemProgress.attemptsUsed = 1;
    itemProgress.activeUploadId = uploadId(7);

    playerWs._sent.length = 0;
    await submitPhoto(room, playerWs, uploadId(7));

    expect(getLastMessage(playerWs)).toEqual({ type: 'photo_verifying', itemId: 'item-1' });
    expect(itemProgress.attemptsUsed).toBe(1);
  });

  it('evicts within the submitting player, never another team', async () => {
    const { state, room } = await createInitializedHunt({}, createVerifyingEnv());
    const { playerWs, playerId, hostId } = await startHuntWithPlayer(room, state);
    const stored = liveRoom(room);

    // A full working set for this player, plus a busy second team. Together
    // they exceed the old global cap of 50, which evicted oldest-first across
    // every team — the host's entries went first, and that team's next
    // reconnect-retry then burned a second attempt on a judged photo.
    for (let i = 0; i < 40; i++) {
      stored.completedUploads.push({ key: `${hostId}:host-${i}:x`, result: { type: 'pong' } });
    }
    for (let i = 0; i < HUNT_LIMITS.maxItems; i++) {
      stored.completedUploads.push({ key: `${playerId}:filler-${i}:x`, result: { type: 'pong' } });
    }

    const snapshots = recordPersists(state);
    vision.impl = async () => verdict(false);
    await submitPhoto(room, playerWs, uploadId(1));

    const saved = lastPersisted(snapshots).completedUploads as Array<{ key: string }>;
    const forHost = saved.filter((e) => e.key.startsWith(`${hostId}:`));
    const forPlayer = saved.filter((e) => e.key.startsWith(`${playerId}:`));

    expect(forHost).toHaveLength(40);
    expect(forPlayer).toHaveLength(HUNT_LIMITS.maxItems);
    // Their own oldest went, and only their own
    expect(forPlayer.some((e) => e.key === `${playerId}:filler-0:x`)).toBe(false);
    expect(forPlayer[forPlayer.length - 1].key).toBe(`${playerId}:item-1:${uploadId(1)}`);
  });
});

describe('ScavengerHuntRoom -- Contestable rejections', () => {
  let state: MockDurableObjectState;
  let env: Env;
  let room: ScavengerHuntRoom;

  beforeEach(async () => {
    ({ state, env, room } = await createInitializedHunt());
  });

  it('keeps a server-side verification failure contestable', async () => {
    // The photo has to have really reached R2 for its key to be contestable,
    // so this runs the upload path for real and fails in the model call
    ({ state, env, room } = await createInitializedHunt({}, createVerifyingEnv()));
    const { playerWs, playerId } = await startHuntWithPlayer(room, state);
    const snapshots = recordPersists(state);

    vision.impl = async () => {
      throw new Error('Sonnet API 529');
    };
    await submitPhoto(room, playerWs, uploadId(1));
    const stored = liveRoom(room);
    expect(lastPersisted(snapshots).progress[playerId].items['item-1'].lastRejectedPhotoUrl)
      .toBe(`HUNT-TEST/${uploadId(1)}`);

    playerWs._sent.length = 0;
    await room.webSocketMessage(
      playerWs,
      JSON.stringify({ type: 'contest_photo', itemId: 'item-1' }),
    );

    // This used to answer "No rejected photo to contest" every time
    expect(getSentMessages(playerWs).some((m: any) => m.type === 'appeal_submitted')).toBe(true);
    expect(stored.pendingAppeals[0].photoUrl).toBe(`HUNT-TEST/${uploadId(1)}`);
  });

  it('keeps a timed-out review contestable', async () => {
    const { playerWs, playerId } = await startHuntWithPlayer(room, state);

    const stored = liveRoom(room);
    const itemProgress = stored.progress[playerId].items['item-1'];
    itemProgress.status = 'pending_review';
    itemProgress.pendingReviewSince = Date.now() - 61_000;
    itemProgress.attemptsUsed = 1;
    itemProgress.activeUploadId = uploadId(2);

    // Any message during play triggers the stuck-review sweep
    await room.webSocketMessage(playerWs, JSON.stringify({ type: 'ping' }));
    expect(itemProgress.lastRejectedPhotoUrl).toBe(`HUNT-TEST/${uploadId(2)}`);

    playerWs._sent.length = 0;
    await room.webSocketMessage(
      playerWs,
      JSON.stringify({ type: 'contest_photo', itemId: 'item-1' }),
    );

    expect(getSentMessages(playerWs).some((m: any) => m.type === 'appeal_submitted')).toBe(true);
    expect(stored.pendingAppeals[0].photoUrl).toBe(`HUNT-TEST/${uploadId(2)}`);
  });
});

describe('ScavengerHuntRoom -- Clock enforcement', () => {
  it('refuses reveal_clue once the clock has run out', async () => {
    const { state, room } = await createInitializedHunt();
    const { playerWs, playerId } = await startHuntWithPlayer(room, state);

    const stored = liveRoom(room);
    stored.endsAt = Date.now() - 1000;
    // A pending verification holds the hunt in 'playing' through the
    // end-of-hunt grace — the window where a phase-only guard leaks
    const pending = stored.progress[playerId].items['item-2'];
    pending.status = 'pending_review';
    pending.pendingReviewSince = Date.now() - 500;

    playerWs._sent.length = 0;
    await room.webSocketMessage(
      playerWs,
      JSON.stringify({ type: 'reveal_clue', itemId: 'item-1', clueId: 'clue-1a' }),
    );

    expect(stored.phase).toBe('playing');
    expect(getLastMessage(playerWs)).toEqual({ type: 'error', message: 'The hunt has ended' });
    expect(stored.progress[playerId].items['item-1'].cluesRevealed).toEqual([]);
    expect(stored.progress[playerId].totalScore).toBe(0);
  });
});

describe('ScavengerHuntRoom -- Finish ordering & photo retention', () => {
  async function finish(room: ScavengerHuntRoom, state: MockDurableObjectState) {
    const stored = liveRoom(room);
    stored.nextAlarmAction = 'end_hunt';
    await state.storage.put('room', stored);
    await room.alarm();
  }

  it('commits the cleanup alarm alongside nextAlarmAction', async () => {
    const { state, room } = await createInitializedHunt();
    await startHuntWithPlayer(room, state);

    await finish(room, state);

    const stored = (await state.storage.get('room')) as any;
    expect(stored.nextAlarmAction).toBe('cleanup_hunt');
    expect(state._alarm).toBeGreaterThan(Date.now() + HUNT_EXPIRY_MS - 10_000);
  });

  it('broadcasts hunt_finished even if cleanup lands during the history write', async () => {
    const { state, env, room } = await createInitializedHunt();
    const { hostWs, playerWs } = await startHuntWithPlayer(room, state);

    // Deliver the cleanup alarm mid-KV-write: the window the old ordering left
    // open between nextAlarmAction = 'cleanup_hunt' and its setAlarm
    const originalPut = (env.TRIVIA_KV.put as any).bind(env.TRIVIA_KV);
    let fired = false;
    (env.TRIVIA_KV as any).put = async (key: string, value: string, opts?: any) => {
      if (key.startsWith('hunt-history:') && !fired) {
        fired = true;
        await room.alarm();
      }
      return originalPut(key, value, opts);
    };

    await finish(room, state);

    expect(fired).toBe(true);
    // cleanupHunt nulls the room; the results must already have gone out
    expect(getSentMessages(playerWs).some((m: any) => m.type === 'hunt_finished')).toBe(true);
    expect(getSentMessages(hostWs).some((m: any) => m.type === 'hunt_finished')).toBe(true);
  });

  it('deletes R2 photos when savePhotos is off', async () => {
    const { state, env, room } = await createInitializedHunt();
    await startHuntWithPlayer(room, state);

    const deleted: string[] = [];
    (env.R2_HUNT_PHOTOS as any).list = async () => ({
      objects: [{ key: 'HUNT-TEST/a.jpg' }, { key: 'HUNT-TEST/b.jpg' }],
      truncated: false,
    });
    (env.R2_HUNT_PHOTOS as any).delete = async (key: string) => {
      deleted.push(key);
    };

    await finish(room, state);

    expect(deleted).toEqual(['HUNT-TEST/a.jpg', 'HUNT-TEST/b.jpg']);
  });

  it('keeps R2 photos when savePhotos is on', async () => {
    const { state, env, room } = await createInitializedHunt({ savePhotos: true });
    await startHuntWithPlayer(room, state);

    let listed = false;
    (env.R2_HUNT_PHOTOS as any).list = async () => {
      listed = true;
      return { objects: [], truncated: false };
    };

    await finish(room, state);

    // History references them, so they have to survive
    expect(listed).toBe(false);
  });

  it('includes an appeal-approved photo in saved history', async () => {
    const { state, env, room } = await createInitializedHunt({ savePhotos: true });
    const { hostWs, playerId } = await startHuntWithPlayer(room, state);

    const stored = liveRoom(room);
    stored.pendingAppeals.push(makeAppeal(playerId));
    stored.progress[playerId].items['item-1'].status = 'rejected';
    stored.progress[playerId].items['item-1'].attemptsUsed = 3;

    await room.webSocketMessage(
      hostWs,
      JSON.stringify({ type: 'approve_appeal', playerId, itemId: 'item-1' }),
    );
    await finish(room, state);

    const entry = JSON.parse((await env.TRIVIA_KV.get('hunt-history:HUNT-TEST'))!);
    expect(entry.photoKeys[playerId]['item-1']).toBe('HUNT-TEST/appealed.jpg');
  });

  it('re-issues the host secret when the host reconnects after the hunt ended', async () => {
    const { state, env, room } = await createInitializedHunt();
    const { hostWs } = await startHuntWithPlayer(room, state);

    // The host happens to be offline at the moment history is saved
    state._webSockets = state._webSockets.filter((w: any) => w !== hostWs);
    await finish(room, state);

    const entry = JSON.parse((await env.TRIVIA_KV.get('hunt-history:HUNT-TEST'))!);
    const stored = (await state.storage.get('room')) as any;
    const token = stored.rejoinTokens[stored.hostId];

    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await room.webSocketMessage(
      ws2,
      JSON.stringify({
        type: 'rejoin_hunt',
        huntId: 'HUNT-TEST',
        username: 'Host',
        rejoinToken: token,
      }),
    );

    const saved = getSentMessages(ws2).find((m: any) => m.type === 'hunt_history_saved') as any;
    expect(saved).toBeDefined();
    expect(saved.hostSecret).toBe(entry.hostSecret);
  });

  it('does not re-issue the host secret to a non-host on rejoin', async () => {
    const { state, room } = await createInitializedHunt();
    const { playerWs } = await startHuntWithPlayer(room, state);

    await finish(room, state);

    const stored = (await state.storage.get('room')) as any;
    const player = stored.players.find((p: any) => p.username === 'Player1');
    state._webSockets = state._webSockets.filter((w: any) => w !== playerWs);

    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await room.webSocketMessage(
      ws2,
      JSON.stringify({
        type: 'rejoin_hunt',
        huntId: 'HUNT-TEST',
        username: 'Player1',
        rejoinToken: stored.rejoinTokens[player.id],
      }),
    );

    expect(getSentMessages(ws2).some((m: any) => m.type === 'hunt_history_saved')).toBe(false);
  });
});

// ============================================================
// Regression tests for the defects found in the hunt-room fixes
// ============================================================

/** Drive a started hunt to the finished phase through the end_hunt alarm. */
async function finishHunt(room: ScavengerHuntRoom, state: MockDurableObjectState) {
  const stored = liveRoom(room);
  stored.nextAlarmAction = 'end_hunt';
  await state.storage.put('room', stored);
  await room.alarm();
}

describe('ScavengerHuntRoom -- Host index self-heal', () => {
  const EMAIL = 'creator@example.com';

  function recordKvPuts(env: Env): Array<{ key: string; value: string; opts?: any }> {
    const puts: Array<{ key: string; value: string; opts?: any }> = [];
    const original = (env.TRIVIA_KV.put as any).bind(env.TRIVIA_KV);
    (env.TRIVIA_KV as any).put = async (key: string, value: string, opts?: any) => {
      puts.push({ key, value, opts });
      return original(key, value, opts);
    };
    return puts;
  }

  it("writes the host index in recordHuntHost's exact format", async () => {
    const { state, env, room } = await createInitializedHunt({ hostEmail: EMAIL });
    await env.TRIVIA_KV.put(`host-hunts:${EMAIL}`, JSON.stringify(['OLD-HUNT']));
    const puts = recordKvPuts(env);

    await joinPlayer(room, state, 'Host');

    // POST /api/hunts/:huntId/photos 404s "Hunt not found" unless this key
    // exists, and recordHuntHost only ever writes it at creation time — so
    // every hunt already waiting or mid-play has none and can never take
    // another photo. Nothing outside the room can repair it.
    expect(await env.TRIVIA_KV.get(`hunt-host:HUNT-TEST`)).toBe(EMAIL);
    const hostPut = puts.find((p) => p.key === 'hunt-host:HUNT-TEST');
    expect(hostPut).toBeDefined();
    expect(hostPut!.opts?.expirationTtl).toBe(90 * 24 * 60 * 60);

    // ...and the companion index GET /api/hunts/history filters on, newest
    // first and deduplicated, exactly as recordHuntHost builds it
    expect(JSON.parse((await env.TRIVIA_KV.get(`host-hunts:${EMAIL}`))!))
      .toEqual(['HUNT-TEST', 'OLD-HUNT']);
    expect(puts.find((p) => p.key === `host-hunts:${EMAIL}`)!.opts?.expirationTtl)
      .toBeUndefined();
  });

  it('writes it once per room lifetime, not once per message', async () => {
    const { state, env, room } = await createInitializedHunt({ hostEmail: EMAIL });
    const puts = recordKvPuts(env);
    const snapshots = recordPersists(state);
    const ws = await joinPlayer(room, state, 'Host');

    for (let i = 0; i < 3; i++) {
      await room.webSocketMessage(ws, JSON.stringify({ type: 'ping' }));
    }

    expect(puts.filter((p) => p.key.startsWith('hunt-host:'))).toHaveLength(1);
    expect(puts.filter((p) => p.key.startsWith('host-hunts:'))).toHaveLength(1);
    expect(lastPersisted(snapshots).hostIndexWritten).toBe(true);
  });

  it('retries on the next message when the KV write fails', async () => {
    const { state, env, room } = await createInitializedHunt({ hostEmail: EMAIL });
    const original = (env.TRIVIA_KV.put as any).bind(env.TRIVIA_KV);
    let down = true;
    (env.TRIVIA_KV as any).put = async (key: string, value: string, opts?: any) => {
      if (down && key.startsWith('hunt-host:')) throw new Error('KV unavailable');
      return original(key, value, opts);
    };

    const ws = await joinPlayer(room, state, 'Host');
    expect(await env.TRIVIA_KV.get('hunt-host:HUNT-TEST')).toBeNull();

    // A failed write must not be remembered as done — the hunt would stay
    // unable to accept photos for the rest of its life
    down = false;
    await room.webSocketMessage(ws, JSON.stringify({ type: 'ping' }));
    expect(await env.TRIVIA_KV.get('hunt-host:HUNT-TEST')).toBe(EMAIL);
  });
});

describe('ScavengerHuntRoom -- Host secret ownership', () => {
  it('does not re-issue the secret to the player who inherited hostId', async () => {
    const { state, room } = await createInitializedHunt();
    const { hostWs, playerWs, playerId } = await startHuntWithPlayer(room, state);
    await finishHunt(room, state);

    // The real host taps Leave on the results screen: handleLeave(explicit)
    // in 'finished' hands hostId to a remaining player
    await room.webSocketMessage(hostWs, JSON.stringify({ type: 'leave_hunt' }));
    const stored = (await state.storage.get('room')) as any;
    expect(stored.hostId).toBe(playerId);

    state._webSockets = state._webSockets.filter((w: any) => w !== playerWs);
    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await room.webSocketMessage(
      ws2,
      JSON.stringify({
        type: 'rejoin_hunt',
        huntId: 'HUNT-TEST',
        username: 'Player1',
        rejoinToken: stored.rejoinTokens[playerId],
      }),
    );

    // That secret deletes the real host's saved history and every R2 photo
    // with it, and bypasses canViewHunt on GET /:huntId/history
    expect(getSentMessages(ws2).some((m: any) => m.type === 'hunt_history_saved')).toBe(false);
  });

  it('still re-issues it to the host it was minted for after hostId moved on', async () => {
    const { state, env, room } = await createInitializedHunt();
    const { hostWs, hostId } = await startHuntWithPlayer(room, state);
    await finishHunt(room, state);

    await room.webSocketMessage(hostWs, JSON.stringify({ type: 'leave_hunt' }));
    const stored = (await state.storage.get('room')) as any;
    expect(stored.hostId).not.toBe(hostId);

    state._webSockets = state._webSockets.filter((w: any) => w !== hostWs);
    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await room.webSocketMessage(
      ws2,
      JSON.stringify({
        type: 'rejoin_hunt',
        huntId: 'HUNT-TEST',
        username: 'Host',
        rejoinToken: stored.rejoinTokens[hostId],
      }),
    );

    const entry = JSON.parse((await env.TRIVIA_KV.get('hunt-history:HUNT-TEST'))!);
    const saved = getSentMessages(ws2).find((m: any) => m.type === 'hunt_history_saved') as any;
    expect(saved).toBeDefined();
    expect(saved.hostSecret).toBe(entry.hostSecret);
  });

  it('falls back to the creator email for a secret minted before the owner was recorded', async () => {
    const EMAIL = 'creator@example.com';
    const { state, room } = await createInitializedHunt();
    const { hostWs, hostId } = await startHuntWithPlayer(room, state);
    const stored = liveRoom(room);
    stored.hostEmail = EMAIL;
    await finishHunt(room, state);
    // A room that saved its history before the owner was recorded
    delete stored.hostSecretOwnerId;
    state._webSockets = state._webSockets.filter((w: any) => w !== hostWs);

    // X-User-Email is set by the Worker from the session and stripped from
    // client requests, so the creator's own socket is proof enough
    const creator = createMockWebSocket();
    (creator as any).serializeAttachment({ pendingEmail: EMAIL });
    state.acceptWebSocket(creator);
    await room.webSocketMessage(
      creator,
      JSON.stringify({
        type: 'rejoin_hunt',
        huntId: 'HUNT-TEST',
        username: 'Host',
        rejoinToken: stored.rejoinTokens[hostId],
      }),
    );
    expect(getSentMessages(creator).some((m: any) => m.type === 'hunt_history_saved')).toBe(true);

    // ...and a socket with no such proof gets nothing
    state._webSockets = state._webSockets.filter((w: any) => w !== creator);
    const anon = createMockWebSocket();
    state.acceptWebSocket(anon);
    await room.webSocketMessage(
      anon,
      JSON.stringify({
        type: 'rejoin_hunt',
        huntId: 'HUNT-TEST',
        username: 'Player1',
        rejoinToken: stored.rejoinTokens[stored.hostId],
      }),
    );
    expect(getSentMessages(anon).some((m: any) => m.type === 'hunt_history_saved')).toBe(false);
  });
});

describe('ScavengerHuntRoom -- Escape hatch for exhausted attempts', () => {
  it('auto-files a host appeal once server-side failures consume the last attempt', async () => {
    // Keyless env: every submit_photo fails in getAnthropicKey, the outage
    // this is modelling
    const { state, room } = await createInitializedHunt();
    const { hostWs, playerWs, playerId } = await startHuntWithPlayer(room, state);
    const snapshots = recordPersists(state);

    // 1-2 refunded, 3-5 consume all three attempts
    for (let i = 1; i <= 5; i++) await submitPhoto(room, playerWs, uploadId(i));

    const saved = lastPersisted(snapshots);
    const item = saved.progress[playerId].items['item-1'];
    expect(item.attemptsUsed).toBe(3);
    // Without the appeal this item is terminal: submit_photo says "No
    // attempts remaining", contest_photo refuses on the same counter, and
    // 'searching' keeps checkAllTeamsComplete from ever ending the hunt
    expect(saved.pendingAppeals).toHaveLength(1);
    expect(saved.pendingAppeals[0].itemId).toBe('item-1');
    expect(item.status).toBe('rejected');
    // The host has to be able to tell this from a rejected photo
    expect(saved.pendingAppeals[0].itemDescription).toMatch(/verification failed/i);
    // Nothing ever reached R2, so there is no key to show — a dangling one
    // renders as a broken image and lands in saved history on approve
    expect(saved.pendingAppeals[0].photoUrl).toBe('');
    expect(item.lastRejectedPhotoUrl).toBeUndefined();

    expect(getSentMessages(hostWs).some((m: any) => m.type === 'appeal_received')).toBe(true);
    expect(getSentMessages(playerWs).some((m: any) => m.type === 'appeal_submitted')).toBe(true);

    // ...and the host can actually settle it
    await room.webSocketMessage(
      hostWs,
      JSON.stringify({ type: 'approve_appeal', playerId, itemId: 'item-1' }),
    );
    expect(lastPersisted(snapshots).progress[playerId].items['item-1'].status).toBe('found');
  });

  it('carries the real photo key when the upload did reach R2', async () => {
    const { state, room } = await createInitializedHunt({}, createVerifyingEnv());
    const { playerWs, playerId } = await startHuntWithPlayer(room, state);
    const snapshots = recordPersists(state);

    vision.impl = async () => {
      throw new Error('Sonnet API 529');
    };
    for (let i = 1; i <= 5; i++) await submitPhoto(room, playerWs, uploadId(i));

    const saved = lastPersisted(snapshots);
    expect(saved.pendingAppeals).toHaveLength(1);
    expect(saved.pendingAppeals[0].photoUrl).toBe(`HUNT-TEST/${uploadId(5)}`);
    expect(saved.progress[playerId].items['item-1'].lastRejectedPhotoUrl)
      .toBe(`HUNT-TEST/${uploadId(5)}`);
  });

  it('re-verifies a retried photo instead of replaying the failure', async () => {
    const { state, room } = await createInitializedHunt({}, createVerifyingEnv());
    const { playerWs, playerId } = await startHuntWithPlayer(room, state);
    const snapshots = recordPersists(state);

    let calls = 0;
    vision.impl = async () => {
      calls++;
      if (calls === 1) throw new Error('Sonnet API 529');
      return verdict(true);
    };

    await submitPhoto(room, playerWs, uploadId(1));
    expect(getLastMessage(playerWs).type).toBe('photo_rejected');

    // The client's reconnect auto-retry re-sends the same uploadId. Caching
    // the transient failure answered it from the replay cache without ever
    // re-verifying the photo, dead-ending the retry the refund exists for.
    playerWs._sent.length = 0;
    await submitPhoto(room, playerWs, uploadId(1));

    expect(calls).toBe(2);
    expect(getLastMessage(playerWs).type).toBe('photo_accepted');
    const saved = lastPersisted(snapshots);
    expect(saved.progress[playerId].items['item-1'].status).toBe('found');
    // A real verdict clears the refund streak
    expect(saved.refundedFailures[playerId]?.['item-1']).toBeUndefined();
  });
});

describe('ScavengerHuntRoom -- Stuck sweep refund cap', () => {
  async function stick(
    room: ScavengerHuntRoom,
    playerId: string,
    attemptsUsed: number,
    upload: string,
  ) {
    const stored = liveRoom(room);
    const item = stored.progress[playerId].items['item-1'];
    item.status = 'pending_review';
    item.pendingReviewSince = Date.now() - 61_000;
    item.attemptsUsed = attemptsUsed;
    item.activeUploadId = upload;
  }

  it('refunds a timed-out review only up to the cap the throwing path uses', async () => {
    const { state, room } = await createInitializedHunt();
    const { playerWs, playerId } = await startHuntWithPlayer(room, state);
    const snapshots = recordPersists(state);

    for (let i = 1; i <= 3; i++) {
      await stick(room, playerId, 1, uploadId(i));
      playerWs._sent.length = 0;
      await room.webSocketMessage(playerWs, JSON.stringify({ type: 'ping' }));
    }

    // An unconditional refund here reopened the cost-abuse vector the cap was
    // written to close — through slow verifications instead of fast-failing
    // ones — and gave two players on one degraded API opposite outcomes
    const saved = lastPersisted(snapshots);
    expect(saved.progress[playerId].items['item-1'].attemptsUsed).toBe(1);
    expect(saved.refundedFailures[playerId]['item-1']).toBe(2);
    const rejected = getSentMessages(playerWs).find((m: any) => m.type === 'photo_rejected');
    expect(rejected.attemptsRemaining).toBe(2);
  });

  it('files the same appeal when a timeout consumes the last attempt', async () => {
    const { state, room } = await createInitializedHunt();
    const { hostWs, playerWs, playerId } = await startHuntWithPlayer(room, state);
    const stored = liveRoom(room);
    stored.refundedFailures[playerId] = { 'item-1': 2 };
    await stick(room, playerId, 3, uploadId(2));

    const snapshots = recordPersists(state);
    await room.webSocketMessage(playerWs, JSON.stringify({ type: 'ping' }));

    const saved = lastPersisted(snapshots);
    expect(saved.progress[playerId].items['item-1'].attemptsUsed).toBe(3);
    expect(saved.pendingAppeals).toHaveLength(1);
    expect(saved.pendingAppeals[0].photoUrl).toBe(`HUNT-TEST/${uploadId(2)}`);
    expect(getSentMessages(hostWs).some((m: any) => m.type === 'appeal_received')).toBe(true);
  });
});

describe('ScavengerHuntRoom -- Superseded verification calls', () => {
  it('discards a late failure from a call a resubmission replaced', async () => {
    const { state, room } = await createInitializedHunt({}, createVerifyingEnv());
    const { playerWs, playerId } = await startHuntWithPlayer(room, state);
    const snapshots = recordPersists(state);

    const gates: Array<{ resolve: (v: any) => void; reject: (e: any) => void }> = [];
    vision.impl = () =>
      new Promise((resolve, reject) => {
        gates.push({ resolve, reject });
      });

    // First submission parks inside the model call
    const first = submitPhoto(room, playerWs, uploadId(1));
    await settle();
    expect(gates).toHaveLength(1);

    // The stuck sweep gives up on it and hands the item back
    const stored = liveRoom(room);
    stored.progress[playerId].items['item-1'].pendingReviewSince = Date.now() - 61_000;
    await room.webSocketMessage(playerWs, JSON.stringify({ type: 'ping' }));
    expect(stored.progress[playerId].items['item-1'].status).toBe('searching');

    // The client resubmits the same photo — the same uploadId, which is
    // exactly why activeUploadId cannot tell the two calls apart
    playerWs._sent.length = 0;
    const second = submitPhoto(room, playerWs, uploadId(1));
    await settle();
    expect(gates).toHaveLength(2);

    gates[0].reject(new Error('Sonnet API 529'));
    await first;
    gates[1].resolve(verdict(true));
    await second;

    // The stale failure used to be applied to the new call: it flipped the
    // item back to 'searching' and cleared activeUploadId, so the genuine
    // photo_accepted that arrived next was discarded
    expect(lastPersisted(snapshots).progress[playerId].items['item-1'].status).toBe('found');
    expect(getSentMessages(playerWs).some((m: any) => m.type === 'photo_accepted')).toBe(true);
    expect(getSentMessages(playerWs).filter((m: any) => m.type === 'photo_rejected')).toEqual([]);
  });
});

describe('ScavengerHuntRoom -- Departed player cleanup', () => {
  it("clears a departed player's refund counters and replay entries", async () => {
    const { state, room } = await createInitializedHunt();
    await joinPlayer(room, state, 'Host');
    const playerWs = await joinPlayer(room, state, 'Player1');

    const stored = liveRoom(room);
    const player = stored.players.find((p: any) => p.username === 'Player1');
    stored.refundedFailures[player.id] = { 'item-1': 2 };
    stored.completedUploads.push({ key: `${player.id}:item-1:x`, result: { type: 'pong' } });
    stored.completedUploads.push({ key: 'keep-me', result: { type: 'pong' } });
    stored.activeVerifications[`${player.id}:item-1`] = 'token';

    const snapshots = recordPersists(state);
    await room.webSocketMessage(playerWs, JSON.stringify({ type: 'leave_hunt' }));

    const saved = lastPersisted(snapshots);
    expect(saved.refundedFailures[player.id]).toBeUndefined();
    expect(saved.completedUploads.map((e: any) => e.key)).toEqual(['keep-me']);
    expect(saved.activeVerifications).toEqual({});
  });
});

describe('ScavengerHuntRoom -- start_hunt null guards', () => {
  it('does not deref a room that expired while the charge was in flight', async () => {
    const EMAIL = 'creator@example.com';
    const { state, env, room } = await createInitializedHunt({
      hostEmail: EMAIL,
      minPlayers: 1,
    });
    await env.TRIVIA_KV.put(
      `user:${EMAIL}`,
      JSON.stringify({ userId: 'user-1', email: EMAIL, credits: 1000, createdAt: Date.now() }),
    );
    const hostWs = await joinCreator(room, state, EMAIL);
    hostWs._sent.length = 0;

    // Deliver the expire_hunt alarm while the credit lock's KV reads hold the
    // input gate open: expireHunt() nulls this.room and deleteAll()s storage,
    // and execution resumes here after the charge has already landed
    const originalGet = (env.TRIVIA_KV.get as any).bind(env.TRIVIA_KV);
    let fired = false;
    (env.TRIVIA_KV as any).get = async (key: string, opts?: any) => {
      if (key === `user:${EMAIL}` && !fired) {
        fired = true;
        await room.alarm();
      }
      return originalGet(key, opts);
    };

    await room.webSocketMessage(hostWs, JSON.stringify({ type: 'start_hunt' }));

    expect(fired).toBe(true);
    // The unguarded deref TypeError'd into the credit catch, which told the
    // host their hunt failed to start — after it had been paid for
    expect(getSentMessages(hostWs).filter((m: any) => m.type === 'error')).toEqual([]);
    expect(state._storage.size).toBe(0);
  });
});
