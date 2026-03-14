import type { User, CreditTransaction, Coupon } from '@lamo-trivia/shared';

const API_BASE = '/api/admin';

async function adminFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: `Error ${response.status}` }));
    throw new Error((body as { error: string }).error || `Admin API error: ${response.status}`);
  }
  return response.json();
}

export interface AdminOverview {
  totalUsers: number;
  eventCounts: Record<string, number>;
  totalErrors: number;
}

export interface AdminUserListResponse {
  users: User[];
  cursor: string | null;
  complete: boolean;
}

export interface AdminUserDetailResponse {
  user: User;
  transactions: CreditTransaction[];
}

export interface AdminEventsResponse {
  events: Array<{ key: string; metadata: unknown }>;
  cursor: string | null;
  complete: boolean;
}

export interface AdminErrorsResponse {
  errors: Array<{ key: string; metadata: unknown }>;
  cursor: string | null;
  complete: boolean;
}

export interface AdminGamesResponse {
  games: Array<Record<string, unknown>>;
}

export const adminApi = {
  listUsers: (params?: { search?: string; cursor?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.cursor) qs.set('cursor', params.cursor);
    if (params?.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    return adminFetch<AdminUserListResponse>(`/users${query ? `?${query}` : ''}`);
  },

  getUser: (email: string) =>
    adminFetch<AdminUserDetailResponse>(`/users/${encodeURIComponent(email)}`),

  adjustCredits: (email: string, amount: number, reason: string) =>
    adminFetch<{ user: User; newBalance: number }>(
      `/users/${encodeURIComponent(email)}/credits`,
      {
        method: 'POST',
        body: JSON.stringify({ amount, reason }),
      },
    ),

  getOverview: () => adminFetch<AdminOverview>('/analytics/overview'),

  getEvents: (params?: { type?: string; date?: string; cursor?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.type) qs.set('type', params.type);
    if (params?.date) qs.set('date', params.date);
    if (params?.cursor) qs.set('cursor', params.cursor);
    if (params?.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    return adminFetch<AdminEventsResponse>(`/analytics/events${query ? `?${query}` : ''}`);
  },

  getActiveGames: () => adminFetch<AdminGamesResponse>('/games/active'),

  getErrors: (params?: { cursor?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.cursor) qs.set('cursor', params.cursor);
    if (params?.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    return adminFetch<AdminErrorsResponse>(`/errors${query ? `?${query}` : ''}`);
  },

  forceLogout: (token: string) =>
    adminFetch<{ ok: boolean }>(`/sessions/${encodeURIComponent(token)}`, { method: 'DELETE' }),

  // Coupons
  listCoupons: (params?: { cursor?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.cursor) qs.set('cursor', params.cursor);
    if (params?.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    return adminFetch<{ coupons: Coupon[]; cursor: string | null; complete: boolean }>(
      `/coupons${query ? `?${query}` : ''}`,
    );
  },

  createCoupon: (opts: {
    code?: string;
    credits: number;
    maxUses?: number;
    expiresInDays?: number;
    note?: string;
  }) =>
    adminFetch<{ coupon: Coupon }>('/coupons', {
      method: 'POST',
      body: JSON.stringify(opts),
    }),

  sendCoupon: (code: string, opts: { to: string; senderName?: string; message?: string }) =>
    adminFetch<{ ok: boolean; sentTo: string }>(
      `/coupons/${encodeURIComponent(code)}/send`,
      {
        method: 'POST',
        body: JSON.stringify(opts),
      },
    ),

  deleteCoupon: (code: string) =>
    adminFetch<{ ok: boolean }>(`/coupons/${encodeURIComponent(code)}`, {
      method: 'DELETE',
    }),
};
