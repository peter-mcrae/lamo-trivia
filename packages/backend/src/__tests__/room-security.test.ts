import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameRoom } from '../room';
import { createMockDurableObjectState, createMockWebSocket, createMockEnv, getSentMessages } from './mocks';

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
