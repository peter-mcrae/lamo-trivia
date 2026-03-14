import type { HuntResults as HuntResultsType, Player } from '@lamo-trivia/shared';

interface HuntResultsProps {
  results: HuntResultsType;
  players: Player[];
}

export function HuntResults({ results }: HuntResultsProps) {
  const { rankings, itemBreakdown } = results;

  return (
    <div>
      <h2 className="text-2xl font-bold text-lamo-dark text-center mb-2">Hunt Complete!</h2>
      <p className="text-lamo-gray-muted text-center mb-8">Final Results</p>

      {/* Podium */}
      <div className="flex items-end justify-center gap-3 mb-8">
        {/* 2nd Place */}
        {rankings[1] && (
          <div className="flex flex-col items-center w-28">
            <span className="text-3xl mb-1" title={rankings[1].player.avatar.name}>
              {rankings[1].player.avatar.emoji}
            </span>
            <span className="text-sm font-semibold text-lamo-dark truncate w-full text-center">
              {rankings[1].player.username}
            </span>
            <span className="text-xs text-lamo-gray-muted mb-1">
              {rankings[1].score} pts
            </span>
            <span className="text-[10px] text-lamo-gray-muted mb-2">
              {rankings[1].itemsFound}/{rankings[1].totalItems} items
            </span>
            <div className="w-full h-24 rounded-t-xl bg-gradient-to-t from-gray-300 to-gray-200 flex items-center justify-center">
              <span className="text-2xl font-bold text-gray-600">2nd</span>
            </div>
          </div>
        )}

        {/* 1st Place */}
        {rankings[0] && (
          <div className="flex flex-col items-center w-28">
            <span className="text-4xl mb-1" title={rankings[0].player.avatar.name}>
              {rankings[0].player.avatar.emoji}
            </span>
            <span className="text-sm font-bold text-lamo-dark truncate w-full text-center">
              {rankings[0].player.username}
            </span>
            <span className="text-xs text-lamo-gray-muted mb-1">
              {rankings[0].score} pts
            </span>
            <span className="text-[10px] text-lamo-gray-muted mb-2">
              {rankings[0].itemsFound}/{rankings[0].totalItems} items
            </span>
            <div className="w-full h-32 rounded-t-xl bg-gradient-to-t from-yellow-400 to-yellow-300 flex items-center justify-center">
              <span className="text-2xl font-bold text-yellow-700">1st</span>
            </div>
          </div>
        )}

        {/* 3rd Place */}
        {rankings[2] && (
          <div className="flex flex-col items-center w-28">
            <span className="text-3xl mb-1" title={rankings[2].player.avatar.name}>
              {rankings[2].player.avatar.emoji}
            </span>
            <span className="text-sm font-semibold text-lamo-dark truncate w-full text-center">
              {rankings[2].player.username}
            </span>
            <span className="text-xs text-lamo-gray-muted mb-1">
              {rankings[2].score} pts
            </span>
            <span className="text-[10px] text-lamo-gray-muted mb-2">
              {rankings[2].itemsFound}/{rankings[2].totalItems} items
            </span>
            <div className="w-full h-16 rounded-t-xl bg-gradient-to-t from-orange-300 to-orange-200 flex items-center justify-center">
              <span className="text-2xl font-bold text-orange-600">3rd</span>
            </div>
          </div>
        )}
      </div>

      {/* 4th place and beyond */}
      {rankings.length > 3 && (
        <div className="space-y-2 mb-8">
          {rankings.slice(3).map((entry, i) => (
            <div
              key={entry.player.id}
              className="flex items-center justify-between px-5 py-3 rounded-xl bg-lamo-bg border border-lamo-border"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-lamo-gray-muted w-6">{i + 4}th</span>
                <span className="text-xl" title={entry.player.avatar.name}>
                  {entry.player.avatar.emoji}
                </span>
                <div>
                  <span className="font-medium text-lamo-dark">{entry.player.username}</span>
                  <span className="text-xs text-lamo-gray-muted ml-2">
                    {entry.itemsFound}/{entry.totalItems} items
                  </span>
                </div>
              </div>
              <span className="font-bold text-lamo-blue">{entry.score}</span>
            </div>
          ))}
        </div>
      )}

      {/* Per-player item breakdown */}
      {rankings.map((entry) => {
        const playerItems = itemBreakdown[entry.player.id];
        if (!playerItems || playerItems.length === 0) return null;

        return (
          <div key={entry.player.id} className="mb-6">
            <h3 className="text-sm font-semibold text-lamo-dark mb-2 flex items-center gap-2">
              <span className="text-lg" title={entry.player.avatar.name}>
                {entry.player.avatar.emoji}
              </span>
              {entry.player.username}
            </h3>
            <div className="rounded-xl border border-lamo-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-lamo-bg">
                    <th className="text-left px-4 py-2 font-medium text-lamo-gray-muted">Item</th>
                    <th className="text-center px-2 py-2 font-medium text-lamo-gray-muted">Status</th>
                    <th className="text-center px-2 py-2 font-medium text-lamo-gray-muted">Clues</th>
                    <th className="text-right px-4 py-2 font-medium text-lamo-gray-muted">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {playerItems.map((detail) => (
                    <tr key={detail.itemId} className="border-t border-lamo-border">
                      <td className="px-4 py-2.5 text-lamo-dark">{detail.description}</td>
                      <td className="px-2 py-2.5 text-center">
                        {detail.found ? (
                          <span className="inline-block w-2 h-2 rounded-full bg-green-500" title="Found" />
                        ) : (
                          <span className="inline-block w-2 h-2 rounded-full bg-gray-300" title="Not found" />
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-center text-lamo-gray-muted">
                        {detail.cluesUsed}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium text-lamo-dark">
                        {detail.pointsEarned}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
