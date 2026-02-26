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

  const categoryIcons = game.categoryIds
    .map((id) => TRIVIA_CATEGORIES.find((c) => c.id === id)?.icon ?? '')
    .filter(Boolean)
    .join(' ');

  return (
    <div className="p-4 bg-lamo-bg-hero rounded-xl border border-lamo-border">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-lamo-dark text-lg">{game.name}</h3>
          <p className="text-sm text-lamo-gray-muted">
            {game.playerCount}/{game.maxPlayers} players
            {game.playerCount < game.minPlayers && (
              <span className="text-xs ml-1">(need {game.minPlayers} to start)</span>
            )}
          </p>
        </div>
        <button
          onClick={() => onJoin(game.id)}
          className="px-5 py-2 bg-lamo-blue text-white text-sm font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors shrink-0"
        >
          Join
        </button>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-lamo-gray-muted">
        <span title={categoryNames}>{categoryIcons} {categoryNames}</span>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        <Tag label={`${game.questionCount} questions`} />
        <Tag label={`${game.timePerQuestion}s per question`} />
        <Tag label={game.scoringMethod === 'speed-bonus' ? 'Speed Bonus' : 'Correct Only'} />
        {game.streakBonus && <Tag label="Streak Bonus" />}
        {game.showAnswers && <Tag label="Show Answers" />}
      </div>
    </div>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center text-xs text-lamo-gray-muted bg-lamo-bg border border-lamo-border rounded-full px-2.5 py-0.5">
      {label}
    </span>
  );
}
