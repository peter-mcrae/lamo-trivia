import type { GameListing, GameConfig } from '@lamo-trivia/shared';

export class GameLobby {
  private state: DurableObjectState;
  private games: Map<string, GameListing> = new Map();

  constructor(state: DurableObjectState) {
    this.state = state;
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<Map<string, GameListing>>('games');
      if (stored) this.games = stored;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/games') {
      const publicGames = Array.from(this.games.values()).filter(
        (g) => g.phase === 'waiting',
      );
      return Response.json({ games: publicGames });
    }

    if (request.method === 'POST' && url.pathname === '/games') {
      const config = (await request.json()) as GameConfig;
      const gameId = generateGameId();
      const listing: GameListing = {
        id: gameId,
        name: config.name,
        hostUsername: '',
        categoryIds: config.categoryIds,
        playerCount: 0,
        maxPlayers: config.maxPlayers,
        scoringMethod: config.scoringMethod,
        phase: 'waiting',
      };
      this.games.set(gameId, listing);
      await this.state.storage.put('games', this.games);
      return Response.json({ gameId, ...listing });
    }

    return new Response('Not found', { status: 404 });
  }
}

function generateGameId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const nums = '0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  code += '-';
  for (let i = 0; i < 4; i++) code += nums[Math.floor(Math.random() * nums.length)];
  return code;
}
