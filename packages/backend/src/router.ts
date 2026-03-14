import { Env } from './env';
import {
  GameConfigSchema, HuntConfigSchema, UsernameSchema, GroupNameSchema,
  TRIVIA_CATEGORIES, generateGroupId, HUNT_LIMITS,
} from '@lamo-trivia/shared';
import type { GroupGame, HuntConfig, HuntHistoryEntry, HuntHistorySummary } from '@lamo-trivia/shared';
import { seedQuestions, getCategoryCounts, getAIQuestionBankTopics } from './questions';

// --- In-memory rate limiter (per Worker isolate) ---

class RateLimiter {
  private windows = new Map<string, { count: number; start: number }>();

  constructor(
    private maxRequests: number,
    private windowMs: number = 60_000,
  ) {}

  check(key: string): boolean {
    const now = Date.now();
    const entry = this.windows.get(key);

    if (!entry || now - entry.start > this.windowMs) {
      this.windows.set(key, { count: 1, start: now });
      return true;
    }

    entry.count++;
    if (entry.count > this.maxRequests) return false;
    return true;
  }
}

const gameCreateLimiter = new RateLimiter(10);       // 10/min per IP
const groupCreateLimiter = new RateLimiter(5);       // 5/min per IP
const usernameCheckLimiter = new RateLimiter(20);    // 20/min per IP
const groupGameLimiter = new RateLimiter(10);        // 10/min per IP
const photoUploadLimiter = new RateLimiter(20);      // 20/min per IP
const huntHistoryLimiter = new RateLimiter(30);      // 30/min per IP

