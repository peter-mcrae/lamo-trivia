import type { GameListing, TriviaCategory, HuntHistorySummary, HuntHistoryEntry } from '@lamo-trivia/shared';
import type { GameConfigInput, HuntConfigInput } from '@lamo-trivia/shared';

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

  // Scavenger Hunts
  createHunt: (config: HuntConfigInput) =>
    fetchJSON<{ huntId: string }>('/hunts', {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  uploadHuntPhoto: async (huntId: string, file: Blob, itemId: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('itemId', itemId);

    const response = await fetch(`${API_BASE}/hunts/${huntId}/photos`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error((error as { error: string }).error || 'Upload failed');
    }
    return response.json() as Promise<{ uploadId: string }>;
  },

  createGroupHunt: (groupId: string, config: HuntConfigInput) =>
    fetchJSON<{ huntId: string }>(`/groups/${groupId}/hunts`, {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  // Hunt History
  getHuntHistory: () =>
    fetchJSON<{ hunts: HuntHistorySummary[] }>('/hunts/history'),

  getHuntHistoryDetail: (huntId: string) =>
    fetchJSON<{ hunt: Omit<HuntHistoryEntry, 'hostSecret'> }>(`/hunts/${huntId}/history`),

  deleteHuntHistory: async (huntId: string, hostSecret: string) => {
    const response = await fetch(`${API_BASE}/hunts/${huntId}/history`, {
      method: 'DELETE',
      headers: { 'X-Host-Secret': hostSecret },
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Delete failed' }));
      throw new Error((error as { error: string }).error || 'Delete failed');
    }
    return response.json() as Promise<{ ok: boolean }>;
  },

  getHuntPhotoUrl: (huntId: string, photoFileName: string) =>
    `${API_BASE}/hunts/${huntId}/photos/${photoFileName}`,
};
