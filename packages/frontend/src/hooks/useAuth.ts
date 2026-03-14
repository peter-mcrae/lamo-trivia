import { useState, useEffect, useCallback } from 'react';
import type { User } from '@lamo-trivia/shared';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const TOKEN_KEY = 'lamo_auth_token';

async function authFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
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
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const { user: u } = await authFetch<{ user: User | null }>('/auth/me');
      setUser(u);
    } catch {
      localStorage.removeItem(TOKEN_KEY);
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
    localStorage.setItem(TOKEN_KEY, token);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authFetch('/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const { user: u } = await authFetch<{ user: User | null }>('/auth/me');
    setUser(u);
    return u;
  }, []);

  return { user, loading, sendCode, verifyCode, logout, refreshUser };
}
