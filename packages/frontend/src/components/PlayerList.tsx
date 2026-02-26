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
          <div className="w-9 h-9 rounded-full bg-lamo-lime/20 flex items-center justify-center text-lg" title={player.avatar.name}>
            {player.avatar.emoji}
          </div>
          <div className="flex flex-col">
            <span className="font-medium text-lamo-dark">{player.username}</span>
            <span className="text-xs text-lamo-gray-muted -mt-0.5">{player.avatar.name}</span>
          </div>
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
