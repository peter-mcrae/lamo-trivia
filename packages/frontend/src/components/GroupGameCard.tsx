import type { GroupGame } from '@lamo-trivia/shared';
import { TRIVIA_CATEGORIES } from '@lamo-trivia/shared';

interface GroupGameCardProps {
  game: GroupGame;
  currentUsername?: string;
  onJoin: () => void;
}

function getGameTypeLabel(mode?: string): { label: string; color: string } {
  switch (mode) {
    case 'scavenger-hunt':
      return { label: 'Scavenger Hunt', color: 'bg-orange-100 text-orange-700' };
    case 'riddle-wordle':
      return { label: 'Riddle Guess', color: 'bg-green-100 text-green-700' };
    default:
      return { label: 'Trivia', color: 'bg-blue-100 text-blue-700' };
  }
}

export function GroupGameCard({ game, currentUsername, onJoin }: GroupGameCardProps) {
  const isAI = !!game.aiTopic;
  const categoryNames = isAI
    ? `AI: ${game.aiTopic}`
    : game.categoryIds
        .map((id) => TRIVIA_CATEGORIES.find((c) => c.id === id)?.name ?? id)
        .join(', ');
  const gameType = getGameTypeLabel(game.gameMode);
  const isHost = currentUsername && game.hostUsername?.toLowerCase() === currentUsername.toLowerCase();

  const getButtonLabel = () => {
    if (game.phase === 'waiting') return isHost ? 'View' : 'Join';
    if (game.phase === 'playing') return isHost ? 'View' : 'In Progress';
    return 'Finished';
  };

  return (
    <div className="flex items-center justify-between p-4 bg-lamo-bg rounded-xl border border-lamo-border">
      <div className="min-w-0 flex-1 mr-3">
        <div className="flex items-center gap-2">
          <h4 className="font-semibold text-lamo-dark truncate">{game.name}</h4>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${gameType.color}`}>
            {gameType.label}
          </span>
        </div>
        <p className="text-sm text-lamo-gray-muted">
          {game.playerCount}/{game.maxPlayers} players
          {game.hostUsername && ` · Host: ${game.hostUsername}`}
        </p>
        {categoryNames && <p className="text-xs text-lamo-gray-muted mt-0.5 truncate">{categoryNames}</p>}
      </div>
      <button
        onClick={onJoin}
        disabled={!isHost && game.phase !== 'waiting'}
        className="px-5 py-2 bg-lamo-blue text-white text-sm font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors disabled:opacity-50 shrink-0"
      >
        {getButtonLabel()}
      </button>
    </div>
  );
}
