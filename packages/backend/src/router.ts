import { Env } from './env';
import { GameConfigSchema, UsernameSchema, TRIVIA_CATEGORIES } from '@lamo-trivia/shared';
import { seedQuestions, getCategoryCounts } from './questions';

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;

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

  // POST /api/seed — populate KV with questions from source files
  if (method === 'POST' && url.pathname === '/api/seed') {
    const counts = await seedQuestions(env.TRIVIA_KV);
    return Response.json({ seeded: true, counts });
  }

  // GET /api/health
  if (method === 'GET' && url.pathname === '/api/health') {
    return Response.json({ status: 'ok', timestamp: Date.now() });
  }

  return new Response('Not found', { status: 404 });
}
