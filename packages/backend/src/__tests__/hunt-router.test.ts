import { describe, it, expect, vi, beforeEach } from 'vitest';
import { app } from '../app';
import worker from '../index';
import { createMockEnv, createMockKV } from './mocks';
import type { Env } from '../env';
import type { User, Session, HuntHistorySummary } from '@lamo-trivia/shared';

function fetchApp(request: Request, env: Env) {
  return app.fetch(request, env);
}

/** Build a mock Env with DOs that behave reasonably for hunt endpoints. */
function createHuntMockEnv(
  overrides: Partial<Env> = {},
  groupOwnerEmail = TEST_EMAIL,
  groupMemberEmails: string[] = [],
): Env {
  return createMockEnv({
    GAME_LOBBY: {
      idFromName: () => ({ toString: () => 'lobby-id' }),
      get: () => ({
        fetch: async (req: Request) => {
          if (req.method === 'POST') {
            return Response.json({ gameId: TEST_HUNT_ID });
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
            const includeOwner = url.searchParams.get('includeOwner') === '1';
            return Response.json({
              id: 'test-group',
              name: 'Test Group',
              createdAt: Date.now(),
              ...(includeOwner ? { ownerEmail: groupOwnerEmail } : {}),
              memberCount: 3,
            });
          }
          if (req.method === 'POST' && url.pathname === '/games') {
            return Response.json({ ok: true });
          }
          if (req.method === 'GET' && url.pathname === '/membership') {
            const caller = (req.headers.get('X-Caller-Email') ?? '').toLowerCase();
            if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
            return Response.json({
              isOwner: caller === groupOwnerEmail.toLowerCase(),
              isMember:
                caller === groupOwnerEmail.toLowerCase()
                || groupMemberEmails.some((e) => e.toLowerCase() === caller),
              linkedMemberCount: groupMemberEmails.length,
            });
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
// Hunt IDs come from the lobby, which allocates them in the game-ID format
const TEST_HUNT_ID = 'ABCD-1234';

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

/** Mark a hunt as existing, the way hunt creation does. */
async function seedHunt(kv: KVNamespace, huntId = TEST_HUNT_ID, hostEmail = TEST_EMAIL) {
  await kv.put(`hunt-host:${huntId}`, hostEmail);
  const existing = (await kv.get<string[]>(`host-hunts:${hostEmail}`, 'json')) ?? [];
  await kv.put(`host-hunts:${hostEmail}`, JSON.stringify([huntId, ...existing]));
}

/** Store a finished hunt the way ScavengerHuntRoom does when it wraps up. */
async function seedHuntHistory(
  kv: KVNamespace,
  opts: { huntId: string; hostEmail?: string; groupId?: string; name?: string },
) {
  const summary: HuntHistorySummary = {
    huntId: opts.huntId,
    name: opts.name ?? 'Office Hunt',
    hostUsername: 'alice',
    teamCount: 2,
    winnerUsername: 'bob',
    winnerScore: 1200,
    totalItems: 2,
    finishedAt: Date.now(),
    ...(opts.groupId ? { groupId: opts.groupId } : {}),
  };
  const entry = {
    huntId: opts.huntId,
    config: { name: summary.name, items: [], savePhotos: true },
    hostUsername: 'alice',
    hostSecret: 'super-secret',
    players: [{ id: 'p1', username: 'alice' }, { id: 'p2', username: 'bob' }],
    results: { rankings: [] },
    photoKeys: { p1: { 'item-1': `${opts.huntId}/photo.jpg` } },
    createdAt: Date.now(),
    startedAt: Date.now(),
    finishedAt: summary.finishedAt,
    ...(opts.groupId ? { groupId: opts.groupId } : {}),
  };
  await kv.put(`hunt-history:${opts.huntId}`, JSON.stringify(entry), { metadata: summary });
  if (opts.hostEmail) {
    await seedHunt(kv, opts.huntId, opts.hostEmail);
  }
}

/** A buffer that starts with real JPEG magic bytes */
function jpegBytes(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0xFF, 0xD8, 0xFF, 0xE0]);
  return bytes;
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

  it('records the creator so history stays scoped to them', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    const env = createHuntMockEnv({ TRIVIA_KV: kv });
    const request = new Request('http://localhost/api/hunts', {
      method: 'POST',
      headers: authHeaders({ 'CF-Connecting-IP': '10.0.1.1' }),
      body: JSON.stringify(validHuntConfig()),
    });

    const response = await fetchApp(request, env);
    const { huntId } = (await response.json()) as any;

    expect(await kv.get(`hunt-host:${huntId}`)).toBe(TEST_EMAIL);
    expect(await kv.get(`host-hunts:${TEST_EMAIL}`, 'json')).toContain(huntId);
  });

  it('ignores a client-supplied groupId so a hunt cannot be stapled to a group', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    const roomConfigs: any[] = [];
    const lobbyConfigs: any[] = [];
    const env = createHuntMockEnv({
      TRIVIA_KV: kv,
      GAME_LOBBY: {
        idFromName: () => ({ toString: () => 'lobby-id' }),
        get: () => ({
          fetch: async (req: Request) => {
            lobbyConfigs.push(await req.json());
            return Response.json({ gameId: TEST_HUNT_ID });
          },
        }),
      } as unknown as DurableObjectNamespace,
      SCAVENGER_HUNT_ROOM: {
        idFromName: () => ({ toString: () => 'hunt-room-id' }),
        get: () => ({
          fetch: async (req: Request) => {
            roomConfigs.push(await req.json());
            return Response.json({ ok: true });
          },
        }),
      } as unknown as DurableObjectNamespace,
    });

    const response = await fetchApp(
      new Request('http://localhost/api/hunts', {
        method: 'POST',
        headers: authHeaders({ 'CF-Connecting-IP': '10.0.6.1' }),
        body: JSON.stringify({ ...validHuntConfig(), groupId: 'victim-group-id' }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    // Only the group route may set groupId — a hunt that carried one here
    // would land in that group's history and hand its owner read access.
    expect(roomConfigs).toHaveLength(1);
    expect(roomConfigs[0].groupId).toBeUndefined();
    expect(lobbyConfigs[0].groupId).toBeUndefined();
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

  /** Env whose KV already knows about TEST_HUNT_ID */
  async function createUploadEnv(): Promise<Env> {
    const kv = createMockKV();
    await seedHunt(kv);
    return createHuntMockEnv({ TRIVIA_KV: kv });
  }

  function uploadRequest(
    body: BodyInit,
    ip: string,
    huntId = TEST_HUNT_ID,
  ): Request {
    return new Request(`http://localhost/api/hunts/${huntId}/photos`, {
      method: 'POST',
      body,
      headers: { 'CF-Connecting-IP': ip },
    });
  }

  function photoForm(file: File): FormData {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('itemId', 'item-1');
    return formData;
  }

  it('stores a real image and returns its upload id', async () => {
    const env = await createUploadEnv();
    const file = new File([jpegBytes()], 'photo.jpg', { type: 'image/jpeg' });

    const response = await fetchApp(uploadRequest(photoForm(file), '10.0.0.40'), env);

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.uploadId).toMatch(/^[0-9a-f-]{36}\.jpg$/);
  });

  it('rejects a file that only claims to be an image', async () => {
    const env = await createUploadEnv();
    // Arbitrary bytes labelled image/jpeg — the content has to agree
    const file = new File(['not-actually-an-image'], 'photo.jpg', { type: 'image/jpeg' });

    const response = await fetchApp(uploadRequest(photoForm(file), '10.0.0.41'), env);

    expect(response.status).toBe(400);
    const data = (await response.json()) as any;
    expect(data.error).toContain('Invalid file type');
  });

  it('trusts the magic bytes over a wrong declared type', async () => {
    const env = await createUploadEnv();
    const png = new Uint8Array(64);
    png.set([0x89, 0x50, 0x4E, 0x47]);
    const file = new File([png], 'photo.jpg', { type: 'image/jpeg' });

    const response = await fetchApp(uploadRequest(photoForm(file), '10.0.0.42'), env);

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.uploadId).toMatch(/\.png$/);
  });

  it('rejects uploads to a hunt that does not exist', async () => {
    const env = await createUploadEnv();
    const file = new File([jpegBytes()], 'photo.jpg', { type: 'image/jpeg' });

    const response = await fetchApp(
      uploadRequest(photoForm(file), '10.0.0.43', 'ZZZZ-9999'),
      env,
    );

    expect(response.status).toBe(404);
    expect(env.R2_HUNT_PHOTOS.put).not.toHaveBeenCalled();
  });

  it('refuses an upload to a hunt that has already finished', async () => {
    const kv = createMockKV();
    await seedHuntHistory(kv, { huntId: TEST_HUNT_ID, hostEmail: TEST_EMAIL });
    const env = createHuntMockEnv({ TRIVIA_KV: kv });
    const file = new File([jpegBytes()], 'photo.jpg', { type: 'image/jpeg' });

    const response = await fetchApp(uploadRequest(photoForm(file), '10.0.0.45'), env);

    expect(response.status).toBe(409);
    expect(env.R2_HUNT_PHOTOS.put).not.toHaveBeenCalled();
  });

  it('rate limits uploads', async () => {
    const env = await createUploadEnv();

    // Exhaust the rate limiter (20 per minute per IP)
    for (let i = 0; i < 20; i++) {
      const file = new File([jpegBytes()], 'photo.jpg', { type: 'image/jpeg' });
      await fetchApp(uploadRequest(photoForm(file), '10.0.0.50'), env);
    }

    const file = new File([jpegBytes()], 'photo.jpg', { type: 'image/jpeg' });
    const response = await fetchApp(uploadRequest(photoForm(file), '10.0.0.50'), env);

    expect(response.status).toBe(429);
  });

  it('rejects missing file', async () => {
    const env = await createUploadEnv();
    const formData = new FormData();
    formData.append('itemId', 'item-1');
    // No file appended

    const response = await fetchApp(uploadRequest(formData, '10.0.0.100'), env);

    expect(response.status).toBe(400);
    const data = (await response.json()) as any;
    expect(data.error).toContain('Missing file or itemId');
  });

  it('rejects oversized files (>5MB)', async () => {
    const env = await createUploadEnv();
    // Create a file larger than 5MB
    const largeData = jpegBytes(6 * 1024 * 1024); // 6MB
    const file = new File([largeData], 'huge.jpg', { type: 'image/jpeg' });

    const response = await fetchApp(uploadRequest(photoForm(file), '10.0.0.101'), env);

    expect(response.status).toBe(400);
    const data = (await response.json()) as any;
    expect(data.error).toContain('Photo too large');
  });

  it('rejects invalid file types', async () => {
    const env = await createUploadEnv();
    const file = new File(['not-an-image'], 'doc.pdf', { type: 'application/pdf' });

    const response = await fetchApp(uploadRequest(photoForm(file), '10.0.0.102'), env);

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

describe('GET /api/hunts/history — History listing', () => {
  it('rejects unauthenticated callers', async () => {
    const kv = createMockKV();
    await seedHuntHistory(kv, { huntId: TEST_HUNT_ID, hostEmail: 'someone@example.com' });
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    const response = await fetchApp(
      new Request('http://localhost/api/hunts/history', {
        headers: { 'CF-Connecting-IP': '10.0.2.1' },
      }),
      env,
    );

    expect(response.status).toBe(401);
  });

  it('lists only hunts the caller hosted', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    await seedHuntHistory(kv, { huntId: TEST_HUNT_ID, hostEmail: TEST_EMAIL, name: 'Mine' });
    await seedHuntHistory(kv, {
      huntId: 'WXYZ-5678',
      hostEmail: 'stranger@example.com',
      name: 'Somebody else\'s',
    });
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    const response = await fetchApp(
      new Request('http://localhost/api/hunts/history', {
        headers: authHeaders({ 'CF-Connecting-IP': '10.0.2.2' }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.hunts).toHaveLength(1);
    expect(data.hunts[0].huntId).toBe(TEST_HUNT_ID);
  });

  it('includes hunts played in a group the caller owns', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    await kv.put(`owner-groups:${TEST_EMAIL}`, JSON.stringify(['brave-mountain-golden-river']));
    await seedHuntHistory(kv, {
      huntId: 'WXYZ-5678',
      hostEmail: 'member@example.com',
      groupId: 'brave-mountain-golden-river',
    });
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    const response = await fetchApp(
      new Request('http://localhost/api/hunts/history', {
        headers: authHeaders({ 'CF-Connecting-IP': '10.0.2.3' }),
      }),
      env,
    );

    const data = (await response.json()) as any;
    expect(data.hunts.map((h: any) => h.huntId)).toEqual(['WXYZ-5678']);
  });
});

describe('GET /api/hunts/:huntId/history — History detail', () => {
  it('rejects unauthenticated callers', async () => {
    const kv = createMockKV();
    await seedHuntHistory(kv, { huntId: TEST_HUNT_ID, hostEmail: TEST_EMAIL });
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    const response = await fetchApp(
      new Request(`http://localhost/api/hunts/${TEST_HUNT_ID}/history`, {
        headers: { 'CF-Connecting-IP': '10.0.3.1' },
      }),
      env,
    );

    expect(response.status).toBe(401);
  });

  it('refuses a signed-in caller who had nothing to do with the hunt', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    await seedHuntHistory(kv, { huntId: TEST_HUNT_ID, hostEmail: 'stranger@example.com' });
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    const response = await fetchApp(
      new Request(`http://localhost/api/hunts/${TEST_HUNT_ID}/history`, {
        headers: authHeaders({ 'CF-Connecting-IP': '10.0.3.2' }),
      }),
      env,
    );

    expect(response.status).toBe(403);
  });

  it('returns the hunt to its host without the host secret', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    await seedHuntHistory(kv, { huntId: TEST_HUNT_ID, hostEmail: TEST_EMAIL });
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    const response = await fetchApp(
      new Request(`http://localhost/api/hunts/${TEST_HUNT_ID}/history`, {
        headers: authHeaders({ 'CF-Connecting-IP': '10.0.3.3' }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.hunt.huntId).toBe(TEST_HUNT_ID);
    expect(data.hunt.hostSecret).toBeUndefined();
    expect(data.hunt.photoKeys).toBeDefined();
  });

  // --- X-Host-Secret fallback -----------------------------------------
  //
  // The host index (hunt-host:{huntId}) only exists for hunts created after it
  // was introduced, so this header is the only way the host of an older hunt
  // can still read it. Its batch sibling (POST /api/hunts/history) is well
  // covered; this single-hunt header path is separate code, and a wrong header
  // name or an inverted check here would hand any caller anybody's hunt.

  function detailRequest(
    huntId: string,
    ip: string,
    headers: Record<string, string> = {},
  ) {
    return new Request(`http://localhost/api/hunts/${huntId}/history`, {
      headers: { 'CF-Connecting-IP': ip, ...headers },
    });
  }

  it('lets a signed-out holder of the host secret read the hunt', async () => {
    const kv = createMockKV();
    // No hostEmail and no session: exactly the shape of a hunt from before the
    // host index existed, read by the host who still has the secret.
    await seedHuntHistory(kv, { huntId: TEST_HUNT_ID });
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    const response = await fetchApp(
      detailRequest(TEST_HUNT_ID, '10.0.3.10', { 'X-Host-Secret': SEEDED_HOST_SECRET }),
      env,
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.hunt.huntId).toBe(TEST_HUNT_ID);
    expect(data.hunt.photoKeys).toBeDefined();
    // The secret must never come back out of the endpoint it unlocks.
    expect(data.hunt.hostSecret).toBeUndefined();
  });

  it('lets the secret stand in for ownership when the session belongs to someone else', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    await seedHuntHistory(kv, { huntId: TEST_HUNT_ID, hostEmail: 'stranger@example.com' });
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    const response = await fetchApp(
      detailRequest(TEST_HUNT_ID, '10.0.3.11', {
        ...authHeaders(),
        'X-Host-Secret': SEEDED_HOST_SECRET,
      }),
      env,
    );

    // Without the secret this exact request is a 403 (see the test above).
    expect(response.status).toBe(200);
    expect(((await response.json()) as any).hunt.hostSecret).toBeUndefined();
  });

  it('refuses a wrong host secret instead of treating it as proof', async () => {
    const kv = createMockKV();
    await seedHuntHistory(kv, { huntId: TEST_HUNT_ID });
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    // Same length as the real one, and a prefix of it: an inverted or
    // truncating comparison would let both through.
    for (const [i, bad] of ['super-secrxt', 'super', `${SEEDED_HOST_SECRET}x`].entries()) {
      const response = await fetchApp(
        detailRequest(TEST_HUNT_ID, `10.0.3.2${i}`, { 'X-Host-Secret': bad }),
        env,
      );
      expect(response.status).toBe(401);
      expect((await response.json()) as any).toEqual({ error: 'Sign in to view hunt history' });
    }
  });

  it('refuses a hunt to a signed-in stranger carrying the wrong secret', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    await seedHuntHistory(kv, { huntId: TEST_HUNT_ID, hostEmail: 'stranger@example.com' });
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    const response = await fetchApp(
      detailRequest(TEST_HUNT_ID, '10.0.3.13', {
        ...authHeaders(),
        'X-Host-Secret': 'not-the-secret',
      }),
      env,
    );

    // A failed secret must fall through to the ownership check, not past it.
    expect(response.status).toBe(403);
  });

  it('does not accept another hunt\'s host secret', async () => {
    const kv = createMockKV();
    await seedHuntHistory(kv, { huntId: TEST_HUNT_ID });
    // Same seeded secret value, but the check must be against *this* entry —
    // a hunt whose own secret differs stays closed.
    await kv.put(
      `hunt-history:WXYZ-5678`,
      JSON.stringify({ huntId: 'WXYZ-5678', hostSecret: 'a-different-secret', photoKeys: {} }),
    );
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    const response = await fetchApp(
      detailRequest('WXYZ-5678', '10.0.3.14', { 'X-Host-Secret': SEEDED_HOST_SECRET }),
      env,
    );

    expect(response.status).toBe(401);
  });

  it('ignores an empty host secret rather than matching on it', async () => {
    const kv = createMockKV();
    await seedHuntHistory(kv, { huntId: TEST_HUNT_ID });
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    const response = await fetchApp(
      detailRequest(TEST_HUNT_ID, '10.0.3.15', { 'X-Host-Secret': '' }),
      env,
    );

    expect(response.status).toBe(401);
  });

  it('reads the secret from X-Host-Secret and nothing else', async () => {
    const kv = createMockKV();
    await seedHuntHistory(kv, { huntId: TEST_HUNT_ID });
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    // A near-miss header name must not unlock the hunt — this is what pins the
    // route to the name the client actually sends.
    for (const [i, name] of ['X-Host-Secrets', 'Host-Secret', 'X-Hunt-Secret'].entries()) {
      const response = await fetchApp(
        detailRequest(TEST_HUNT_ID, `10.0.3.3${i}`, { [name]: SEEDED_HOST_SECRET }),
        env,
      );
      expect(response.status).toBe(401);
    }

    // ...and the real name still does.
    const ok = await fetchApp(
      detailRequest(TEST_HUNT_ID, '10.0.3.39', { 'X-Host-Secret': SEEDED_HOST_SECRET }),
      env,
    );
    expect(ok.status).toBe(200);
  });

  it('falls through to session-based access when no secret is offered', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    await seedHuntHistory(kv, { huntId: TEST_HUNT_ID, hostEmail: TEST_EMAIL });
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    // The header path is skipped entirely, and the account path answers.
    const signedIn = await fetchApp(
      detailRequest(TEST_HUNT_ID, '10.0.3.16', authHeaders()),
      env,
    );
    expect(signedIn.status).toBe(200);
    expect(((await signedIn.json()) as any).hunt.hostSecret).toBeUndefined();

    const signedOut = await fetchApp(detailRequest(TEST_HUNT_ID, '10.0.3.17'), env);
    expect(signedOut.status).toBe(401);
  });

  it('still 404s an unknown hunt, whatever secret is offered', async () => {
    const kv = createMockKV();
    await seedHuntHistory(kv, { huntId: TEST_HUNT_ID });
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    const response = await fetchApp(
      detailRequest('QRST-0001', '10.0.3.18', { 'X-Host-Secret': SEEDED_HOST_SECRET }),
      env,
    );

    expect(response.status).toBe(404);
  });
});

describe('WebSocket proxy — caller identity', () => {
  /** Durable Object namespace that records the requests it is handed */
  function createSpyNamespace() {
    const seen: Request[] = [];
    const namespace = {
      idFromName: () => ({ toString: () => 'do-id' }),
      get: () => ({
        fetch: async (req: Request) => {
          seen.push(req);
          return new Response('upgraded');
        },
      }),
    } as unknown as DurableObjectNamespace;
    return { namespace, seen };
  }

  function wsRequest(path: string, headers: Record<string, string> = {}): Request {
    return new Request(`http://localhost${path}`, {
      headers: {
        Upgrade: 'websocket',
        Origin: 'http://localhost:5173',
        ...headers,
      },
    });
  }

  it('strips a client-forged X-User-Email when there is no session token', async () => {
    const kv = createMockKV();
    const { namespace, seen } = createSpyNamespace();
    const env = createHuntMockEnv({ TRIVIA_KV: kv, SCAVENGER_HUNT_ROOM: namespace });

    // A scripted client claiming to be the host of somebody else's hunt
    await worker.fetch(
      wsRequest(`/ws/hunt/${TEST_HUNT_ID}`, { 'X-User-Email': 'host@example.com' }),
      env,
    );

    expect(seen).toHaveLength(1);
    expect(seen[0].headers.get('X-User-Email')).toBeNull();
  });

  it('sets X-User-Email from a valid session token, ignoring the forged one', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    const { namespace, seen } = createSpyNamespace();
    const env = createHuntMockEnv({ TRIVIA_KV: kv, SCAVENGER_HUNT_ROOM: namespace });

    await worker.fetch(
      wsRequest(`/ws/hunt/${TEST_HUNT_ID}?token=${TEST_TOKEN}`, {
        'X-User-Email': 'host@example.com',
      }),
      env,
    );

    expect(seen[0].headers.get('X-User-Email')).toBe(TEST_EMAIL);
  });

  it('ignores an expired session token rather than trusting the header', async () => {
    const kv = createMockKV();
    await kv.put(
      `session:${TEST_TOKEN}`,
      JSON.stringify({ userId: TEST_USER_ID, email: TEST_EMAIL, expiresAt: Date.now() - 1000 }),
    );
    const { namespace, seen } = createSpyNamespace();
    const env = createHuntMockEnv({ TRIVIA_KV: kv, SCAVENGER_HUNT_ROOM: namespace });

    await worker.fetch(
      wsRequest(`/ws/hunt/${TEST_HUNT_ID}?token=${TEST_TOKEN}`, {
        'X-User-Email': 'host@example.com',
      }),
      env,
    );

    expect(seen[0].headers.get('X-User-Email')).toBeNull();
  });

  it('strips a client-forged X-User-Email on the group socket too', async () => {
    const kv = createMockKV();
    const { namespace, seen } = createSpyNamespace();
    const env = createHuntMockEnv({ TRIVIA_KV: kv, PRIVATE_GROUP: namespace });

    await worker.fetch(
      wsRequest('/ws/group/brave-mountain-golden-river', { 'X-User-Email': 'owner@example.com' }),
      env,
    );

    expect(seen[0].headers.get('X-User-Email')).toBeNull();
  });

  it('sets X-User-Email on the group socket from a valid session token', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    const { namespace, seen } = createSpyNamespace();
    const env = createHuntMockEnv({ TRIVIA_KV: kv, PRIVATE_GROUP: namespace });

    await worker.fetch(
      wsRequest(`/ws/group/brave-mountain-golden-river?token=${TEST_TOKEN}`, {
        'X-User-Email': 'owner@example.com',
      }),
      env,
    );

    // The group DO gates account-linked member recovery on this header, so it
    // must arrive from the session and never from the client's own header.
    expect(seen[0].headers.get('X-User-Email')).toBe(TEST_EMAIL);
  });

  it('strips a client-forged X-Caller-Email on a socket upgrade', async () => {
    const kv = createMockKV();
    const { namespace, seen } = createSpyNamespace();
    const env = createHuntMockEnv({ TRIVIA_KV: kv, PRIVATE_GROUP: namespace });

    await worker.fetch(
      wsRequest('/ws/group/brave-mountain-golden-river', {
        'X-Caller-Email': 'owner@example.com',
      }),
      env,
    );

    // The group DO trusts X-Caller-Email on its internal HTTP paths; a client
    // must not be able to smuggle one in through any route.
    expect(seen[0].headers.get('X-Caller-Email')).toBeNull();
  });

  it('strips a client-forged X-User-Email on the game socket too', async () => {
    const kv = createMockKV();
    const { namespace, seen } = createSpyNamespace();
    const env = createHuntMockEnv({ TRIVIA_KV: kv, GAME_ROOM: namespace });

    await worker.fetch(
      wsRequest('/ws/game/ABCD-1234', { 'X-User-Email': 'owner@example.com' }),
      env,
    );

    expect(seen[0].headers.get('X-User-Email')).toBeNull();
  });

  it('strips client-forged identity headers before the HTTP API sees them', async () => {
    // This used to assert only `status === 200`, which the route returns
    // whether or not the headers were stripped — it passed against a Worker
    // with the stripping deleted outright. The observable property is what
    // reaches the Hono app, so assert that.
    const kv = createMockKV();
    await seedAuth(kv);
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    const seen: Request[] = [];
    const spy = vi.spyOn(app, 'fetch').mockImplementation((async (req: Request) => {
      seen.push(req);
      return Response.json({ hunts: [] });
    }) as never);

    try {
      await worker.fetch(
        new Request('http://localhost/api/hunts/history', {
          headers: {
            ...authHeaders({ 'CF-Connecting-IP': '10.0.4.1' }),
            'X-User-Email': 'someone@example.com',
            'X-Caller-Email': 'someone@example.com',
          },
        }),
        env,
      );
    } finally {
      spy.mockRestore();
    }

    expect(seen).toHaveLength(1);
    // The DOs treat both of these as proof of identity on their internal HTTP
    // paths, so neither may survive from a client's own request.
    expect(seen[0].headers.get('X-User-Email')).toBeNull();
    expect(seen[0].headers.get('X-Caller-Email')).toBeNull();
    // ...while the header that legitimately authenticates the caller survives
    expect(seen[0].headers.get('Authorization')).toBe(`Bearer ${TEST_TOKEN}`);
  });

  it('resolves HTTP API identity from the session, never the forged header', async () => {
    // Deliberate control: this passes against a Worker with header-stripping
    // removed, because the history route resolves identity from the session
    // token and never consults the header. It is here to pin that down — if
    // some future route starts trusting X-User-Email, this is what notices.
    const kv = createMockKV();
    await seedAuth(kv);
    await seedHuntHistory(kv, { huntId: TEST_HUNT_ID, hostEmail: TEST_EMAIL, name: 'Mine' });
    await seedHuntHistory(kv, {
      huntId: 'WXYZ-5678',
      hostEmail: 'someone@example.com',
      name: 'The forged identity\'s',
    });
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    const response = await worker.fetch(
      new Request('http://localhost/api/hunts/history', {
        headers: {
          ...authHeaders({ 'CF-Connecting-IP': '10.0.4.2' }),
          'X-User-Email': 'someone@example.com',
        },
      }),
      env,
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.hunts.map((h: any) => h.huntId)).toEqual([TEST_HUNT_ID]);
  });
});

describe('POST /api/groups/:groupId/games — Group game authorization', () => {
  function gameConfig() {
    return { name: 'Group Game', categoryIds: ['general'], questionCount: 10 };
  }

  function createRequest(ip: string, headers: Record<string, string> = {}) {
    return new Request('http://localhost/api/groups/test-group-id/games', {
      method: 'POST',
      body: JSON.stringify(gameConfig()),
      headers: { 'CF-Connecting-IP': ip, ...headers },
    });
  }

  it('rejects an unauthenticated caller', async () => {
    const env = createHuntMockEnv();

    const response = await fetchApp(createRequest('10.0.5.1'), env);

    expect(response.status).toBe(401);
  });

  it('rejects a signed-in caller who does not belong to the group', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    const env = createHuntMockEnv({ TRIVIA_KV: kv }, 'someone-else@example.com');

    const response = await fetchApp(createRequest('10.0.5.2', authHeaders()), env);

    expect(response.status).toBe(403);
  });

  it('lets the group owner create a game', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    const response = await fetchApp(createRequest('10.0.5.3', authHeaders()), env);

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.gameId).toBe(TEST_HUNT_ID);
  });
});

describe('GET /api/groups/:groupId — Owner email exposure', () => {
  it('does not return ownerEmail to an unauthenticated caller', async () => {
    const env = createHuntMockEnv();

    const response = await fetchApp(
      new Request('http://localhost/api/groups/test-group-id'),
      env,
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.name).toBe('Test Group');
    expect(data.ownerEmail).toBeUndefined();
  });

  it('does not return ownerEmail to a signed-in non-owner', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    const env = createHuntMockEnv({ TRIVIA_KV: kv }, 'someone-else@example.com');

    const response = await fetchApp(
      new Request('http://localhost/api/groups/test-group-id', { headers: authHeaders() }),
      env,
    );

    const data = (await response.json()) as any;
    expect(data.ownerEmail).toBeUndefined();
  });

  it('returns ownerEmail to the owner so their client can unlock owner controls', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    const response = await fetchApp(
      new Request('http://localhost/api/groups/test-group-id', { headers: authHeaders() }),
      env,
    );

    const data = (await response.json()) as any;
    expect(data.ownerEmail).toBe(TEST_EMAIL);
  });
});

/**
 * A KV whose `list()` hands back one page at a time, the way the real one caps
 * out at 1000 keys. `cursor` is just the offset of the next page.
 */
function paginatedKV(pageSize: number): KVNamespace {
  const kv = createMockKV();
  const listAll = kv.list.bind(kv);
  (kv as unknown as { list: unknown }).list = async (opts?: any) => {
    const all = await listAll({ prefix: opts?.prefix });
    const start = opts?.cursor ? Number(opts.cursor) : 0;
    const keys = all.keys.slice(start, start + pageSize);
    const next = start + pageSize;
    return next >= all.keys.length
      ? { keys, list_complete: true, cacheStatus: null }
      : { keys, list_complete: false, cursor: String(next), cacheStatus: null };
  };
  return kv;
}

/** The hostSecret seedHuntHistory stamps on every entry it writes. */
const SEEDED_HOST_SECRET = 'super-secret';

function historyClaim(
  hostSecrets: Record<string, string>,
  ip: string,
  headers: Record<string, string> = {},
) {
  return new Request('http://localhost/api/hunts/history', {
    method: 'POST',
    body: JSON.stringify({ hostSecrets }),
    headers: { 'CF-Connecting-IP': ip, ...headers },
  });
}

describe('POST /api/hunts/history — Listing hunts proved by host secret', () => {
  it('lists a hunt whose secret the caller holds even when no account indexes it', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    // No hostEmail: exactly the shape of a hunt created before the host index
    // existed, so host-hunts:{email} knows nothing about it.
    await seedHuntHistory(kv, { huntId: 'WXYZ-5678', name: 'Before the deploy' });
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    const listed = await fetchApp(
      new Request('http://localhost/api/hunts/history', {
        headers: authHeaders({ 'CF-Connecting-IP': '10.0.7.1' }),
      }),
      env,
    );
    expect(((await listed.json()) as any).hunts).toEqual([]);

    const claimed = await fetchApp(
      historyClaim({ 'WXYZ-5678': SEEDED_HOST_SECRET }, '10.0.7.2', authHeaders()),
      env,
    );

    expect(claimed.status).toBe(200);
    const data = (await claimed.json()) as any;
    expect(data.hunts.map((h: any) => h.huntId)).toEqual(['WXYZ-5678']);
  });

  it('answers a wrong secret exactly as it answers a hunt that does not exist', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    await seedHuntHistory(kv, { huntId: 'WXYZ-5678', name: 'Somebody else\'s' });
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    const wrongSecret = await fetchApp(
      historyClaim({ 'WXYZ-5678': 'not-the-secret' }, '10.0.7.3', authHeaders()),
      env,
    );
    const noSuchHunt = await fetchApp(
      historyClaim({ 'QRST-0001': 'not-the-secret' }, '10.0.7.4', authHeaders()),
      env,
    );

    // Same status, same body: offering an id you hold no secret for tells you
    // nothing about whether it is a hunt at all.
    expect(wrongSecret.status).toBe(noSuchHunt.status);
    expect(wrongSecret.status).toBe(200);
    const wrongBody = (await wrongSecret.json()) as any;
    expect(wrongBody).toEqual(await noSuchHunt.json());
    expect(wrongBody).toEqual({ hunts: [] });
  });

  it('merges account-indexed hunts with secret-proven ones, without duplicates', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    await seedHuntHistory(kv, { huntId: 'ABCD-1234', hostEmail: TEST_EMAIL, name: 'Indexed' });
    await seedHuntHistory(kv, { huntId: 'WXYZ-5678', name: 'Older' });
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    const response = await fetchApp(
      historyClaim(
        { 'ABCD-1234': SEEDED_HOST_SECRET, 'WXYZ-5678': SEEDED_HOST_SECRET },
        '10.0.7.6',
        authHeaders(),
      ),
      env,
    );

    const data = (await response.json()) as any;
    expect(data.hunts.map((h: any) => h.huntId).sort()).toEqual(['ABCD-1234', 'WXYZ-5678']);
  });

  it('lets a signed-out host claim hunts, but refuses a caller offering nothing', async () => {
    const kv = createMockKV();
    await seedHuntHistory(kv, { huntId: 'WXYZ-5678', name: 'Older' });
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    const withSecret = await fetchApp(
      historyClaim({ 'WXYZ-5678': SEEDED_HOST_SECRET }, '10.0.7.7'),
      env,
    );
    expect(withSecret.status).toBe(200);
    expect(((await withSecret.json()) as any).hunts).toHaveLength(1);

    const withNothing = await fetchApp(historyClaim({}, '10.0.7.8'), env);
    expect(withNothing.status).toBe(401);
  });

  it('ignores ids that are not hunt-shaped rather than failing the whole request', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    await seedHuntHistory(kv, { huntId: 'WXYZ-5678', name: 'Older' });
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    const response = await fetchApp(
      historyClaim(
        { 'not-a-hunt-id': 'junk', 'WXYZ-5678': SEEDED_HOST_SECRET },
        '10.0.7.9',
        authHeaders(),
      ),
      env,
    );

    expect(response.status).toBe(200);
    expect(((await response.json()) as any).hunts.map((h: any) => h.huntId)).toEqual(['WXYZ-5678']);
  });
});

