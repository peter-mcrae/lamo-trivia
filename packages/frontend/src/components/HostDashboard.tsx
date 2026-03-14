import { useState } from 'react';
import type { HuntTeamSummary, HuntItem, HuntAppeal } from '@lamo-trivia/shared';
import { HuntTimer } from './HuntTimer';
import { AppealBanner } from './AppealBanner';

interface HostDashboardProps {
  huntId: string;
  teams: HuntTeamSummary[];
  items: HuntItem[];
  endsAt: number;
  appeals: HuntAppeal[];
  onApprove: (playerId: string, itemId: string) => void;
  onReject: (playerId: string, itemId: string) => void;
  onSendMessage: (message: string, targetPlayerId?: string) => void;
}

const STATUS_DOT: Record<string, { color: string; label: string; pulse?: boolean }> = {
  found: { color: 'bg-green-500', label: 'Found' },
  pending_review: { color: 'bg-lamo-blue', label: 'Verifying', pulse: true },
  rejected: { color: 'bg-amber-500', label: 'Rejected' },
  searching: { color: 'bg-gray-300', label: 'Searching' },
};

export function HostDashboard({
  huntId,
  teams,
  items,
  endsAt,
  appeals,
  onApprove,
  onReject,
  onSendMessage,
}: HostDashboardProps) {
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
  const [messageText, setMessageText] = useState('');
  const [messageTarget, setMessageTarget] = useState<string>('all');

  return (
    <div>
      {/* Header */}
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-bold text-lamo-dark">Host Dashboard</h2>
        <p className="text-sm text-lamo-gray-muted">You are observing the hunt</p>
      </div>

      {/* Timer */}
      <div className="mb-6">
        <HuntTimer endsAt={endsAt} />
      </div>

      {/* Game summary */}
      <div className="mb-6 px-4 py-3 bg-lamo-bg rounded-xl border border-lamo-border">
        <div className="flex items-center justify-between text-sm">
          <span className="text-lamo-gray-muted">Teams</span>
          <span className="font-medium text-lamo-dark">{teams.length}</span>
        </div>
        <div className="flex items-center justify-between text-sm mt-1.5">
          <span className="text-lamo-gray-muted">Items</span>
          <span className="font-medium text-lamo-dark">{items.length}</span>
        </div>
      </div>

      {/* Appeals */}
      {appeals.length > 0 && (
        <div className="mb-6">
          <AppealBanner huntId={huntId} appeals={appeals} onApprove={onApprove} onReject={onReject} />
        </div>
      )}

      {/* Leaderboard */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-lamo-dark mb-3">Leaderboard</h3>
        <div className="space-y-2">
          {teams.map((team, i) => {
            const isExpanded = expandedTeam === team.playerId;
            return (
              <div key={team.playerId}>
                <button
                  onClick={() => setExpandedTeam(isExpanded ? null : team.playerId)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-lamo-bg rounded-xl border border-lamo-border hover:border-lamo-blue/30 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-lamo-gray-muted w-6">
                      {i + 1}
                    </span>
                    <span className="text-xl" title={team.avatar.name}>
                      {team.avatar.emoji}
                    </span>
                    <div>
                      <span className="font-medium text-lamo-dark">{team.username}</span>
                      <span className="text-xs text-lamo-gray-muted ml-2">
                        {team.itemsFound}/{team.totalItems} items
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-lamo-blue">{team.totalScore} pts</span>
                    <svg
                      className={`w-4 h-4 text-lamo-gray-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {/* Expanded item details */}
                {isExpanded && (
                  <div className="mt-1 ml-9 rounded-xl border border-lamo-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-lamo-bg">
                          <th className="text-left px-4 py-2 font-medium text-lamo-gray-muted">Item</th>
                          <th className="text-center px-2 py-2 font-medium text-lamo-gray-muted">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => {
                          const status = team.itemStatuses[item.id] || 'searching';
                          const dot = STATUS_DOT[status] || STATUS_DOT.searching;
                          return (
                            <tr key={item.id} className="border-t border-lamo-border">
                              <td className="px-4 py-2.5 text-lamo-dark">{item.description}</td>
                              <td className="px-2 py-2.5 text-center">
                                <span
                                  className={`inline-block w-2 h-2 rounded-full ${dot.color} ${dot.pulse ? 'animate-pulse' : ''}`}
                                  title={dot.label}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}

          {teams.length === 0 && (
            <p className="text-sm text-lamo-gray-muted text-center py-4">No teams yet</p>
          )}
        </div>
      </div>

      {/* Send message to teams */}
      <div className="mt-6 px-4 py-4 bg-lamo-bg rounded-xl border border-lamo-border">
        <h3 className="text-sm font-semibold text-lamo-dark mb-3">Send Message</h3>
        <div className="flex gap-2">
          <select
            value={messageTarget}
            onChange={(e) => setMessageTarget(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-lamo-border bg-white text-lamo-dark"
          >
            <option value="all">All Teams</option>
            {teams.map((team) => (
              <option key={team.playerId} value={team.playerId}>
                {team.username}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && messageText.trim()) {
                onSendMessage(messageText.trim(), messageTarget === 'all' ? undefined : messageTarget);
                setMessageText('');
              }
            }}
            placeholder="Type a message..."
            maxLength={200}
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-lamo-border bg-white text-lamo-dark placeholder:text-lamo-gray-muted focus:outline-none focus:border-lamo-blue"
          />
          <button
            onClick={() => {
              if (messageText.trim()) {
                onSendMessage(messageText.trim(), messageTarget === 'all' ? undefined : messageTarget);
                setMessageText('');
              }
            }}
            disabled={!messageText.trim()}
            className="px-4 py-2 bg-lamo-blue text-white text-sm font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
