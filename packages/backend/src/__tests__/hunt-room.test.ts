import { describe, it, expect, beforeEach } from 'vitest';
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
import { HUNT_EXPIRY_MS } from '@lamo-trivia/shared';

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

async function createInitializedHunt(overrides: Record<string, unknown> = {}) {
  const state = createMockDurableObjectState();
  const env = createMockEnv();
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

  it('join_hunt adds player and sends hunt_state', async () => {
    const ws = await joinPlayer(room, state, 'Alice');

    const msgs = getSentMessages(ws);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('hunt_state');
    expect(msgs[0].state.id).toBe('HUNT-TEST');
    expect(msgs[0].state.phase).toBe('waiting');
    expect(msgs[0].state.players).toHaveLength(1);
    expect(msgs[0].state.players[0].username).toBe('Alice');
  });

  it('join_hunt broadcasts player_joined to others', async () => {
    const ws1 = await joinPlayer(room, state, 'Alice');
    ws1._sent.length = 0;

    const ws2 = await joinPlayer(room, state, 'Bob');

    // ws2 gets hunt_state
    const ws2Msgs = getSentMessages(ws2);
    expect(ws2Msgs[0].type).toBe('hunt_state');
    expect(ws2Msgs[0].state.players).toHaveLength(2);

    // ws1 gets player_joined broadcast
    const ws1Msgs = getSentMessages(ws1);
    expect(ws1Msgs.some((m: any) => m.type === 'player_joined')).toBe(true);
    const joinedMsg = ws1Msgs.find((m: any) => m.type === 'player_joined');
    expect(joinedMsg.player.username).toBe('Bob');
  });

  it('join_hunt first player becomes host', async () => {
    const ws = await joinPlayer(room, state, 'Alice');

    const msgs = getSentMessages(ws);
    const huntState = msgs[0].state;
    expect(huntState.hostId).toBe(huntState.players[0].id);
  });

  it('join_hunt rejects duplicate usernames (case insensitive)', async () => {
    await joinPlayer(room, state, 'Alice');

    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await room.webSocketMessage(
      ws2,
      JSON.stringify({ type: 'join_hunt', huntId: 'HUNT-TEST', username: 'alice' }),
    );

    const msgs = getSentMessages(ws2);
    expect(msgs[0].type).toBe('error');
    expect(msgs[0].message).toBe('Username already taken');
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

  it('webSocketClose triggers leave', async () => {
    const ws1 = await joinPlayer(room, state, 'Alice');
    const ws2 = await joinPlayer(room, state, 'Bob');
    ws1._sent.length = 0;
    ws2._sent.length = 0;

    await room.webSocketClose(ws2);

    const ws1Msgs = getSentMessages(ws1);
    expect(ws1Msgs.some((m: any) => m.type === 'player_left')).toBe(true);

    const stored = (await state.storage.get('room')) as any;
    expect(stored.players).toHaveLength(1);
    expect(stored.players[0].username).toBe('Alice');
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

  it('claim_host rejects outside waiting phase', async () => {
    const { hostWs, playerWs } = await startHuntWithPlayer(room, state);

    // Player tries to claim host during playing phase
    await room.webSocketMessage(playerWs, JSON.stringify({ type: 'claim_host' }));

    const msgs = getSentMessages(playerWs);
    expect(msgs[0].type).toBe('error');
    expect(msgs[0].message).toBe('Can only claim host during waiting phase');
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

  it('rejects oversized messages (>2048 chars)', async () => {
    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);

    const oversizedMessage = JSON.stringify({
      type: 'join_hunt',
      huntId: 'HUNT-TEST',
      username: 'A'.repeat(3000),
    });
    expect(oversizedMessage.length).toBeGreaterThan(2048);

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
    state._webSockets = state._webSockets.filter((ws: any) => ws !== hostWs);
    const hostWs2 = createMockWebSocket();
    state.acceptWebSocket(hostWs2);
    await room.webSocketMessage(
      hostWs2,
      JSON.stringify({ type: 'rejoin_hunt', huntId: 'HUNT-TEST', username: 'Host' }),
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
    state._webSockets = state._webSockets.filter((ws: any) => ws !== playerWs);
    const playerWs2 = createMockWebSocket();
    state.acceptWebSocket(playerWs2);
    await room.webSocketMessage(
      playerWs2,
      JSON.stringify({ type: 'rejoin_hunt', huntId: 'HUNT-TEST', username: 'Player1' }),
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
    state._webSockets = state._webSockets.filter((ws: any) => ws !== playerWs);

    // Rejoin with a new WebSocket
    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await room.webSocketMessage(
      ws2,
      JSON.stringify({ type: 'rejoin_hunt', huntId: 'HUNT-TEST', username: 'Player1' }),
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
    state._webSockets = state._webSockets.filter((ws: any) => ws !== playerWs);

    // Rejoin
    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await room.webSocketMessage(
      ws2,
      JSON.stringify({ type: 'rejoin_hunt', huntId: 'HUNT-TEST', username: 'Bob' }),
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
    state._webSockets = state._webSockets.filter((ws: any) => ws !== playerWs);

    // Try join_hunt (not rejoin_hunt) — should auto-redirect to rejoin
    const ws2 = createMockWebSocket();
    state.acceptWebSocket(ws2);
    await room.webSocketMessage(
      ws2,
      JSON.stringify({ type: 'join_hunt', huntId: 'HUNT-TEST', username: 'Player1' }),
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
    state._webSockets = state._webSockets.filter((ws: any) => ws !== hostWs);

    // Host reconnects
    const hostWs2 = createMockWebSocket();
    state.acceptWebSocket(hostWs2);
    await room.webSocketMessage(
      hostWs2,
      JSON.stringify({ type: 'rejoin_hunt', huntId: 'HUNT-TEST', username: 'Host' }),
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
    const stored = (await state.storage.get('room')) as any;
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
    const stored = (await state.storage.get('room')) as any;
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

    const stored = (await state.storage.get('room')) as any;
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
    let stored = (await state.storage.get('room')) as any;
    stored.nextAlarmAction = 'end_hunt';
    await state.storage.put('room', stored);
    await room.alarm();

    // Trigger cleanup alarm
    stored = (await state.storage.get('room')) as any;
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

    const stored = (await state.storage.get('room')) as any;
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
