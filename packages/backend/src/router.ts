import { Env } from './env';
import { GameConfigSchema, UsernameSchema, GroupNameSchema, TRIVIA_CATEGORIES, generateGroupId } from '@lamo-trivia/shared';
import type { GroupGame } from '@lamo-trivia/shared';
import { seedQuestions, getCategoryCounts } from './questions';

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
          body: JSON.stringify(parsed.data),
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
