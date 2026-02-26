import type { GroupGame } from '@lamo-trivia/shared';
import { TRIVIA_CATEGORIES } from '@lamo-trivia/shared';

interface GroupGameCardProps {
  game: GroupGame;
  onJoin: () => void;
}

export function GroupGameCard({ game, onJoin }: GroupGameCardProps) {
  const isAI = !!game.aiTopic;
  const categoryNames = isAI
    ? `AI: ${game.aiTopic}`
    : game.categoryIds
        .map((id) => TRIVIA_CATEGORIES.find((c) => c.id === id)?.name ?? id)
        .join(', ');

  return (
    <div className="flex items-center justify-between p-4 bg-lamo-bg rounded-xl border border-lamo-border">
      <div className="min-w-0 flex-1 mr-3">
        <h4 className="font-semibold text-lamo-dark truncate">{game.name}</h4>
        <p className="text-sm text-lamo-gray-muted">
          {game.playerCount}/{game.maxPlayers} players
          {game.hostUsername && ` · Host: ${game.hostUsername}`}
        </p>
        <p className="text-xs text-lamo-gray-muted mt-0.5 truncate">{categoryNames}</p>
      </div>
      <button
        onClick={onJoin}
        disabled={game.phase !== 'waiting'}
        className="px-5 py-2 bg-lamo-blue text-white text-sm font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors disabled:opacity-50 shrink-0"
      >
        {game.phase === 'waiting' ? 'Join' : game.phase === 'playing' ? 'In Progress' : 'Finished'}
      </button>
    </div>
  );
}
