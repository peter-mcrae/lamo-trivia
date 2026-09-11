import type { GameListing, TriviaCategory, HuntHistorySummary, HuntHistoryEntry } from '@lamo-trivia/shared';
import type { GameConfigInput, HuntConfigInput } from '@lamo-trivia/shared';
import { getHostSecret } from '@/hooks/useHuntHostSecrets';
import { getStoredMemberId } from '@/hooks/useGroups';

export const API_BASE = import.meta.env.VITE_API_URL || '/api';
export const AUTH_TOKEN_KEY = 'lamo_auth_token';

export function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** A failed request that kept the server's status and machine-readable code. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    // Merge rather than let a caller's `headers` replace the defaults wholesale —
    // spreading options last would silently drop Content-Type and the bearer token.
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...(options?.headers as Record<string, string> | undefined),
    },
  });
  // Detect HTML responses (e.g. SPA fallback serving index.html instead of API)
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('API is unreachable. The server returned an HTML page instead of JSON.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: `Error ${response.status}` }));
    const { error, code } = body as { error?: string; code?: string };
    throw new ApiError(error || `API error: ${response.status}`, response.status, code);
  }
  return response.json();
}

/**
 * Tie this device's group membership to the signed-in account, so the server
 * can verify it later. Sending no memberId asks the other question — "which
 * member record does my account already own?" — which is how a membership is
 * recovered on a new device.
 */
function linkGroupMember(groupId: string, memberId?: string) {
  return fetchJSON<{ memberId: string; username: string; linked: boolean }>(
    `/groups/${groupId}/members/link`,
    { method: 'POST', body: JSON.stringify(memberId ? { memberId } : {}) },
  );
}

/**
 * Recognise the server's "you are not in this group" refusal.
 *
 * Both the route-level check and the *late* one raised by the group Durable
 * Object now carry `code` — routes/groups.ts forwards it rather than dropping
 * it, which it used to do. The status-and-message fallback stays because this
 * client can meet an older backend during a deploy, where the frontend ships
 * first and the late failure still arrives bare.
 */
function isNotAMemberError(err: unknown): err is ApiError {
  if (!(err instanceof ApiError)) return false;
  if (err.code === 'NOT_A_MEMBER') return true;
  return err.status === 403 && /\bmembers?\b/i.test(err.message);
}

/**
 * Creating a game in a group requires a membership the server can verify, and
 * members who joined before account linking existed have no account on their
 * record yet. Link it and retry once rather than showing a permission error
 * for a group they have been in for months. Anything else — a genuine
 * non-member, an expired session — falls straight through.
 */
async function withMembershipRetry<T>(groupId: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!isNotAMemberError(err)) throw err;
    // `linked` is the field that says the record is now tied to this account.
    // Testing the response object itself only catches a rejected fetch — every
    // server answer, including one that linked nothing, is truthy.
    const link = await linkGroupMember(groupId, getStoredMemberId(groupId) ?? undefined)
      .catch(() => null);
    if (!link?.linked) throw err;
    return run();
  }
}

/**
 * Local-storage key holding huntId -> hostSecret. Mirrors the constant in
 * hooks/useHuntHostSecrets — that module exposes one secret at a time and has
 * no "read them all" export.
 */
const HUNT_HOST_SECRETS_KEY = 'lamo-hunt-host-secrets';

/** The history route accepts at most this many claims per request. */
const MAX_HOST_SECRET_CLAIMS = 50;

/**
 * Every host secret this device still holds, capped for the server.
 *
 * A hunt created before the server started indexing hosts by account has
 * nothing else tying it to anyone, so this secret is the only thing that can
 * still put it in its host's history. Junk entries are dropped rather than
 * sent: one value the schema rejects would fail the whole request and take the
 * rest of the list with it. `saveHostSecret` appends, so the tail of the map
 * is the most recently finished hunts — the ones worth claiming first.
 */
function getStoredHostSecrets(): Record<string, string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(HUNT_HOST_SECRETS_KEY) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const usable = Object.entries(raw as Record<string, unknown>).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && entry[1].length > 0 && entry[1].length <= 200,
    );
    return Object.fromEntries(usable.slice(-MAX_HOST_SECRET_CLAIMS));
  } catch {
    // localStorage unavailable or holding something that is not JSON
    return {};
  }
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

  linkGroupMember,

  createGroupGame: (groupId: string, config: GameConfigInput) =>
    withMembershipRetry(groupId, () =>
      fetchJSON<{ gameId: string }>(`/groups/${groupId}/games`, {
        method: 'POST',
        body: JSON.stringify(config),
      }),
    ),

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
    withMembershipRetry(groupId, () =>
      fetchJSON<{ huntId: string }>(`/groups/${groupId}/hunts`, {
        method: 'POST',
        body: JSON.stringify(config),
      }),
    ),

  // Hunt History
  //
  // POST rather than GET: the host secrets below are proof of ownership and
  // must never travel in a URL. Sending an empty map is still worth doing —
  // the signed-in account path answers on its own, and only a caller with
  // neither a session nor a secret gets a 401 (surfaced by the page like any
  // other error).
  getHuntHistory: () =>
    fetchJSON<{ hunts: HuntHistorySummary[] }>('/hunts/history', {
      method: 'POST',
      body: JSON.stringify({ hostSecrets: getStoredHostSecrets() }),
    }),

  getGroupHuntHistory: (groupId: string) =>
    fetchJSON<{ hunts: HuntHistorySummary[] }>(`/groups/${groupId}/hunts/history`),

  // Hunts created before the server-side host index existed cannot be matched
  // to an account, so send the locally stored host secret when we have one —
  // it is the only thing that still proves ownership of an older hunt.
  getHuntHistoryDetail: (huntId: string) => {
    const hostSecret = getHostSecret(huntId);
    return fetchJSON<{ hunt: Omit<HuntHistoryEntry, 'hostSecret'> }>(
      `/hunts/${huntId}/history`,
      hostSecret ? { headers: { 'X-Host-Secret': hostSecret } } : undefined,
    );
  },

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
