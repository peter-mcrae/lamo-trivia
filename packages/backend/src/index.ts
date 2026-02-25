import { Env } from './env';
import { GameLobby } from './lobby';
import { GameRoom } from './room';
import { handleRequest } from './router';

export { GameLobby, GameRoom };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env.FRONTEND_URL) });
    }

    // WebSocket upgrade: /ws/game/:gameId
    if (url.pathname.startsWith('/ws/game/') && request.headers.get('Upgrade') === 'websocket') {
      const gameId = url.pathname.split('/ws/game/')[1];
      if (!gameId) {
        return new Response('Missing game ID', { status: 400 });
      }
      const roomId = env.GAME_ROOM.idFromName(gameId);
      const room = env.GAME_ROOM.get(roomId);
      return room.fetch(request);
    }

    // HTTP API routes
    const response = await handleRequest(request, env);
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(corsHeaders(env.FRONTEND_URL))) {
      headers.set(k, v);
    }
    return new Response(response.body, { status: response.status, headers });
  },
};

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
