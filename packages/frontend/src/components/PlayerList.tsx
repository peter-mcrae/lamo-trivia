import type { Player } from '@lamo-trivia/shared';

interface PlayerListProps {
  players: Player[];
  hostId: string;
}

export function PlayerList({ players, hostId }: PlayerListProps) {
  return (
    <div className="space-y-2">
      {players.map((player) => (
        <div
          key={player.id}
          className="flex items-center gap-3 px-4 py-2.5 bg-lamo-bg rounded-xl"
        >
          <div className="w-8 h-8 rounded-full bg-lamo-lime/30 flex items-center justify-center text-sm font-bold text-lamo-dark">
            {player.username[0].toUpperCase()}
          </div>
          <span className="font-medium text-lamo-dark">{player.username}</span>
          {player.id === hostId && (
            <span className="text-xs text-lamo-gray-muted bg-lamo-bg-hero border border-lamo-border rounded-full px-2 py-0.5">
              Host
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
