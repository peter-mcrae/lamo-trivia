import { describe, it, expect, vi, beforeEach } from 'vitest';
import { app } from '../app';
import { createMockEnv } from './mocks';
import type { Env } from '../env';

function fetchApp(request: Request, env: Env) {
  return app.fetch(request, env);
}

describe('Router - Seed endpoint auth', () => {
  it('POST /api/seed without Authorization header returns 401', async () => {
    const env = createMockEnv({ SEED_SECRET: 'my-secret' } as any);
    const request = new Request('http://localhost/api/seed', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(401);
    const data = (await response.json()) as any;
    expect(data.error).toBe('Unauthorized');
  });

  it('POST /api/seed with wrong token returns 401', async () => {
    const env = createMockEnv({ SEED_SECRET: 'my-secret' } as any);
    const request = new Request('http://localhost/api/seed', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-token' },
      body: JSON.stringify({}),
    });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(401);
    const data = (await response.json()) as any;
    expect(data.error).toBe('Unauthorized');
  });

  it('POST /api/seed with correct Bearer token returns 200', async () => {
    const env = createMockEnv({ SEED_SECRET: 'my-secret' } as any);
    const seedData = {
      general: [
        {
          id: 'q1',
          text: 'Test question?',
          options: ['A', 'B', 'C', 'D'],
          correctIndex: 0,
          categoryId: 'general',
        },
      ],
    };
    const request = new Request('http://localhost/api/seed', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer my-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(seedData),
    });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.seeded).toBe(true);
    expect(data.counts).toEqual({ general: 1 });
  });

  it('POST /api/seed with empty SEED_SECRET env returns 401', async () => {
    const env = createMockEnv({ SEED_SECRET: '' } as any);
    const request = new Request('http://localhost/api/seed', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' },
      body: JSON.stringify({}),
    });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(401);
  });

  it('GET /api/health returns 200 with status ok', async () => {
    const env = createMockEnv();
    const request = new Request('http://localhost/api/health', { method: 'GET' });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.status).toBe('ok');
    expect(data.timestamp).toBeDefined();
  });

  it('unknown route returns 404', async () => {
    const env = createMockEnv();
    const request = new Request('http://localhost/api/nonexistent', { method: 'GET' });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(404);
  });
});

