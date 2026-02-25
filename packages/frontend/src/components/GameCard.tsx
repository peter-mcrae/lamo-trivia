import type { GameListing } from '@lamo-trivia/shared';
import { TRIVIA_CATEGORIES } from '@lamo-trivia/shared';

interface GameCardProps {
  game: GameListing;
  onJoin: (gameId: string) => void;
}

export function GameCard({ game, onJoin }: GameCardProps) {
  const categoryNames = game.categoryIds
    .map((id) => TRIVIA_CATEGORIES.find((c) => c.id === id)?.name ?? id)
    .join(', ');

  return (
    <div className="flex items-center justify-between p-4 bg-lamo-bg-hero rounded-xl border border-lamo-border">
      <div>
        <h3 className="font-semibold text-lamo-dark">{game.name}</h3>
        <p className="text-sm text-lamo-gray-muted">
          {game.hostUsername} &middot; {game.playerCount}/{game.maxPlayers} players
        </p>
        <p className="text-xs text-lamo-gray-light mt-0.5">
          {categoryNames} &middot; {game.scoringMethod === 'speed-bonus' ? 'Speed Bonus' : 'Correct Only'}
        </p>
      </div>
      <button
        onClick={() => onJoin(game.id)}
        className="px-5 py-2 bg-lamo-blue text-white text-sm font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors"
      >
        Join
      </button>
    </div>
  );
}