describe('Hunt history listings — KV pagination', () => {
  it('finds the caller\'s hunt on a later page of the hunt-history prefix', async () => {
    const kv = paginatedKV(1);
    await seedAuth(kv);
    // Strangers' hunts fill page one; the caller's is only reachable by
    // following the cursor.
    await seedHuntHistory(kv, { huntId: 'QRST-0001', hostEmail: 'stranger@example.com' });
    await seedHuntHistory(kv, { huntId: 'QRST-0002', hostEmail: 'stranger@example.com' });
    await seedHuntHistory(kv, { huntId: 'WXYZ-5678', hostEmail: TEST_EMAIL, name: 'Mine' });
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    const response = await fetchApp(
      new Request('http://localhost/api/hunts/history', {
        headers: authHeaders({ 'CF-Connecting-IP': '10.0.8.1' }),
      }),
      env,
    );

    const data = (await response.json()) as any;
    expect(data.hunts.map((h: any) => h.huntId)).toEqual(['WXYZ-5678']);
  });

  it('finds a group\'s hunt on a later page too', async () => {
    const kv = paginatedKV(1);
    await seedAuth(kv);
    await seedHuntHistory(kv, { huntId: 'QRST-0001', hostEmail: 'stranger@example.com' });
    await seedHuntHistory(kv, { huntId: 'QRST-0002', hostEmail: 'stranger@example.com' });
    await seedHuntHistory(kv, {
      huntId: 'WXYZ-5678',
      hostEmail: TEST_EMAIL,
      groupId: 'test-group-id',
    });
    const env = createHuntMockEnv({ TRIVIA_KV: kv });

    const response = await fetchApp(
      new Request('http://localhost/api/groups/test-group-id/hunts/history', {
        headers: authHeaders({ 'CF-Connecting-IP': '10.0.8.2' }),
      }),
      env,
    );

    const data = (await response.json()) as any;
    expect(data.hunts.map((h: any) => h.huntId)).toEqual(['WXYZ-5678']);
  });
});

