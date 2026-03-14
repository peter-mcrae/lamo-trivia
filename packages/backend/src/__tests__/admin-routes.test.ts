import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRequest } from '../router';
import { createMockEnv } from './mocks';
import type { Env } from '../env';

function adminRequest(path: string, opts: RequestInit = {}, secret = 'admin-secret') {
  return new Request(`http://localhost${path}`, {
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
    ...opts,
  });
}

describe('Admin Routes', () => {
  let env: Env;

  beforeEach(() => {
    vi.restoreAllMocks();
    env = createMockEnv({ SEED_SECRET: 'admin-secret' } as any);
  });

  describe('Authentication', () => {
    it('returns 401 without Authorization header', async () => {
      const request = new Request('http://localhost/api/admin/users');
      const response = await handleRequest(request, env);
      expect(response.status).toBe(401);
    });

    it('returns 401 with wrong token', async () => {
      const request = adminRequest('/api/admin/users', {}, 'wrong-token');
      const response = await handleRequest(request, env);
      expect(response.status).toBe(401);
    });

    it('returns 200 with correct token', async () => {
      const request = adminRequest('/api/admin/users');
      const response = await handleRequest(request, env);
      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/admin/users', () => {
    it('returns empty user list when no users exist', async () => {
      const request = adminRequest('/api/admin/users');
      const response = await handleRequest(request, env);
      const data = (await response.json()) as any;
      expect(data.users).toEqual([]);
      expect(data.complete).toBe(true);
    });

    it('returns users from KV', async () => {
      const user = { userId: 'u1', email: 'test@example.com', credits: 50, createdAt: Date.now() };
      await env.TRIVIA_KV.put('user:test@example.com', JSON.stringify(user));

      const request = adminRequest('/api/admin/users');
      const response = await handleRequest(request, env);
      const data = (await response.json()) as any;
      expect(data.users).toHaveLength(1);
      expect(data.users[0].email).toBe('test@example.com');
    });

    it('filters users by search prefix', async () => {
      const u1 = { userId: 'u1', email: 'alice@example.com', credits: 10, createdAt: Date.now() };
      const u2 = { userId: 'u2', email: 'bob@example.com', credits: 20, createdAt: Date.now() };
      await env.TRIVIA_KV.put('user:alice@example.com', JSON.stringify(u1));
      await env.TRIVIA_KV.put('user:bob@example.com', JSON.stringify(u2));

      const request = adminRequest('/api/admin/users?search=alice');
      const response = await handleRequest(request, env);
      const data = (await response.json()) as any;
      expect(data.users).toHaveLength(1);
      expect(data.users[0].email).toBe('alice@example.com');
    });
  });

  describe('GET /api/admin/users/:email', () => {
    it('returns 404 for non-existent user', async () => {
      const request = adminRequest('/api/admin/users/nonexistent@example.com');
      const response = await handleRequest(request, env);
      expect(response.status).toBe(404);
    });

    it('returns user detail with transactions', async () => {
      const user = { userId: 'u1', email: 'test@example.com', credits: 50, createdAt: Date.now() };
      await env.TRIVIA_KV.put('user:test@example.com', JSON.stringify(user));

      const request = adminRequest('/api/admin/users/test%40example.com');
      const response = await handleRequest(request, env);
      const data = (await response.json()) as any;
      expect(data.user.email).toBe('test@example.com');
      expect(data.transactions).toEqual([]);
    });
  });

  describe('POST /api/admin/users/:email/credits', () => {
    it('adjusts user credits and records transaction', async () => {
      const user = { userId: 'u1', email: 'test@example.com', credits: 50, createdAt: Date.now() };
      await env.TRIVIA_KV.put('user:test@example.com', JSON.stringify(user));

      const request = adminRequest('/api/admin/users/test%40example.com/credits', {
        method: 'POST',
        body: JSON.stringify({ amount: 25, reason: 'Bonus credits' }),
      });
      const response = await handleRequest(request, env);
      const data = (await response.json()) as any;
      expect(data.newBalance).toBe(75);

      // Verify user was updated in KV
      const updated = JSON.parse((await env.TRIVIA_KV.get('user:test@example.com'))!);
      expect(updated.credits).toBe(75);

      // Verify transaction was recorded
      const txRaw = await env.TRIVIA_KV.get(`transactions:u1`);
      const txs = JSON.parse(txRaw!);
      expect(txs).toHaveLength(1);
      expect(txs[0].amount).toBe(25);
      expect(txs[0].type).toBe('admin_credit');
      expect(txs[0].details).toContain('dev-admin@local');
    });

    it('rejects negative resulting balance', async () => {
      const user = { userId: 'u1', email: 'test@example.com', credits: 10, createdAt: Date.now() };
      await env.TRIVIA_KV.put('user:test@example.com', JSON.stringify(user));

      const request = adminRequest('/api/admin/users/test%40example.com/credits', {
        method: 'POST',
        body: JSON.stringify({ amount: -20, reason: 'Deduction' }),
      });
      const response = await handleRequest(request, env);
      expect(response.status).toBe(400);
    });

    it('requires non-zero integer amount', async () => {
      const user = { userId: 'u1', email: 'test@example.com', credits: 10, createdAt: Date.now() };
      await env.TRIVIA_KV.put('user:test@example.com', JSON.stringify(user));

      const request = adminRequest('/api/admin/users/test%40example.com/credits', {
        method: 'POST',
        body: JSON.stringify({ amount: 0, reason: 'Test' }),
      });
      const response = await handleRequest(request, env);
      expect(response.status).toBe(400);
    });

    it('requires a reason', async () => {
      const user = { userId: 'u1', email: 'test@example.com', credits: 10, createdAt: Date.now() };
      await env.TRIVIA_KV.put('user:test@example.com', JSON.stringify(user));

      const request = adminRequest('/api/admin/users/test%40example.com/credits', {
        method: 'POST',
        body: JSON.stringify({ amount: 5 }),
      });
      const response = await handleRequest(request, env);
      expect(response.status).toBe(400);
    });

    it('returns 404 for non-existent user', async () => {
      const request = adminRequest('/api/admin/users/nobody%40example.com/credits', {
        method: 'POST',
        body: JSON.stringify({ amount: 5, reason: 'Test' }),
      });
      const response = await handleRequest(request, env);
      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/admin/analytics/overview', () => {
    it('returns aggregate counts', async () => {
      const request = adminRequest('/api/admin/analytics/overview');
      const response = await handleRequest(request, env);
      const data = (await response.json()) as any;
      expect(data.totalUsers).toBe(0);
      expect(data.eventCounts).toEqual({});
      expect(data.totalErrors).toBe(0);
    });

    it('counts users and events correctly', async () => {
      await env.TRIVIA_KV.put('user:a@b.com', JSON.stringify({ email: 'a@b.com' }));
      await env.TRIVIA_KV.put('user:c@d.com', JSON.stringify({ email: 'c@d.com' }));
      await env.TRIVIA_KV.put('evt:game_created:2026-01-01:abc', '{}', {
        metadata: { type: 'game_created' },
      });
      await env.TRIVIA_KV.put('error:2026-01-01:xyz', '{}');

      const request = adminRequest('/api/admin/analytics/overview');
      const response = await handleRequest(request, env);
      const data = (await response.json()) as any;
      expect(data.totalUsers).toBe(2);
      expect(data.eventCounts.game_created).toBe(1);
      expect(data.totalErrors).toBe(1);
    });
  });

  describe('GET /api/admin/analytics/events', () => {
    it('returns events with metadata', async () => {
      await env.TRIVIA_KV.put('evt:game_created:2026-01-01:abc', '{}', {
        metadata: { type: 'game_created', ts: 1704067200000 },
      });

      const request = adminRequest('/api/admin/analytics/events');
      const response = await handleRequest(request, env);
      const data = (await response.json()) as any;
      expect(data.events).toHaveLength(1);
      expect(data.events[0].metadata.type).toBe('game_created');
    });

    it('filters by type', async () => {
      await env.TRIVIA_KV.put('evt:game_created:2026-01-01:abc', '{}', {
        metadata: { type: 'game_created' },
      });
      await env.TRIVIA_KV.put('evt:hunt_created:2026-01-01:def', '{}', {
        metadata: { type: 'hunt_created' },
      });

      const request = adminRequest('/api/admin/analytics/events?type=game_created');
      const response = await handleRequest(request, env);
      const data = (await response.json()) as any;
      expect(data.events).toHaveLength(1);
      expect(data.events[0].metadata.type).toBe('game_created');
    });
  });

  describe('GET /api/admin/errors', () => {
    it('returns errors from KV', async () => {
      await env.TRIVIA_KV.put('error:2026-01-01:abc', JSON.stringify({ message: 'test' }), {
        metadata: { route: '/api/test', msg: 'test' },
      });

      const request = adminRequest('/api/admin/errors');
      const response = await handleRequest(request, env);
      const data = (await response.json()) as any;
      expect(data.errors).toHaveLength(1);
      expect(data.errors[0].metadata.msg).toBe('test');
    });
  });

  describe('DELETE /api/admin/sessions/:token', () => {
    it('deletes session from KV', async () => {
      await env.TRIVIA_KV.put('session:abc123def456', JSON.stringify({ email: 'test@test.com' }));

      const request = adminRequest('/api/admin/sessions/abc123def456', { method: 'DELETE' });
      const response = await handleRequest(request, env);
      const data = (await response.json()) as any;
      expect(data.ok).toBe(true);

      const session = await env.TRIVIA_KV.get('session:abc123def456');
      expect(session).toBeNull();
    });

    it('rejects short token', async () => {
      const request = adminRequest('/api/admin/sessions/short', { method: 'DELETE' });
      const response = await handleRequest(request, env);
      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/admin/games/active', () => {
    it('fetches all games from lobby DO', async () => {
      const request = adminRequest('/api/admin/games/active');
      const response = await handleRequest(request, env);
      const data = (await response.json()) as any;
      // Default mock returns { games: [] }
      expect(data.games).toEqual([]);
    });
  });

  describe('Admin route 404', () => {
    it('returns 404 for unknown admin paths', async () => {
      const request = adminRequest('/api/admin/unknown');
      const response = await handleRequest(request, env);
      expect(response.status).toBe(404);
    });
  });
});