describe('Router - Group endpoints', () => {
  const TEST_TOKEN = 'test-session-token';
  const TEST_USER = {
    userId: 'user-1',
    email: 'test@example.com',
    credits: 100,
    createdAt: Date.now(),
  };
  const TEST_SESSION = {
    userId: TEST_USER.userId,
    email: TEST_USER.email,
    expiresAt: Date.now() + 3_600_000,
  };

  /** Create a group mock env with a valid auth session seeded into KV */
  async function createGroupMockEnvWithAuth(): Promise<Env> {
    const env = createGroupMockEnv();
    await env.TRIVIA_KV.put(`session:${TEST_TOKEN}`, JSON.stringify(TEST_SESSION));
    await env.TRIVIA_KV.put(`user:${TEST_USER.email}`, JSON.stringify(TEST_USER));
    return env;
  }

  function createGroupMockEnv(): Env {
    return createMockEnv({
      PRIVATE_GROUP: {
        idFromName: (name: string) => ({ toString: () => `group-${name}` }),
        get: () => ({
          fetch: async (req: Request) => {
            const url = new URL(req.url);

            // POST /init
            if (req.method === 'POST' && url.pathname === '/init') {
              return Response.json({ ok: true, groupId: 'test-group-id' });
            }

            // GET /state
            if (req.method === 'GET' && url.pathname === '/state') {
              return Response.json({
                id: 'brave-mountain-golden-river',
                name: 'McRae Family',
                createdAt: Date.now(),
                memberCount: 2,
              });
            }

            // POST /games
            if (req.method === 'POST' && url.pathname === '/games') {
              return Response.json({ ok: true });
            }

            return new Response('Not found', { status: 404 });
          },
        }),
      } as unknown as DurableObjectNamespace,
      GAME_LOBBY: {
        idFromName: () => ({ toString: () => 'lobby-id' }),
        get: () => ({
          fetch: async (req: Request) => {
            if (req.method === 'POST') {
              return Response.json({ gameId: 'TEST-0001', name: 'Test Game', phase: 'waiting' });
            }
            return Response.json({ games: [] });
          },
        }),
      } as unknown as DurableObjectNamespace,
      GAME_ROOM: {
        idFromName: () => ({ toString: () => 'room-id' }),
        get: () => ({
          fetch: async () => Response.json({ ok: true }),
        }),
      } as unknown as DurableObjectNamespace,
    });
  }

  // --- POST /api/groups ---

  it('POST /api/groups without auth returns 401', async () => {
    const env = createGroupMockEnv();
    const request = new Request('http://localhost/api/groups', {
      method: 'POST',
      body: JSON.stringify({ name: 'McRae Family' }),
    });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(401);
  });

  it('POST /api/groups with valid name creates a group', async () => {
    const env = await createGroupMockEnvWithAuth();
    const request = new Request('http://localhost/api/groups', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      body: JSON.stringify({ name: 'McRae Family' }),
    });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.groupId).toBeDefined();
    expect(typeof data.groupId).toBe('string');
    expect(data.groupId.split('-')).toHaveLength(4);
    expect(data.name).toBe('McRae Family');
  });

  it('POST /api/groups with empty name returns 400', async () => {
    const env = await createGroupMockEnvWithAuth();
    const request = new Request('http://localhost/api/groups', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      body: JSON.stringify({ name: '' }),
    });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(400);
  });

  it('POST /api/groups with name exceeding 50 characters returns 400', async () => {
    const env = await createGroupMockEnvWithAuth();
    const request = new Request('http://localhost/api/groups', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      body: JSON.stringify({ name: 'x'.repeat(51) }),
    });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(400);
  });

  // --- GET /api/groups/:groupId ---

  it('GET /api/groups/:groupId returns group info for valid group', async () => {
    const env = createGroupMockEnv();
    const request = new Request('http://localhost/api/groups/brave-mountain-golden-river', {
      method: 'GET',
    });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.id).toBe('brave-mountain-golden-river');
    expect(data.name).toBe('McRae Family');
    expect(data.memberCount).toBe(2);
  });

  it('GET /api/groups/:groupId returns 404 when group not found', async () => {
    const env = createMockEnv({
      PRIVATE_GROUP: {
        idFromName: () => ({ toString: () => 'group-id' }),
        get: () => ({
          fetch: async () => Response.json({ error: 'Group not found' }, { status: 404 }),
        }),
      } as unknown as DurableObjectNamespace,
    });

    const request = new Request('http://localhost/api/groups/nonexistent-group-id-here', {
      method: 'GET',
    });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(404);
  });

  // --- POST /api/groups/:groupId/games ---

  it('POST /api/groups/:groupId/games creates a game with isPrivate forced to true', async () => {
    const env = createGroupMockEnv();
    const request = new Request('http://localhost/api/groups/brave-mountain-golden-river/games', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Group Game',
        categoryIds: ['general'],
        questionCount: 10,
        isPrivate: false, // should be overridden to true
      }),
    });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.gameId).toBeDefined();
  });

  it('POST /api/groups/:groupId/games returns 400 for invalid game config', async () => {
    const env = createGroupMockEnv();
    const request = new Request('http://localhost/api/groups/brave-mountain-golden-river/games', {
      method: 'POST',
      body: JSON.stringify({
        name: '',
        categoryIds: [],
        questionCount: 2, // below minimum of 5
      }),
    });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(400);
  });

  it('POST /api/groups/:groupId/games returns 404 when group does not exist', async () => {
    const env = createMockEnv({
      PRIVATE_GROUP: {
        idFromName: () => ({ toString: () => 'group-id' }),
        get: () => ({
          fetch: async () => Response.json({ error: 'Group not found' }, { status: 404 }),
        }),
      } as unknown as DurableObjectNamespace,
    });

    const request = new Request('http://localhost/api/groups/nonexistent-id/games', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Test Game',
        categoryIds: ['general'],
        questionCount: 10,
      }),
    });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(404);
  });
});
