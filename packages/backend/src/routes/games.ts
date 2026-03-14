import { Hono } from 'hono';
import type { Env } from '../env';
import {
  GameConfigSchema, UsernameSchema, TRIVIA_CATEGORIES,
} from '@lamo-trivia/shared';
import { seedQuestions, getCategoryCounts, getAIQuestionBankTopics } from '../questions';
import { logEvent } from '../analytics';
import { ipRateLimit, gameCreateLimiter, usernameCheckLimiter } from '../middleware/rate-limit';
import { seedAuthMiddleware } from '../middleware/seed-auth';
import { timingSafeEqual } from '../auth';

const games = new Hono<{ Bindings: Env }>();

// GET /api/games — list public games
games.get('/', async (c) => {
  const lobbyId = c.env.GAME_LOBBY.idFromName('global');
  const lobby = c.env.GAME_LOBBY.get(lobbyId);
  return lobby.fetch(new Request('http://internal/games'));
});

// POST /api/games — create a new game
games.post('/', ipRateLimit(gameCreateLimiter), async (c) => {
  const body = await c.req.json();
  const parsed = GameConfigSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const lobbyId = c.env.GAME_LOBBY.idFromName('global');
  const lobby = c.env.GAME_LOBBY.get(lobbyId);
  const lobbyRes = await lobby.fetch(
    new Request('http://internal/games', {
      method: 'POST',
      body: JSON.stringify({ ...parsed.data, gameMode: 'trivia' }),
    }),
  );
  const lobbyData = (await lobbyRes.json()) as { gameId: string };

  // Forward config to the GameRoom DO
  const roomId = c.env.GAME_ROOM.idFromName(lobbyData.gameId);
  const room = c.env.GAME_ROOM.get(roomId);
  await room.fetch(
    new Request('http://internal/config', {
      method: 'POST',
      body: JSON.stringify({ ...parsed.data, gameId: lobbyData.gameId }),
    }),
  );

  logEvent(c.env, 'game_created', {
    gameId: lobbyData.gameId,
    gameMode: 'trivia',
    name: parsed.data.name,
    categoryIds: parsed.data.categoryIds,
    questionCount: parsed.data.questionCount,
    maxPlayers: parsed.data.maxPlayers,
    aiTopic: parsed.data.aiTopic ?? null,
    isPrivate: parsed.data.isPrivate,
    isGroupGame: false,
  }).catch(() => {});

  return c.json(lobbyData);
});

// Separate Hono apps for non-game paths mounted at /api level
const misc = new Hono<{ Bindings: Env }>();

// POST /api/username/check
misc.post('/username/check', ipRateLimit(usernameCheckLimiter), async (c) => {
  const { username } = (await c.req.json()) as { username: string };
  const parsed = UsernameSchema.safeParse(username);
  if (!parsed.success) {
    return c.json({ available: false, error: parsed.error.flatten() }, 400);
  }
  const existing = await c.env.TRIVIA_KV.get(`username:${parsed.data.toLowerCase()}`);
  return c.json({ available: !existing });
});

// GET /api/categories
misc.get('/categories', async (c) => {
  const counts = await getCategoryCounts(c.env.TRIVIA_KV);
  const categories = TRIVIA_CATEGORIES.map((cat) => ({
    ...cat,
    questionCount: counts[cat.id] ?? 0,
  }));
  return c.json({ categories });
});

// POST /api/seed
misc.post('/seed', seedAuthMiddleware, async (c) => {
  const categories = (await c.req.json()) as Record<string, unknown[]>;
  const counts = await seedQuestions(c.env.TRIVIA_KV, categories as Record<string, import('@lamo-trivia/shared').Question[]>);
  return c.json({ seeded: true, counts });
});

// GET /api/ai-question-bank
misc.get('/ai-question-bank', async (c) => {
  const topics = await getAIQuestionBankTopics(c.env.TRIVIA_KV);
  return c.json({ topics });
});

// GET /api/analytics/summary (seed-secret auth)
misc.get('/analytics/summary', seedAuthMiddleware, async (c) => {
  const eventType = c.req.query('type');
  const datePrefix = c.req.query('date');

  let prefix = 'evt:';
  if (eventType) prefix += `${eventType}:`;
  if (eventType && datePrefix) prefix += `${datePrefix}`;

  const events: Array<{ key: string; metadata: unknown }> = [];
  let cursor: string | undefined;
  const maxPages = 10;
  let page = 0;

  do {
    const listResult = await c.env.TRIVIA_KV.list({
      prefix,
      ...(cursor ? { cursor } : {}),
    });

    for (const k of listResult.keys) {
      if (k.metadata) {
        events.push({ key: k.name, metadata: k.metadata });
      }
    }

    cursor = listResult.list_complete ? undefined : listResult.cursor;
    page++;
  } while (cursor && page < maxPages);

  const counts: Record<string, number> = {};
  for (const evt of events) {
    const meta = evt.metadata as { type?: string };
    const t = meta.type || 'unknown';
    counts[t] = (counts[t] || 0) + 1;
  }

  return c.json({
    totalEvents: events.length,
    counts,
    events: events.slice(0, 200),
    truncated: events.length > 200,
  });
});

// GET /api/health
misc.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() });
});

// POST /api/t — analytics beacon
misc.post('/t', async (c) => {
  const { trackingLimiter, getClientIP } = await import('../middleware/rate-limit');
  if (!trackingLimiter.check(getClientIP(c.req.raw))) {
    return new Response(null, { status: 204 });
  }
  try {
    const { sendToGA } = await import('../ga');
    const { p, t, cid } = await c.req.json() as { p?: string; t?: string; cid?: string };
    if (p && cid) {
      sendToGA(c.env, cid, [{
        name: 'page_view',
        params: {
          page_location: `https://lamotrivia.app${p}`,
          page_title: t || '',
        },
      }]).catch(() => {});
    }
  } catch { /* ignore malformed body */ }
  return new Response(null, { status: 204 });
});

export { games as gameRoutes, misc as miscRoutes };
