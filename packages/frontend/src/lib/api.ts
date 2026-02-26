import type { GameListing, TriviaCategory } from '@lamo-trivia/shared';
import type { GameConfigInput } from '@lamo-trivia/shared';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

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

  // Groups
  createGroup: (name: string) =>
    fetchJSON<{ groupId: string; name: string }>('/groups', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  getGroup: (groupId: string) =>
    fetchJSON<{ id: string; name: string; createdAt: number; memberCount: number }>(
      `/groups/${groupId}`,
    ),

  createGroupGame: (groupId: string, config: GameConfigInput) =>
    fetchJSON<{ gameId: string }>(`/groups/${groupId}/games`, {
      method: 'POST',
      body: JSON.stringify(config),
    }),
};