function getClientIP(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

function rateLimitedResponse(): Response {
  return Response.json(
    { error: 'Too many requests. Please try again later.' },
    { status: 429 },
  );
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;

  try {
    // GET /api/games — list public games
    if (method === 'GET' && url.pathname === '/api/games') {
      const lobbyId = env.GAME_LOBBY.idFromName('global');
      const lobby = env.GAME_LOBBY.get(lobbyId);
      return lobby.fetch(new Request('http://internal/games'));
    }

    // POST /api/games — create a new game
    if (method === 'POST' && url.pathname === '/api/games') {
      if (!gameCreateLimiter.check(getClientIP(request))) return rateLimitedResponse();
      const body = await request.json();
      const parsed = GameConfigSchema.safeParse(body);
      if (!parsed.success) {
        return Response.json({ error: parsed.error.flatten() }, { status: 400 });
      }
      const lobbyId = env.GAME_LOBBY.idFromName('global');
      const lobby = env.GAME_LOBBY.get(lobbyId);
      const lobbyRes = await lobby.fetch(
        new Request('http://internal/games', {
          method: 'POST',
          body: JSON.stringify({ ...parsed.data, gameMode: 'trivia' }),
        }),
      );
      const lobbyData = (await lobbyRes.json()) as { gameId: string };

      // Forward config to the GameRoom DO so it's ready when players connect
      const roomId = env.GAME_ROOM.idFromName(lobbyData.gameId);
      const room = env.GAME_ROOM.get(roomId);
      await room.fetch(
        new Request('http://internal/config', {
          method: 'POST',
          body: JSON.stringify({ ...parsed.data, gameId: lobbyData.gameId }),
        }),
      );

      return Response.json(lobbyData);
    }

    // POST /api/username/check — check availability
    if (method === 'POST' && url.pathname === '/api/username/check') {
      if (!usernameCheckLimiter.check(getClientIP(request))) return rateLimitedResponse();
      const { username } = (await request.json()) as { username: string };
      const parsed = UsernameSchema.safeParse(username);
      if (!parsed.success) {
        return Response.json({ available: false, error: parsed.error.flatten() }, { status: 400 });
      }
      const existing = await env.TRIVIA_KV.get(`username:${parsed.data.toLowerCase()}`);
      return Response.json({ available: !existing });
    }

    // GET /api/categories — list trivia categories with live question counts
    if (method === 'GET' && url.pathname === '/api/categories') {
      const counts = await getCategoryCounts(env.TRIVIA_KV);
      const categories = TRIVIA_CATEGORIES.map((cat) => ({
        ...cat,
        questionCount: counts[cat.id] ?? 0,
      }));
      return Response.json({ categories });
    }

    // POST /api/seed — populate KV with questions (expects { categoryId: Question[] } body)
    // Protected: requires Authorization: Bearer <SEED_SECRET>
    if (method === 'POST' && url.pathname === '/api/seed') {
      const authHeader = request.headers.get('Authorization');
      const expectedSecret = env.SEED_SECRET;
      if (!expectedSecret || !authHeader || authHeader !== `Bearer ${expectedSecret}`) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const categories = (await request.json()) as Record<string, unknown[]>;
      const counts = await seedQuestions(env.TRIVIA_KV, categories as Record<string, import('@lamo-trivia/shared').Question[]>);
      return Response.json({ seeded: true, counts });
    }

    // POST /api/groups — create a new private group
    if (method === 'POST' && url.pathname === '/api/groups') {
      if (!groupCreateLimiter.check(getClientIP(request))) return rateLimitedResponse();
      const body = (await request.json()) as { name: string };
      const parsed = GroupNameSchema.safeParse(body.name);
      if (!parsed.success) {
        return Response.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      const groupId = generateGroupId();
      const doId = env.PRIVATE_GROUP.idFromName(groupId);
      const group = env.PRIVATE_GROUP.get(doId);
      const res = await group.fetch(
        new Request('http://internal/init', {
          method: 'POST',
          body: JSON.stringify({ id: groupId, name: parsed.data }),
        }),
      );

      if (!res.ok) {
        // Extremely unlikely collision — retry once with new ID
        const retryId = generateGroupId();
        const retryDoId = env.PRIVATE_GROUP.idFromName(retryId);
        const retryGroup = env.PRIVATE_GROUP.get(retryDoId);
        await retryGroup.fetch(
          new Request('http://internal/init', {
            method: 'POST',
            body: JSON.stringify({ id: retryId, name: parsed.data }),
          }),
        );
        return Response.json({ groupId: retryId, name: parsed.data });
      }

      return Response.json({ groupId, name: parsed.data });
    }

    // GET /api/groups/:groupId — validate group exists
    if (method === 'GET' && url.pathname.startsWith('/api/groups/') && !url.pathname.includes('/games')) {
      const groupId = url.pathname.split('/api/groups/')[1];
      if (!groupId) return Response.json({ error: 'Missing group ID' }, { status: 400 });

      const doId = env.PRIVATE_GROUP.idFromName(groupId);
      const group = env.PRIVATE_GROUP.get(doId);
      const res = await group.fetch(new Request('http://internal/state'));
      if (!res.ok) return Response.json({ error: 'Group not found' }, { status: 404 });

      return Response.json(await res.json());
    }

    // POST /api/groups/:groupId/games — create a game within a group
    if (method === 'POST' && url.pathname.match(/^\/api\/groups\/[^/]+\/games$/)) {
      if (!groupGameLimiter.check(getClientIP(request))) return rateLimitedResponse();
      const groupId = url.pathname.split('/api/groups/')[1].split('/games')[0];

      // Validate group exists
      const doId = env.PRIVATE_GROUP.idFromName(groupId);
      const group = env.PRIVATE_GROUP.get(doId);
      const checkRes = await group.fetch(new Request('http://internal/state'));
      if (!checkRes.ok) return Response.json({ error: 'Group not found' }, { status: 404 });

      // Parse game config — force isPrivate=true and set groupId
      const body = await request.json();
      const parsed = GameConfigSchema.safeParse({ ...(body as object), isPrivate: true, groupId });
      if (!parsed.success) {
        return Response.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      // Create game in lobby (existing flow)
      const lobbyId = env.GAME_LOBBY.idFromName('global');
      const lobby = env.GAME_LOBBY.get(lobbyId);
      const lobbyRes = await lobby.fetch(
        new Request('http://internal/games', {
          method: 'POST',
          body: JSON.stringify(parsed.data),
        }),
      );
      const lobbyData = (await lobbyRes.json()) as { gameId: string };

      // Configure the GameRoom (existing flow)
      const roomId = env.GAME_ROOM.idFromName(lobbyData.gameId);
      const room = env.GAME_ROOM.get(roomId);
      await room.fetch(
        new Request('http://internal/config', {
          method: 'POST',
          body: JSON.stringify({ ...parsed.data, gameId: lobbyData.gameId }),
        }),
      );

      // Register game in the PrivateGroup DO
      const groupGame: GroupGame = {
        gameId: lobbyData.gameId,
        name: parsed.data.name,
        hostUsername: '',
        playerCount: 0,
        maxPlayers: parsed.data.maxPlayers,
        phase: 'waiting',
        createdAt: Date.now(),
        categoryIds: parsed.data.categoryIds,
        aiTopic: parsed.data.aiTopic,
        gameMode: 'trivia',
      };
      const groupRes = await group.fetch(
        new Request('http://internal/games', {
          method: 'POST',
          body: JSON.stringify(groupGame),
        }),
      );

      // Propagate limit errors from group
      if (!groupRes.ok) {
        const errorData = (await groupRes.json()) as { error: string };
        return Response.json({ error: errorData.error }, { status: groupRes.status });
      }

      return Response.json({ gameId: lobbyData.gameId });
    }

    // GET /api/ai-question-bank — list banked AI topics and counts
    if (method === 'GET' && url.pathname === '/api/ai-question-bank') {
      const topics = await getAIQuestionBankTopics(env.TRIVIA_KV);
      return Response.json({ topics });
    }

    // --- Scavenger Hunt Endpoints ---

    // POST /api/hunts — create a scavenger hunt
    if (method === 'POST' && url.pathname === '/api/hunts') {
      if (!gameCreateLimiter.check(getClientIP(request))) return rateLimitedResponse();
      const body = await request.json();
      const parsed = HuntConfigSchema.safeParse(body);
      if (!parsed.success) {
        return Response.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      // Create lobby listing
      const lobbyId = env.GAME_LOBBY.idFromName('global');
      const lobby = env.GAME_LOBBY.get(lobbyId);
      const lobbyRes = await lobby.fetch(
        new Request('http://internal/games', {
          method: 'POST',
          body: JSON.stringify({
            ...parsed.data,
            gameMode: 'scavenger-hunt',
          }),
        }),
      );
      const lobbyData = (await lobbyRes.json()) as { gameId: string };
      const huntId = lobbyData.gameId;

      // Configure the ScavengerHuntRoom DO
      const roomId = env.SCAVENGER_HUNT_ROOM.idFromName(huntId);
      const room = env.SCAVENGER_HUNT_ROOM.get(roomId);
      await room.fetch(
        new Request('http://internal/config', {
          method: 'POST',
          body: JSON.stringify({ ...parsed.data, huntId }),
        }),
      );

      return Response.json({ huntId });
    }

    // POST /api/hunts/:huntId/photos — upload a photo for verification
    if (method === 'POST' && url.pathname.match(/^\/api\/hunts\/[^/]+\/photos$/)) {
      if (!photoUploadLimiter.check(getClientIP(request))) return rateLimitedResponse();
      const huntId = url.pathname.split('/api/hunts/')[1].split('/photos')[0];

      // Parse multipart form data
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      const itemId = formData.get('itemId') as string | null;

      if (!file || !itemId) {
        return Response.json({ error: 'Missing file or itemId' }, { status: 400 });
      }

      // Validate file size
      if (file.size > HUNT_LIMITS.maxPhotoSizeBytes) {
        return Response.json({ error: 'Photo too large (max 5MB)' }, { status: 400 });
      }

      // Validate content type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        return Response.json({ error: 'Invalid file type. Use JPEG, PNG, or WebP.' }, { status: 400 });
      }

      const uploadId = crypto.randomUUID();
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      const key = `${huntId}/${uploadId}.${ext}`;

      // Store in R2
      await env.R2_HUNT_PHOTOS.put(key, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type },
      });

      return Response.json({ uploadId: `${uploadId}.${ext}` });
    }

    // POST /api/groups/:groupId/hunts — create a hunt within a group
    if (method === 'POST' && url.pathname.match(/^\/api\/groups\/[^/]+\/hunts$/)) {
      if (!groupGameLimiter.check(getClientIP(request))) return rateLimitedResponse();
      const groupId = url.pathname.split('/api/groups/')[1].split('/hunts')[0];

      // Validate group exists
      const doId = env.PRIVATE_GROUP.idFromName(groupId);
      const group = env.PRIVATE_GROUP.get(doId);
      const checkRes = await group.fetch(new Request('http://internal/state'));
      if (!checkRes.ok) return Response.json({ error: 'Group not found' }, { status: 404 });

      const body = await request.json();
      const parsed = HuntConfigSchema.safeParse({ ...(body as object), isPrivate: true, groupId });
      if (!parsed.success) {
        return Response.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      // Create lobby listing
      const lobbyId = env.GAME_LOBBY.idFromName('global');
      const lobby = env.GAME_LOBBY.get(lobbyId);
      const lobbyRes = await lobby.fetch(
        new Request('http://internal/games', {
          method: 'POST',
          body: JSON.stringify({
            ...parsed.data,
            gameMode: 'scavenger-hunt',
          }),
        }),
      );
      const lobbyData = (await lobbyRes.json()) as { gameId: string };
      const huntId = lobbyData.gameId;

      // Configure the ScavengerHuntRoom DO
      const roomId = env.SCAVENGER_HUNT_ROOM.idFromName(huntId);
      const room = env.SCAVENGER_HUNT_ROOM.get(roomId);
      await room.fetch(
        new Request('http://internal/config', {
          method: 'POST',
          body: JSON.stringify({ ...parsed.data, huntId }),
        }),
      );

      // Register in group
      const groupGame: GroupGame = {
        gameId: huntId,
        name: parsed.data.name,
        hostUsername: '',
        playerCount: 0,
        maxPlayers: parsed.data.maxPlayers,
        phase: 'waiting',
        createdAt: Date.now(),
        categoryIds: [],
        gameMode: 'scavenger-hunt',
      };
      const groupRes = await group.fetch(
        new Request('http://internal/games', {
          method: 'POST',
          body: JSON.stringify(groupGame),
        }),
      );

      if (!groupRes.ok) {
        const errorData = (await groupRes.json()) as { error: string };
        return Response.json({ error: errorData.error }, { status: groupRes.status });
      }

      return Response.json({ huntId });
    }

    // GET /api/hunts/history — list historical hunts
    if (method === 'GET' && url.pathname === '/api/hunts/history') {
      if (!huntHistoryLimiter.check(getClientIP(request))) return rateLimitedResponse();

      const listResult = await env.TRIVIA_KV.list<HuntHistorySummary>({
        prefix: 'hunt-history:',
      });

      const summaries: HuntHistorySummary[] = listResult.keys
        .filter((k) => k.metadata)
        .map((k) => k.metadata!);

      summaries.sort((a, b) => b.finishedAt - a.finishedAt);

      return Response.json({ hunts: summaries });
    }

    // GET /api/hunts/:huntId/photos/:fileName — serve R2 photo
    if (method === 'GET' && url.pathname.match(/^\/api\/hunts\/[^/]+\/photos\/.+$/)) {
      if (!huntHistoryLimiter.check(getClientIP(request))) return rateLimitedResponse();

      const parts = url.pathname.replace('/api/hunts/', '').split('/photos/');
      const huntId = parts[0];
      const photoFileName = parts[1];

      if (!huntId || !photoFileName) {
        return Response.json({ error: 'Invalid photo path' }, { status: 400 });
      }

      const r2Key = `${huntId}/${photoFileName}`;
      const object = await env.R2_HUNT_PHOTOS.get(r2Key);

      if (!object) {
        return new Response('Photo not found', { status: 404 });
      }

      const headers = new Headers();
      headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
      headers.set('Cache-Control', 'public, max-age=86400');
      headers.set('Content-Length', String(object.size));

      return new Response(object.body, { status: 200, headers });
    }

    // GET /api/hunts/:huntId/history — get historical hunt details
    if (method === 'GET' && url.pathname.match(/^\/api\/hunts\/[^/]+\/history$/)) {
      if (!huntHistoryLimiter.check(getClientIP(request))) return rateLimitedResponse();
      const huntId = url.pathname.split('/api/hunts/')[1].split('/history')[0];

      const raw = await env.TRIVIA_KV.get(`hunt-history:${huntId}`);
      if (!raw) {
        return Response.json({ error: 'Hunt not found' }, { status: 404 });
      }

      const entry = JSON.parse(raw) as HuntHistoryEntry;
      const { hostSecret: _, ...safeEntry } = entry;

      return Response.json({ hunt: safeEntry });
    }

    // DELETE /api/hunts/:huntId/history — delete historical hunt (host-only)
    if (method === 'DELETE' && url.pathname.match(/^\/api\/hunts\/[^/]+\/history$/)) {
      if (!huntHistoryLimiter.check(getClientIP(request))) return rateLimitedResponse();
      const huntId = url.pathname.split('/api/hunts/')[1].split('/history')[0];

      const providedSecret = request.headers.get('X-Host-Secret');
      if (!providedSecret) {
        return Response.json({ error: 'Missing host secret' }, { status: 401 });
      }

      const raw = await env.TRIVIA_KV.get(`hunt-history:${huntId}`);
      if (!raw) {
        return Response.json({ error: 'Hunt not found' }, { status: 404 });
      }

      const entry = JSON.parse(raw) as HuntHistoryEntry;
      if (entry.hostSecret !== providedSecret) {
        return Response.json({ error: 'Unauthorized' }, { status: 403 });
      }

      // Delete R2 photos for this hunt
      let cursor: string | undefined;
      do {
        const r2List = await env.R2_HUNT_PHOTOS.list({
          prefix: `${huntId}/`,
          ...(cursor ? { cursor } : {}),
        });
        for (const obj of r2List.objects) {
          await env.R2_HUNT_PHOTOS.delete(obj.key);
        }
        cursor = r2List.truncated ? r2List.cursor : undefined;
      } while (cursor);

      await env.TRIVIA_KV.delete(`hunt-history:${huntId}`);

      return Response.json({ ok: true });
    }

    // GET /api/health
    if (method === 'GET' && url.pathname === '/api/health') {
      return Response.json({ status: 'ok', timestamp: Date.now() });
    }

    return new Response('Not found', { status: 404 });
  } catch (err) {
    // Invalid JSON in request body
    if (err instanceof SyntaxError) {
      return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }
    // Unexpected error (DO failures, network issues, etc.)
    console.error('Route error', {
      route: `${method} ${url.pathname}`,
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
