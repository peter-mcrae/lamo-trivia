import { useState, useEffect, useCallback } from 'react';
import type { User } from '@lamo-trivia/shared';
import { API_BASE, AUTH_TOKEN_KEY, getAuthHeaders } from '@/lib/api';

async function authFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...((options?.headers as Record<string, string>) ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error((body as { error: string }).error || `Error ${res.status}`);
  }
  return res.json();
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const validateSession = useCallback(async () => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const { user: u } = await authFetch<{ user: User | null }>('/auth/me');
      setUser(u);
    } catch {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    validateSession();
  }, [validateSession]);

  const sendCode = useCallback(async (email: string) => {
    await authFetch('/auth/send-code', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }, []);

  const verifyCode = useCallback(async (email: string, code: string) => {
    const { token, user: u } = await authFetch<{ token: string; user: User }>(
      '/auth/verify-code',
      { method: 'POST', body: JSON.stringify({ email, code }) },
    );
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authFetch('/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const { user: u } = await authFetch<{ user: User | null }>('/auth/me');
      setUser(u);
      return u;
    } catch {
      // Session may have expired
      localStorage.removeItem(AUTH_TOKEN_KEY);
      setUser(null);
      return null;
    }
  }, []);

  return { user, loading, sendCode, verifyCode, logout, refreshUser };
}
