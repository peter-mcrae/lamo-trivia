import type { GameListing, GameConfig, GameMode } from '@lamo-trivia/shared';
import { GAME_EXPIRY_MS, HUNT_EXPIRY_MS, GAME_LIMITS, generateGameId } from '@lamo-trivia/shared';

const MAX_ID_ATTEMPTS = 10;

/** Hunts legitimately wait far longer than trivia games before starting */
function expiryFor(listing: GameListing): number {
  return listing.gameMode === 'scavenger-hunt' ? HUNT_EXPIRY_MS : GAME_EXPIRY_MS;
}

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
        await this.sweepExpired();
        const publicGames = Array.from(this.games.values()).filter(
          (g) => g.phase === 'waiting' && !g.isPrivate,
        );
        return Response.json({ games: publicGames });
      }

      if (request.method === 'POST' && url.pathname === '/games') {
        await this.sweepExpired();
        if (this.games.size >= GAME_LIMITS.maxGamesPerLobby) {
          return Response.json(
            { error: 'Too many active games right now. Please try again in a few minutes.' },
            { status: 503 },
          );
        }

        const config = (await request.json()) as GameConfig & { gameMode?: GameMode };

        // Regenerate on the (unlikely) chance of an ID collision
        let gameId = generateGameId();
        for (let i = 0; this.games.has(gameId) && i < MAX_ID_ATTEMPTS; i++) {
          gameId = generateGameId();
        }
        if (this.games.has(gameId)) {
          return Response.json({ error: 'Failed to allocate game ID' }, { status: 500 });
        }

        const listing: GameListing = {
          id: gameId,
          name: config.name,
          hostUsername: '',
          categoryIds: config.categoryIds || [],
          questionCount: config.questionCount || 0,
          playerCount: 0,
          minPlayers: config.minPlayers,
          maxPlayers: config.maxPlayers,
          timePerQuestion: config.timePerQuestion || 0,
          scoringMethod: config.scoringMethod || 'speed-bonus',
          streakBonus: config.streakBonus || false,
          showAnswers: config.showAnswers ?? true,
          isPrivate: config.isPrivate,
          groupId: config.groupId,
          phase: 'waiting',
          createdAt: Date.now(),
          aiTopic: config.aiTopic,
          gameMode: config.gameMode || 'trivia',
        };
        this.games.set(gameId, listing);
        await this.state.storage.put('games', this.games);
        return Response.json({ gameId, ...listing });
      }

      // GET /admin/games — return ALL games (admin only, called from routes/admin)
      if (request.method === 'GET' && url.pathname === '/admin/games') {
        const allGames = Array.from(this.games.values());
        return Response.json({ games: allGames });
      }

      // PUT /games/:gameId — update a listing (player count, name, config changes)
      if (request.method === 'PUT' && url.pathname.startsWith('/games/')) {
        const gameId = url.pathname.split('/games/')[1];
        const existing = gameId ? this.games.get(gameId) : undefined;
        if (existing) {
          const update = (await request.json()) as Partial<GameListing>;
          this.games.set(gameId, { ...existing, ...update, id: existing.id });
          await this.state.storage.put('games', this.games);
        }
        return Response.json({ ok: true });
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

  /** Remove expired listings from the map and storage */
  private async sweepExpired(): Promise<void> {
    const now = Date.now();
    let changed = false;
    for (const [gameId, listing] of this.games) {
      if (now - listing.createdAt >= expiryFor(listing)) {
        this.games.delete(gameId);
        changed = true;
      }
    }
    if (changed) {
      await this.state.storage.put('games', this.games);
    }
  }
}
