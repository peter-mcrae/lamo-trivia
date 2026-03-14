import { describe, it, expect, vi, beforeEach } from 'vitest';
import { app } from '../app';
import { createMockEnv, createMockKV } from './mocks';
import type { Env } from '../env';
import type { User, Session } from '@lamo-trivia/shared';

function fetchApp(request: Request, env: Env) {
  return app.fetch(request, env);
}

/** Build a mock Env with DOs that behave reasonably for hunt endpoints. */
function createHuntMockEnv(overrides: Partial<Env> = {}): Env {
  return createMockEnv({
    GAME_LOBBY: {
      idFromName: () => ({ toString: () => 'lobby-id' }),
      get: () => ({
        fetch: async (req: Request) => {
          if (req.method === 'POST') {
            return Response.json({ gameId: 'HUNT-0001' });
          }
          return Response.json({ games: [] });
        },
      }),
    } as unknown as DurableObjectNamespace,
    SCAVENGER_HUNT_ROOM: {
      idFromName: () => ({ toString: () => 'hunt-room-id' }),
      get: () => ({
        fetch: async () => Response.json({ ok: true }),
      }),
    } as unknown as DurableObjectNamespace,
    PRIVATE_GROUP: {
      idFromName: (name: string) => ({ toString: () => `group-${name}` }),
      get: () => ({
        fetch: async (req: Request) => {
          const url = new URL(req.url);
          if (req.method === 'GET' && url.pathname === '/state') {
            return Response.json({
              id: 'test-group',
              name: 'Test Group',
              createdAt: Date.now(),
              memberCount: 3,
            });
          }
          if (req.method === 'POST' && url.pathname === '/games') {
            return Response.json({ ok: true });
          }
          return new Response('Not found', { status: 404 });
        },
      }),
    } as unknown as DurableObjectNamespace,
    R2_HUNT_PHOTOS: {
      put: vi.fn(async () => ({})),
    } as unknown as R2Bucket,
    ...overrides,
  });
}

const TEST_TOKEN = 'test-session-token';
const TEST_EMAIL = 'test@example.com';
const TEST_USER_ID = 'test-user-id';

