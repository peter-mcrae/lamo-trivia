import type { GameListing, TriviaCategory } from '@lamo-trivia/shared';
import type { GameConfigInput } from '@lamo-trivia/shared';

const API_BASE = '/api';

async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

export const api = {
  getGames: () => fetchJSON<{ games: GameListing[] }>('/games'),

  createGame: (config: GameConfigInput) =>
    fetchJSON<{ gameId: string }>('/games', {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  checkUsername: (username: string) =>
    fetchJSON<{ available: boolean }>('/username/check', {
      method: 'POST',
      body: JSON.stringify({ username }),
    }),

  getCategories: () => fetchJSON<{ categories: TriviaCategory[] }>('/categories'),

  health: () => fetchJSON<{ status: string }>('/health'),
};
