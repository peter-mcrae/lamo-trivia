import { describe, it, expect, vi, beforeEach } from 'vitest';
import { app } from '../app';
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

function fetchApp(request: Request, env: Env) {
  return app.fetch(request, env);
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
      const response = await fetchApp(request, env);
      expect(response.status).toBe(401);
    });

    it('returns 401 with wrong token', async () => {
      const request = adminRequest('/api/admin/users', {}, 'wrong-token');
      const response = await fetchApp(request, env);
      expect(response.status).toBe(401);
    });

    it('returns 200 with correct token', async () => {
      const request = adminRequest('/api/admin/users');
      const response = await fetchApp(request, env);
      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/admin/users', () => {
    it('returns empty user list when no users exist', async () => {
      const request = adminRequest('/api/admin/users');
      const response = await fetchApp(request, env);
      const data = (await response.json()) as any;
      expect(data.users).toEqual([]);
      expect(data.complete).toBe(true);
    });

    it('returns users from KV', async () => {
      const user = { userId: 'u1', email: 'test@example.com', credits: 50, createdAt: Date.now() };
      await env.TRIVIA_KV.put('user:test@example.com', JSON.stringify(user));

      const request = adminRequest('/api/admin/users');
      const response = await fetchApp(request, env);
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
      const response = await fetchApp(request, env);
      const data = (await response.json()) as any;
      expect(data.users).toHaveLength(1);
      expect(data.users[0].email).toBe('alice@example.com');
    });
  });

  describe('GET /api/admin/users/:email', () => {
    it('returns 404 for non-existent user', async () => {
      const request = adminRequest('/api/admin/users/nonexistent@example.com');
      const response = await fetchApp(request, env);
      expect(response.status).toBe(404);
    });

    it('returns user detail with transactions', async () => {
      const user = { userId: 'u1', email: 'test@example.com', credits: 50, createdAt: Date.now() };
      await env.TRIVIA_KV.put('user:test@example.com', JSON.stringify(user));

      const request = adminRequest('/api/admin/users/test%40example.com');
      const response = await fetchApp(request, env);
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
        body: JSON.stringify({ amount: 25, reason: 'Bonus credits', requestId: 'req-bonus' }),
      });
      const response = await fetchApp(request, env);
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
        body: JSON.stringify({ amount: -20, reason: 'Deduction', requestId: 'req-deduct' }),
      });
      const response = await fetchApp(request, env);
      expect(response.status).toBe(400);
    });

    it('requires non-zero integer amount', async () => {
      const user = { userId: 'u1', email: 'test@example.com', credits: 10, createdAt: Date.now() };
      await env.TRIVIA_KV.put('user:test@example.com', JSON.stringify(user));

      const request = adminRequest('/api/admin/users/test%40example.com/credits', {
        method: 'POST',
        body: JSON.stringify({ amount: 0, reason: 'Test', requestId: 'req-zero' }),
      });
      const response = await fetchApp(request, env);
      expect(response.status).toBe(400);
    });

    it('requires a reason', async () => {
      const user = { userId: 'u1', email: 'test@example.com', credits: 10, createdAt: Date.now() };
      await env.TRIVIA_KV.put('user:test@example.com', JSON.stringify(user));

      const request = adminRequest('/api/admin/users/test%40example.com/credits', {
        method: 'POST',
        body: JSON.stringify({ amount: 5, requestId: 'req-noreason' }),
      });
      const response = await fetchApp(request, env);
      expect(response.status).toBe(400);
    });

    it('returns 404 for non-existent user', async () => {
      const request = adminRequest('/api/admin/users/nobody%40example.com/credits', {
        method: 'POST',
        body: JSON.stringify({ amount: 5, reason: 'Test', requestId: 'req-nobody' }),
      });
      const response = await fetchApp(request, env);
      expect(response.status).toBe(404);
    });

    async function seedUser(credits: number) {
      await env.TRIVIA_KV.put(
        'user:test@example.com',
        JSON.stringify({ userId: 'u1', email: 'test@example.com', credits, createdAt: Date.now() }),
      );
    }

    function adjust(body: Record<string, unknown>) {
      return fetchApp(
        adminRequest('/api/admin/users/test%40example.com/credits', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
        env,
      );
    }

    async function balance(): Promise<number> {
      return JSON.parse((await env.TRIVIA_KV.get('user:test@example.com'))!).credits;
    }

    it('applies two identical deliberate adjustments twice', async () => {
      await seedUser(50);

      // The idempotency key must not be scoped to the user alone — an admin
      // granting the same amount twice on purpose has to land twice. Which two
      // calls are "the same" is the caller's to declare, so these carry
      // distinct requestIds. The key used to be derived from Date.now(), which
      // made this test a coin flip: two fully-awaited requests routinely share
      // a millisecond, and the second was then swallowed.
      const first = (await (await adjust({ amount: 25, reason: 'Bonus', requestId: 'req-a' })).json()) as any;
      const second = (await (await adjust({ amount: 25, reason: 'Bonus', requestId: 'req-b' })).json()) as any;

      expect(first.newBalance).toBe(75);
      expect(second.newBalance).toBe(100);
      expect(await balance()).toBe(100);

      const txs = JSON.parse((await env.TRIVIA_KV.get('transactions:u1'))!);
      expect(txs).toHaveLength(2);
    });

    it('refuses an adjustment that does not name its request', async () => {
      await seedUser(50);

      // Without a caller-supplied id there is no way to tell a retry from a
      // second deliberate adjustment. Refusing is the only answer that can't
      // silently drop one of them.
      const response = await adjust({ amount: 25, reason: 'Bonus' });

      expect(response.status).toBe(400);
      expect(((await response.json()) as any).error).toMatch(/requestId is required/);
      expect(await balance()).toBe(50);
      expect(await env.TRIVIA_KV.get('transactions:u1')).toBeNull();
    });

    it('reports whether the adjustment applied or was a replayed request', async () => {
      await seedUser(50);

      const first = (await (await adjust({ amount: 25, reason: 'Bonus', requestId: 'req-x' })).json()) as any;
      const replay = (await (await adjust({ amount: 25, reason: 'Bonus', requestId: 'req-x' })).json()) as any;

      // Both are 200 with the same balance; only `applied` tells them apart.
      expect(first.applied).toBe(true);
      expect(replay.applied).toBe(false);
      expect(replay.newBalance).toBe(75);
    });

    it('collapses a retry that reuses the same requestId', async () => {
      await seedUser(50);

      const first = (await (await adjust({ amount: 25, reason: 'Bonus', requestId: 'req-1' })).json()) as any;
      const retry = (await (await adjust({ amount: 25, reason: 'Bonus', requestId: 'req-1' })).json()) as any;

      expect(first.newBalance).toBe(75);
      expect(retry.newBalance).toBe(75);
      expect(await balance()).toBe(75);

      const txs = JSON.parse((await env.TRIVIA_KV.get('transactions:u1'))!);
      expect(txs).toHaveLength(1);
    });

    it('rejects a malformed requestId', async () => {
      await seedUser(50);
      const response = await adjust({ amount: 25, reason: 'Bonus', requestId: 'bad id!' });
      expect(response.status).toBe(400);
      expect(await balance()).toBe(50);
    });

    it('does not clobber a grant that lands after the balance was read', async () => {
      await seedUser(50);

      // The route reads the user once to check for a negative result. That
      // snapshot used to be what got written back, so anything credited in
      // between was silently reverted.
      const originalGet = (env.TRIVIA_KV.get as any).bind(env.TRIVIA_KV);
      const originalPut = (env.TRIVIA_KV.put as any).bind(env.TRIVIA_KV);
      let injected = false;
      (env.TRIVIA_KV as any).get = async (key: string, opts?: any) => {
        const value = await originalGet(key, opts);
        if (key === 'user:test@example.com' && !injected) {
          injected = true;
          const stale = JSON.parse(value);
          await originalPut(
            'user:test@example.com',
            JSON.stringify({ ...stale, credits: stale.credits + 100 }),
          );
        }
        return value;
      };

      const data = (await (await adjust({ amount: 25, reason: 'Bonus', requestId: 'req-race' })).json()) as any;

      expect(injected).toBe(true);
      expect(await balance()).toBe(175);
      expect(data.newBalance).toBe(175);
    });

    it('refuses a debit the balance can no longer cover instead of clipping it', async () => {
      await seedUser(30);

      // Same injection, the other way: the balance drops out from under the
      // pre-check, so the debit reaches the lock too large for the balance it
      // finds there. It used to be floored at zero and reported as a success —
      // 20 credits requested, 5 actually taken, and a ledger row claiming 20.
      const originalGet = (env.TRIVIA_KV.get as any).bind(env.TRIVIA_KV);
      const originalPut = (env.TRIVIA_KV.put as any).bind(env.TRIVIA_KV);
      let injected = false;
      (env.TRIVIA_KV as any).get = async (key: string, opts?: any) => {
        const value = await originalGet(key, opts);
        if (key === 'user:test@example.com' && !injected) {
          injected = true;
          const stale = JSON.parse(value);
          await originalPut(
            'user:test@example.com',
            JSON.stringify({ ...stale, credits: 5 }),
          );
        }
        return value;
      };

      const response = await adjust({ amount: -20, reason: 'Chargeback', requestId: 'req-cb' });
      const data = (await response.json()) as any;

      expect(injected).toBe(true);
      expect(response.status).toBe(409);
      expect(data.error).toMatch(/negative balance/);

      // Nothing moved: no partial debit, and no ledger row for one either.
      expect(await balance()).toBe(5);
      expect(await env.TRIVIA_KV.get('transactions:u1')).toBeNull();

      // ...and the refusal left no marker behind, so the same request works
      // once the balance can carry it.
      await originalPut(
        'user:test@example.com',
        JSON.stringify({ userId: 'u1', email: 'test@example.com', credits: 60, createdAt: Date.now() }),
      );
      const retry = (await (await adjust({ amount: -20, reason: 'Chargeback', requestId: 'req-cb' })).json()) as any;
      expect(retry.applied).toBe(true);
      expect(retry.newBalance).toBe(40);

      const txs = JSON.parse((await env.TRIVIA_KV.get('transactions:u1'))!);
      expect(txs).toHaveLength(1);
      // The ledger records what actually moved.
      expect(txs[0].amount).toBe(-20);
    });
  });

  describe('GET /api/admin/analytics/overview', () => {
    it('returns aggregate counts', async () => {
      const request = adminRequest('/api/admin/analytics/overview');
      const response = await fetchApp(request, env);
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
      const response = await fetchApp(request, env);
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
      const response = await fetchApp(request, env);
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
      const response = await fetchApp(request, env);
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
      const response = await fetchApp(request, env);
      const data = (await response.json()) as any;
      expect(data.errors).toHaveLength(1);
      expect(data.errors[0].metadata.msg).toBe('test');
    });
  });

  describe('DELETE /api/admin/sessions/:token', () => {
    const validToken = 'a'.repeat(64); // 64-char hex string

    it('deletes session from KV', async () => {
      await env.TRIVIA_KV.put(`session:${validToken}`, JSON.stringify({ email: 'test@test.com' }));

      const request = adminRequest(`/api/admin/sessions/${validToken}`, { method: 'DELETE' });
      const response = await fetchApp(request, env);
      const data = (await response.json()) as any;
      expect(data.ok).toBe(true);

      const session = await env.TRIVIA_KV.get(`session:${validToken}`);
      expect(session).toBeNull();
    });

    it('rejects short token', async () => {
      const request = adminRequest('/api/admin/sessions/short', { method: 'DELETE' });
      const response = await fetchApp(request, env);
      expect(response.status).toBe(400);
    });

    it('rejects non-hex token', async () => {
      const request = adminRequest(`/api/admin/sessions/${'z'.repeat(64)}`, { method: 'DELETE' });
      const response = await fetchApp(request, env);
      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/admin/games/active', () => {
    it('fetches all games from lobby DO', async () => {
      const request = adminRequest('/api/admin/games/active');
      const response = await fetchApp(request, env);
      const data = (await response.json()) as any;
      // Default mock returns { games: [] }
      expect(data.games).toEqual([]);
    });
  });

  describe('Input validation', () => {
    it('rejects invalid email parameter with special chars', async () => {
      const request = adminRequest('/api/admin/users/%3Cscript%3Ealert(1)%3C%2Fscript%3E');
      const response = await fetchApp(request, env);
      expect(response.status).toBe(400);
    });

    it('rejects invalid search parameter', async () => {
      const request = adminRequest('/api/admin/users?search=<script>alert(1)</script>');
      const response = await fetchApp(request, env);
      expect(response.status).toBe(400);
    });

    it('rejects invalid event type', async () => {
      const request = adminRequest('/api/admin/analytics/events?type=invalid_type');
      const response = await fetchApp(request, env);
      expect(response.status).toBe(400);
    });

    it('rejects invalid date format', async () => {
      const request = adminRequest('/api/admin/analytics/events?type=game_created&date=not-a-date');
      const response = await fetchApp(request, env);
      expect(response.status).toBe(400);
    });

    it('accepts valid date format YYYY-MM-DD', async () => {
      const request = adminRequest('/api/admin/analytics/events?type=game_created&date=2026-01-15');
      const response = await fetchApp(request, env);
      expect(response.status).toBe(200);
    });

    it('rejects credit amount exceeding max', async () => {
      const user = { userId: 'u1', email: 'test@example.com', credits: 0, createdAt: Date.now() };
      await env.TRIVIA_KV.put('user:test@example.com', JSON.stringify(user));

      const request = adminRequest('/api/admin/users/test%40example.com/credits', {
        method: 'POST',
        body: JSON.stringify({ amount: 2_000_000, reason: 'Too much', requestId: 'req-toobig' }),
      });
      const response = await fetchApp(request, env);
      expect(response.status).toBe(400);
    });
  });

  describe('Admin route 404', () => {
    it('returns 404 for unknown admin paths', async () => {
      const request = adminRequest('/api/admin/unknown');
      const response = await fetchApp(request, env);
      expect(response.status).toBe(404);
    });
  });
});
