import type { Player } from '@lamo-trivia/shared';

interface ScoreBoardProps {
  players: Player[];
  scores: Record<string, number>;
}

export function ScoreBoard({ players, scores }: ScoreBoardProps) {
  const sorted = [...players].sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0));

  return (
    <div className="space-y-2">
      {sorted.map((player, rank) => (
        <div
          key={player.id}
          className="flex items-center justify-between px-4 py-2.5 bg-lamo-bg rounded-xl"
        >
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-lamo-gray-muted w-5">{rank + 1}</span>
            <span className="text-lg" title={player.avatar.name}>{player.avatar.emoji}</span>
            <span className="font-medium text-lamo-dark">{player.username}</span>
          </div>
          <span className="font-bold text-lamo-blue">{scores[player.id] ?? 0}</span>
        </div>
      ))}
    </div>
  );
}
