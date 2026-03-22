import { Env } from './env';
import { GameLobby } from './lobby';
import { GameRoom } from './room';
import { PrivateGroup } from './group';
import { ScavengerHuntRoom } from './hunt-room';
import { app } from './app';
import { logError } from './errors';

export { GameLobby, GameRoom, PrivateGroup, ScavengerHuntRoom };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin') || '';
      return new Response(null, { headers: corsHeaders(env, origin) });
    }

    try {
      // Reject cross-origin WebSocket upgrades (require matching Origin header)
      if (request.headers.get('Upgrade') === 'websocket') {
        const origin = request.headers.get('Origin');
        if (!origin || !isAllowedOrigin(origin, env)) {
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
        const huntId = url.pathname.split('/ws/hunt/')[1]?.split('?')[0];
        if (!huntId) {
          return new Response('Missing hunt ID', { status: 400 });
        }
        // Resolve user email from token query param so the DO can identify the creator
        const token = url.searchParams.get('token');
        let userEmail: string | undefined;
        if (token) {
          const raw = await env.TRIVIA_KV.get(`session:${token}`);
          if (raw) {
            const session = JSON.parse(raw) as { email: string; expiresAt: number };
            if (Date.now() <= session.expiresAt) {
              userEmail = session.email;
            }
          }
        }
        const headers = new Headers(request.headers);
        if (userEmail) {
          headers.set('X-User-Email', userEmail);
        }
        const roomId = env.SCAVENGER_HUNT_ROOM.idFromName(huntId);
        const room = env.SCAVENGER_HUNT_ROOM.get(roomId);
        return room.fetch(new Request(request.url, { method: request.method, headers, body: request.body }));
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

      // HTTP API routes — delegate to Hono app
      const origin = request.headers.get('Origin') || '';
      const response = await app.fetch(request, env);
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(corsHeaders(env, origin))) {
        headers.set(k, v);
      }
      return new Response(response.body, { status: response.status, headers });
    } catch (err) {
      const origin = request.headers.get('Origin') || '';
      logError(env, { route: url.pathname, method: request.method }, err);
      return new Response('Internal Server Error', {
        status: 500,
        headers: corsHeaders(env, origin),
      });
    }
  },
};

function isAllowedOrigin(origin: string, env: Env): boolean {
  if (origin === env.FRONTEND_URL) return true;
  if (env.ADMIN_URL && origin === env.ADMIN_URL) return true;
  return false;
}

function corsHeaders(env: Env, requestOrigin: string): Record<string, string> {
  // Only reflect the origin if it's in our allowlist — never use '*' with credentials
  const allowed = isAllowedOrigin(requestOrigin, env) ? requestOrigin : env.FRONTEND_URL;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Host-Secret, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}
