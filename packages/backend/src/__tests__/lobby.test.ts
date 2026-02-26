import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameLobby } from '../lobby';
import { createMockDurableObjectState } from './mocks';
import { GAME_EXPIRY_MS } from '@lamo-trivia/shared';

function makeGameConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Test Game',
    categoryIds: ['general'],
    questionCount: 10,
    minPlayers: 2,
    maxPlayers: 8,
    timePerQuestion: 15,
    scoringMethod: 'correct-only',
    streakBonus: false,
    showAnswers: true,
    timeBetweenQuestions: 5,
    isPrivate: false,
    ...overrides,
  };
}

async function createGame(lobby: GameLobby, overrides: Record<string, unknown> = {}) {
  const config = makeGameConfig(overrides);
  const response = await lobby.fetch(
    new Request('http://internal/games', {
      method: 'POST',
      body: JSON.stringify(config),
    }),
  );
  return response.json() as Promise<any>;
}

describe('GameLobby', () => {
  let state: ReturnType<typeof createMockDurableObjectState>;
  let lobby: GameLobby;

  beforeEach(() => {
    state = createMockDurableObjectState();
    lobby = new GameLobby(state);
  });

  it('POST /games creates a game listing and returns gameId', async () => {
    const data = await createGame(lobby);

    expect(data.gameId).toBeDefined();
    expect(typeof data.gameId).toBe('string');
    expect(data.name).toBe('Test Game');
    expect(data.phase).toBe('waiting');
  });

  it('GET /games returns only waiting, non-private, non-expired games', async () => {
    await createGame(lobby, { name: 'Public Game', isPrivate: false });

    const response = await lobby.fetch(new Request('http://internal/games'));
    const data = (await response.json()) as any;

    expect(data.games).toHaveLength(1);
    expect(data.games[0].name).toBe('Public Game');
    expect(data.games[0].phase).toBe('waiting');
    expect(data.games[0].isPrivate).toBe(false);
  });

  it('GET /games excludes private games', async () => {
    await createGame(lobby, { name: 'Public Game', isPrivate: false });
    await createGame(lobby, { name: 'Private Game', isPrivate: true });

    const response = await lobby.fetch(new Request('http://internal/games'));
    const data = (await response.json()) as any;

    expect(data.games).toHaveLength(1);
    expect(data.games[0].name).toBe('Public Game');
  });

  it('GET /games excludes expired games (older than GAME_EXPIRY_MS)', async () => {
    // Create a game normally
    await createGame(lobby, { name: 'Fresh Game' });

    // Create an expired game by manipulating the stored data
    const storedGames = (await state.storage.get('games')) as Map<string, any>;

    // Add an expired game directly to the map
    storedGames.set('EXPD-0000', {
      id: 'EXPD-0000',
      name: 'Expired Game',
      hostUsername: '',
      categoryIds: ['general'],
      questionCount: 10,
      playerCount: 0,
      minPlayers: 2,
      maxPlayers: 8,
      timePerQuestion: 15,
      scoringMethod: 'correct-only',
      streakBonus: false,
      showAnswers: true,
      isPrivate: false,
      phase: 'waiting',
      createdAt: Date.now() - GAME_EXPIRY_MS - 1000, // expired
    });
    await state.storage.put('games', storedGames);

    const response = await lobby.fetch(new Request('http://internal/games'));
    const data = (await response.json()) as any;

    expect(data.games).toHaveLength(1);
    expect(data.games[0].name).toBe('Fresh Game');
  });

  it('DELETE /games/:id removes a game', async () => {
    const created = await createGame(lobby);
    const gameId = created.gameId;

    const deleteRes = await lobby.fetch(
      new Request(`http://internal/games/${gameId}`, { method: 'DELETE' }),
    );
    const deleteData = (await deleteRes.json()) as any;
    expect(deleteData.deleted).toBe(true);

    // Verify it's gone
    const listRes = await lobby.fetch(new Request('http://internal/games'));
    const listData = (await listRes.json()) as any;
    expect(listData.games).toHaveLength(0);
  });

  it('DELETE non-existent game returns 404', async () => {
    const response = await lobby.fetch(
      new Request('http://internal/games/ZZZZ-9999', { method: 'DELETE' }),
    );

    expect(response.status).toBe(404);
    const data = (await response.json()) as any;
    expect(data.deleted).toBe(false);
  });

  it('game ID format matches pattern: 4 uppercase letters + dash + 4 digits', async () => {
    const data = await createGame(lobby);

    expect(data.gameId).toMatch(/^[A-Z]{4}-\d{4}$/);
  });
});
