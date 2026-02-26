import type { GameListing, GameConfig } from '@lamo-trivia/shared';
import { GAME_EXPIRY_MS, generateGameId } from '@lamo-trivia/shared';

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

    try {
      if (request.method === 'GET' && url.pathname === '/games') {
        const now = Date.now();
        const publicGames = Array.from(this.games.values()).filter(
          (g) => g.phase === 'waiting' && !g.isPrivate && (now - g.createdAt) < GAME_EXPIRY_MS,
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
          questionCount: config.questionCount,
          playerCount: 0,
          minPlayers: config.minPlayers,
          maxPlayers: config.maxPlayers,
          timePerQuestion: config.timePerQuestion,
          scoringMethod: config.scoringMethod,
          streakBonus: config.streakBonus,
          showAnswers: config.showAnswers,
          isPrivate: config.isPrivate,
          groupId: config.groupId,
          phase: 'waiting',
          createdAt: Date.now(),
          aiTopic: config.aiTopic,
        };
        this.games.set(gameId, listing);
        await this.state.storage.put('games', this.games);
        return Response.json({ gameId, ...listing });
      }

      // DELETE /games/:gameId — remove a game listing (used by room expiry)
      if (request.method === 'DELETE' && url.pathname.startsWith('/games/')) {
        const gameId = url.pathname.split('/games/')[1];
        if (gameId && this.games.has(gameId)) {
          this.games.delete(gameId);
          await this.state.storage.put('games', this.games);
          return Response.json({ deleted: true });
        }
        return Response.json({ deleted: false }, { status: 404 });
      }

      return new Response('Not found', { status: 404 });
    } catch (err) {
      console.error('GameLobby fetch error', {
        method: request.method,
        path: url.pathname,
        error: err instanceof Error ? err.message : String(err),
      });
      return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
  }
}