/** Seed a mock KV with an authenticated user who has plenty of credits. */
async function seedAuth(kv: KVNamespace, credits = 500) {
  const user: User = {
    userId: TEST_USER_ID,
    email: TEST_EMAIL,
    credits,
    createdAt: Date.now(),
  };
  const session: Session = {
    userId: TEST_USER_ID,
    email: TEST_EMAIL,
    expiresAt: Date.now() + 86400000,
  };
  await kv.put(`user:${TEST_EMAIL}`, JSON.stringify(user));
  await kv.put(`session:${TEST_TOKEN}`, JSON.stringify(session));
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${TEST_TOKEN}`, ...extra };
}

/** Minimal valid hunt config that satisfies HuntConfigSchema. */
function validHuntConfig() {
  return {
    name: 'Office Hunt',
    items: [
      {
        id: 'item-1',
        description: 'Find a red stapler',
        basePoints: 1000,
        clues: [],
      },
      {
        id: 'item-2',
        description: 'Find a coffee mug',
        basePoints: 500,
        clues: [{ id: 'clue-1', text: 'Check the kitchen', pointCost: 200 }],
      },
    ],
    durationMinutes: 15,
    maxRetries: 3,
    basePointsPerItem: 1000,
    hintPointCost: 200,
    minPlayers: 1,
    maxPlayers: 8,
  };
}

describe('POST /api/hunts — Create hunt', () => {
  it('creates hunt with valid config and returns huntId', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    const env = createHuntMockEnv({ TRIVIA_KV: kv });
    const request = new Request('http://localhost/api/hunts', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(validHuntConfig()),
    });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.huntId).toBeDefined();
    expect(typeof data.huntId).toBe('string');
  });

  it('rejects unauthenticated requests', async () => {
    const env = createHuntMockEnv();
    const request = new Request('http://localhost/api/hunts', {
      method: 'POST',
      body: JSON.stringify(validHuntConfig()),
    });

    const response = await fetchApp(request, env);
    expect(response.status).toBe(401);
  });

  it('rejects invalid config with missing name', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    const env = createHuntMockEnv({ TRIVIA_KV: kv });
    const config = validHuntConfig();
    (config as any).name = '';

    const request = new Request('http://localhost/api/hunts', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(config),
    });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(400);
    const data = (await response.json()) as any;
    expect(data.error).toBeDefined();
  });

  it('rejects invalid config with no items', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    const env = createHuntMockEnv({ TRIVIA_KV: kv });
    const config = { ...validHuntConfig(), items: [] };

    const request = new Request('http://localhost/api/hunts', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(config),
    });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(400);
  });

  it('rejects when minPlayers > maxPlayers', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    const env = createHuntMockEnv({ TRIVIA_KV: kv });
    const config = { ...validHuntConfig(), minPlayers: 8, maxPlayers: 2 };

    const request = new Request('http://localhost/api/hunts', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(config),
    });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(400);
  });

  it('rate limits creation', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    // Exhaust the rate limiter (10 per minute per IP)
    for (let i = 0; i < 10; i++) {
      const req = new Request('http://localhost/api/hunts', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(validHuntConfig()),
      });
      await fetchApp(req, env);
    }

    // 11th request should be rate-limited
    const request = new Request('http://localhost/api/hunts', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(validHuntConfig()),
    });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(429);
    const data = (await response.json()) as any;
    expect(data.error).toContain('Too many requests');
  });
});

describe('POST /api/hunts/:huntId/photos — Photo upload', () => {
  beforeEach(() => {
    // Reset rate limiter state by using unique IPs via headers
  });

  it('rate limits uploads', async () => {
    const env = createHuntMockEnv();

    // Exhaust the rate limiter (20 per minute per IP)
    for (let i = 0; i < 20; i++) {
      const formData = new FormData();
      formData.append('file', new File(['photo-data'], 'test.jpg', { type: 'image/jpeg' }));
      formData.append('itemId', 'item-1');
      const req = new Request('http://localhost/api/hunts/HUNT-123/photos', {
        method: 'POST',
        body: formData,
        headers: { 'CF-Connecting-IP': '10.0.0.50' },
      });
      await fetchApp(req, env);
    }

    const formData = new FormData();
    formData.append('file', new File(['photo-data'], 'test.jpg', { type: 'image/jpeg' }));
    formData.append('itemId', 'item-1');
    const request = new Request('http://localhost/api/hunts/HUNT-123/photos', {
      method: 'POST',
      body: formData,
      headers: { 'CF-Connecting-IP': '10.0.0.50' },
    });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(429);
  });

  it('rejects missing file', async () => {
    const env = createHuntMockEnv();
    const formData = new FormData();
    formData.append('itemId', 'item-1');
    // No file appended

    const request = new Request('http://localhost/api/hunts/HUNT-123/photos', {
      method: 'POST',
      body: formData,
      headers: { 'CF-Connecting-IP': '10.0.0.100' },
    });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(400);
    const data = (await response.json()) as any;
    expect(data.error).toContain('Missing file or itemId');
  });

  it('rejects oversized files (>5MB)', async () => {
    const env = createHuntMockEnv();
    // Create a file larger than 5MB
    const largeData = new Uint8Array(6 * 1024 * 1024); // 6MB
    const formData = new FormData();
    formData.append('file', new File([largeData], 'huge.jpg', { type: 'image/jpeg' }));
    formData.append('itemId', 'item-1');

    const request = new Request('http://localhost/api/hunts/HUNT-123/photos', {
      method: 'POST',
      body: formData,
      headers: { 'CF-Connecting-IP': '10.0.0.101' },
    });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(400);
    const data = (await response.json()) as any;
    expect(data.error).toContain('Photo too large');
  });

  it('rejects invalid file types', async () => {
    const env = createHuntMockEnv();
    const formData = new FormData();
    formData.append('file', new File(['not-an-image'], 'doc.pdf', { type: 'application/pdf' }));
    formData.append('itemId', 'item-1');

    const request = new Request('http://localhost/api/hunts/HUNT-123/photos', {
      method: 'POST',
      body: formData,
      headers: { 'CF-Connecting-IP': '10.0.0.102' },
    });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(400);
    const data = (await response.json()) as any;
    expect(data.error).toContain('Invalid file type');
  });
});

describe('POST /api/groups/:groupId/hunts — Group hunt', () => {
  it('creates hunt in group with valid config', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    const env = createHuntMockEnv({ TRIVIA_KV: kv });
    const request = new Request('http://localhost/api/groups/test-group-id/hunts', {
      method: 'POST',
      body: JSON.stringify(validHuntConfig()),
      headers: { ...authHeaders(), 'CF-Connecting-IP': '10.0.0.200' },
    });

    const response = await fetchApp(request, env);

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.huntId).toBeDefined();
    expect(typeof data.huntId).toBe('string');
  });
});