describe('GET /api/groups/:groupId/hunts/history — Group history authorization', () => {
  async function groupHistoryEnv(
    ownerEmail = TEST_EMAIL,
    memberEmails: string[] = [],
  ): Promise<Env> {
    const kv = createMockKV();
    await seedAuth(kv);
    await seedHuntHistory(kv, {
      huntId: 'WXYZ-5678',
      hostEmail: 'member@example.com',
      groupId: 'test-group-id',
    });
    await seedHuntHistory(kv, { huntId: 'QRST-0001', hostEmail: 'stranger@example.com' });
    return createHuntMockEnv({ TRIVIA_KV: kv }, ownerEmail, memberEmails);
  }

  function historyRequest(ip: string, headers: Record<string, string> = {}) {
    return new Request('http://localhost/api/groups/test-group-id/hunts/history', {
      headers: { 'CF-Connecting-IP': ip, ...headers },
    });
  }

  it('rejects an unauthenticated caller who merely knows the group ID', async () => {
    const env = await groupHistoryEnv();

    const response = await fetchApp(historyRequest('10.0.9.1'), env);

    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain('WXYZ-5678');
  });

  it('refuses a signed-in caller who does not belong to the group', async () => {
    const env = await groupHistoryEnv('someone-else@example.com');

    const response = await fetchApp(historyRequest('10.0.9.2', authHeaders()), env);

    expect(response.status).toBe(403);
    expect(((await response.json()) as any).code).toBe('NOT_A_MEMBER');
  });

  it('returns 404 for a group that does not exist', async () => {
    const kv = createMockKV();
    await seedAuth(kv);
    const env = createHuntMockEnv({
      TRIVIA_KV: kv,
      PRIVATE_GROUP: {
        idFromName: () => ({ toString: () => 'group-id' }),
        get: () => ({ fetch: async () => new Response('Not found', { status: 404 }) }),
      } as unknown as DurableObjectNamespace,
    });

    const response = await fetchApp(historyRequest('10.0.9.3', authHeaders()), env);

    expect(response.status).toBe(404);
  });

  it('gives the group owner the hunts played in the group, and nothing else', async () => {
    const env = await groupHistoryEnv();

    const response = await fetchApp(historyRequest('10.0.9.4', authHeaders()), env);

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.hunts.map((h: any) => h.huntId)).toEqual(['WXYZ-5678']);
  });

  it('gives a linked member of the group the same list', async () => {
    const env = await groupHistoryEnv('someone-else@example.com', [TEST_EMAIL]);

    const response = await fetchApp(historyRequest('10.0.9.5', authHeaders()), env);

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.hunts.map((h: any) => h.huntId)).toEqual(['WXYZ-5678']);
  });
});
