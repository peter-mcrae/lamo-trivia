import { Hono } from 'hono';
import type { Env } from '../env';
import {
  GameConfigSchema, HuntConfigSchema, GroupNameSchema,
  generateGroupId, HUNT_LIMITS,
} from '@lamo-trivia/shared';
import type { GroupGame } from '@lamo-trivia/shared';
import { getSessionUser } from '../auth';
import { logEvent } from '../analytics';
import {
  ipRateLimit, groupCreateLimiter, groupGameLimiter,
} from '../middleware/rate-limit';

const groups = new Hono<{ Bindings: Env }>();

// POST /api/groups — create a new private group (requires auth)
groups.post('/', ipRateLimit(groupCreateLimiter), async (c) => {
  const user = await getSessionUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Sign in to create a group' }, 401);

  const body = (await c.req.json()) as { name: string };
  const parsed = GroupNameSchema.safeParse(body.name);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const groupId = generateGroupId();
  const doId = c.env.PRIVATE_GROUP.idFromName(groupId);
  const group = c.env.PRIVATE_GROUP.get(doId);
  const res = await group.fetch(
    new Request('http://internal/init', {
      method: 'POST',
      body: JSON.stringify({ id: groupId, name: parsed.data, ownerEmail: user.email }),
    }),
  );

  if (!res.ok) {
    // Extremely unlikely collision — retry once with new ID
    const retryId = generateGroupId();
    const retryDoId = c.env.PRIVATE_GROUP.idFromName(retryId);
    const retryGroup = c.env.PRIVATE_GROUP.get(retryDoId);
    await retryGroup.fetch(
      new Request('http://internal/init', {
        method: 'POST',
        body: JSON.stringify({ id: retryId, name: parsed.data, ownerEmail: user.email }),
      }),
    );
    return c.json({ groupId: retryId, name: parsed.data });
  }

  // Index group by owner email for recovery
  const ownerKey = `owner-groups:${user.email}`;
  const existing = await c.env.TRIVIA_KV.get<string[]>(ownerKey, 'json') ?? [];
  existing.push(groupId);
  await c.env.TRIVIA_KV.put(ownerKey, JSON.stringify(existing));

  return c.json({ groupId, name: parsed.data });
});

// GET /api/groups/my — list groups owned by the authenticated user
groups.get('/my', async (c) => {
  const user = await getSessionUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const ownerKey = `owner-groups:${user.email}`;
  const groupIds = await c.env.TRIVIA_KV.get<string[]>(ownerKey, 'json') ?? [];

  const result: { groupId: string; name: string }[] = [];
  for (const gid of groupIds) {
    const doId = c.env.PRIVATE_GROUP.idFromName(gid);
    const group = c.env.PRIVATE_GROUP.get(doId);
    const res = await group.fetch(new Request('http://internal/state'));
    if (res.ok) {
      const data = (await res.json()) as { id: string; name: string };
      result.push({ groupId: data.id, name: data.name });
    }
  }
  return c.json({ groups: result });
});

// GET /api/groups/:groupId — validate group exists
groups.get('/:groupId', async (c) => {
  const groupId = c.req.param('groupId');
  const doId = c.env.PRIVATE_GROUP.idFromName(groupId);
  const group = c.env.PRIVATE_GROUP.get(doId);
  const res = await group.fetch(new Request('http://internal/state'));
  if (!res.ok) return c.json({ error: 'Group not found' }, 404);
  return c.json(await res.json());
});

