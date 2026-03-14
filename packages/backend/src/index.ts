import { Env } from './env';
import { GameLobby } from './lobby';
import { GameRoom } from './room';
import { PrivateGroup } from './group';
import { ScavengerHuntRoom } from './hunt-room';
import { handleRequest } from './router';

export { GameLobby, GameRoom, PrivateGroup, ScavengerHuntRoom };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env.FRONTEND_URL) });
    }

    try {
      // Reject cross-origin WebSocket upgrades (require matching Origin header)
      if (request.headers.get('Upgrade') === 'websocket') {
        const origin = request.headers.get('Origin');
        if (!origin || origin !== env.FRONTEND_URL) {
          return new Response('Forbidden', { status: 403 });
        }
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

      // WebSocket upgrade: /ws/hunt/:huntId
      if (url.pathname.startsWith('/ws/hunt/') && request.headers.get('Upgrade') === 'websocket') {
        const huntId = url.pathname.split('/ws/hunt/')[1];
        if (!huntId) {
          return new Response('Missing hunt ID', { status: 400 });
        }
        const roomId = env.SCAVENGER_HUNT_ROOM.idFromName(huntId);
        const room = env.SCAVENGER_HUNT_ROOM.get(roomId);
        return room.fetch(request);
      }

      // WebSocket upgrade: /ws/group/:groupId
      if (url.pathname.startsWith('/ws/group/') && request.headers.get('Upgrade') === 'websocket') {
        const groupId = url.pathname.split('/ws/group/')[1];
        if (!groupId) {
          return new Response('Missing group ID', { status: 400 });
        }
        const doId = env.PRIVATE_GROUP.idFromName(groupId);
        const group = env.PRIVATE_GROUP.get(doId);
        return group.fetch(request);
      }

      // HTTP API routes
      const response = await handleRequest(request, env);
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(corsHeaders(env.FRONTEND_URL))) {
        headers.set(k, v);
      }
      return new Response(response.body, { status: response.status, headers });
    } catch (err) {
      console.error('Unhandled error', {
        method: request.method,
        url: url.pathname,
        error: err instanceof Error ? err.message : String(err),
      });
      return new Response('Internal Server Error', {
        status: 500,
        headers: corsHeaders(env.FRONTEND_URL),
      });
    }
  },
};

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Host-Secret, Authorization',
  };
}
