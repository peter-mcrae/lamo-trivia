import type { GameListing, TriviaCategory, HuntHistorySummary, HuntHistoryEntry } from '@lamo-trivia/shared';
import type { GameConfigInput, HuntConfigInput } from '@lamo-trivia/shared';

export const API_BASE = import.meta.env.VITE_API_URL || '/api';
export const AUTH_TOKEN_KEY = 'lamo_auth_token';

export function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    ...options,
  });
  // Detect HTML responses (e.g. SPA fallback serving index.html instead of API)
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('API is unreachable. The server returned an HTML page instead of JSON.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: `Error ${response.status}` }));
    throw new Error((body as { error: string }).error || `API error: ${response.status}`);
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
    fetchJSON<{ id: string; name: string; createdAt: number; ownerEmail?: string; memberCount: number }>(
      `/groups/${groupId}`,
    ),

  getMyGroups: () =>
    fetchJSON<{ groups: { groupId: string; name: string }[] }>('/groups/my'),

  deleteGroup: (groupId: string) =>
    fetchJSON<{ ok: boolean }>(`/groups/${groupId}`, { method: 'DELETE' }),

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
    // Explicit filename ensures Content-Type header is set correctly in the
    // multipart body across all browsers (some omit it for raw Blobs).
    formData.append('file', file, 'photo.jpg');
    formData.append('itemId', itemId);

    const response = await fetch(`${API_BASE}/hunts/${huntId}/photos`, {
      method: 'POST',
      headers: getAuthHeaders(),
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

  getGroupHuntHistory: (groupId: string) =>
    fetchJSON<{ hunts: HuntHistorySummary[] }>(`/groups/${groupId}/hunts/history`),

  getHuntHistoryDetail: (huntId: string) =>
    fetchJSON<{ hunt: Omit<HuntHistoryEntry, 'hostSecret'> }>(`/hunts/${huntId}/history`),

  deleteHuntHistory: async (huntId: string, hostSecret: string) => {
    const response = await fetch(`${API_BASE}/hunts/${huntId}/history`, {
      method: 'DELETE',
      headers: { 'X-Host-Secret': hostSecret, ...getAuthHeaders() },
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Delete failed' }));
      throw new Error((error as { error: string }).error || 'Delete failed');
    }
    return response.json() as Promise<{ ok: boolean }>;
  },

  getHuntPhotoUrl: (huntId: string, photoFileName: string) =>
    `${API_BASE}/hunts/${huntId}/photos/${photoFileName}`,

  redeemCoupon: (code: string) =>
    fetchJSON<{ credits: number; newBalance: number }>('/coupons/redeem', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
};