// POST /api/groups/:groupId/games — create a game within a group
groups.post('/:groupId/games', ipRateLimit(groupGameLimiter), async (c) => {
  const groupId = c.req.param('groupId');

  // Validate group exists
  const doId = c.env.PRIVATE_GROUP.idFromName(groupId);
  const group = c.env.PRIVATE_GROUP.get(doId);
  const checkRes = await group.fetch(new Request('http://internal/state'));
  if (!checkRes.ok) return c.json({ error: 'Group not found' }, 404);

  // Parse game config — force isPrivate=true and set groupId
  const body = await c.req.json();
  const parsed = GameConfigSchema.safeParse({ ...(body as object), isPrivate: true, groupId });
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  // Create game in lobby
  const lobbyId = c.env.GAME_LOBBY.idFromName('global');
  const lobby = c.env.GAME_LOBBY.get(lobbyId);
  const lobbyRes = await lobby.fetch(
    new Request('http://internal/games', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
    }),
  );
  const lobbyData = (await lobbyRes.json()) as { gameId: string };

  // Configure the GameRoom
  const roomId = c.env.GAME_ROOM.idFromName(lobbyData.gameId);
  const room = c.env.GAME_ROOM.get(roomId);
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

  if (!groupRes.ok) {
    const errorData = (await groupRes.json()) as { error: string };
    return c.json({ error: errorData.error }, groupRes.status as 400);
  }

  logEvent(c.env, 'game_created', {
    gameId: lobbyData.gameId,
    gameMode: 'trivia',
    name: parsed.data.name,
    categoryIds: parsed.data.categoryIds,
    questionCount: parsed.data.questionCount,
    maxPlayers: parsed.data.maxPlayers,
    aiTopic: parsed.data.aiTopic ?? null,
    isPrivate: true,
    isGroupGame: true,
    groupId,
  }).catch(() => {});

  return c.json({ gameId: lobbyData.gameId });
});

// POST /api/groups/:groupId/hunts — create a hunt within a group
groups.post('/:groupId/hunts', ipRateLimit(groupGameLimiter), async (c) => {
  const user = await getSessionUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Sign in to create a scavenger hunt' }, 401);

  const groupId = c.req.param('groupId');

  // Validate group exists
  const doId = c.env.PRIVATE_GROUP.idFromName(groupId);
  const group = c.env.PRIVATE_GROUP.get(doId);
  const checkRes = await group.fetch(new Request('http://internal/state'));
  if (!checkRes.ok) return c.json({ error: 'Group not found' }, 404);

  const body = await c.req.json();
  const parsed = HuntConfigSchema.safeParse({ ...(body as object), isPrivate: true, groupId });
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  // Validate minimum credits
  const minCredits = parsed.data.items.length * parsed.data.maxRetries * parsed.data.maxPlayers;
  if (user.credits < minCredits) {
    return c.json({
      error: 'Not enough credits to create this hunt',
      creditsNeeded: minCredits,
    }, 402);
  }

  // Create lobby listing
  const lobbyId = c.env.GAME_LOBBY.idFromName('global');
  const lobby = c.env.GAME_LOBBY.get(lobbyId);
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
  const roomId = c.env.SCAVENGER_HUNT_ROOM.idFromName(huntId);
  const room = c.env.SCAVENGER_HUNT_ROOM.get(roomId);
  await room.fetch(
    new Request('http://internal/config', {
      method: 'POST',
      body: JSON.stringify({ ...parsed.data, huntId, hostEmail: user.email }),
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
    return c.json({ error: errorData.error }, groupRes.status as 400);
  }

  logEvent(c.env, 'hunt_created', {
    huntId,
    name: parsed.data.name,
    itemCount: parsed.data.items.length,
    maxPlayers: parsed.data.maxPlayers,
    durationMinutes: parsed.data.durationMinutes,
    maxRetries: parsed.data.maxRetries,
    isPrivate: true,
    isGroupGame: true,
    groupId,
  }).catch(() => {});

  return c.json({ huntId });
});

// GET /api/groups/:groupId/hunts/history — hunt history for a group
groups.get('/:groupId/hunts/history', async (c) => {
  const { huntHistoryLimiter, getClientIP } = await import('../middleware/rate-limit');
  if (!huntHistoryLimiter.check(getClientIP(c.req.raw))) {
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }

  const groupId = c.req.param('groupId');
  const { HuntHistorySummary } = await import('@lamo-trivia/shared');

  const listResult = await c.env.TRIVIA_KV.list<import('@lamo-trivia/shared').HuntHistorySummary>({
    prefix: 'hunt-history:',
  });

  const summaries = listResult.keys
    .filter((k) => k.metadata && (k.metadata as any).groupId === groupId)
    .map((k) => k.metadata!);

  summaries.sort((a, b) => b.finishedAt - a.finishedAt);

  return c.json({ hunts: summaries });
});

export { groups as groupRoutes };
