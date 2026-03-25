import type { HuntItem, HuntItemProgress } from '@lamo-trivia/shared';

interface HuntItemCardProps {
  item: HuntItem;
  progress: HuntItemProgress;
  isVerifying: boolean;
  maxRetries: number;
  rejectionReason?: string;
  deniedMessage?: string;
  onRevealClue: (itemId: string, clueId: string) => void;
  onTakePhoto: (itemId: string) => void;
  onContestPhoto: (itemId: string) => void;
}

function StatusBadge({ status, isVerifying, isAppealDenied }: { status: HuntItemProgress['status']; isVerifying: boolean; isAppealDenied?: boolean }) {
  if (isVerifying) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-lamo-blue/10 text-lamo-blue">
        <span className="w-1.5 h-1.5 rounded-full bg-lamo-blue animate-pulse" />
        Verifying...
      </span>
    );
  }

  switch (status) {
    case 'found':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-700">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
            <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
          </svg>
          Found!
        </span>
      );
    case 'rejected':
      if (isAppealDenied) {
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-red-100 text-red-700">
            Rejected
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          Host Reviewing
        </span>
      );
    case 'pending_review':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-lamo-blue/10 text-lamo-blue">
          <span className="w-1.5 h-1.5 rounded-full bg-lamo-blue animate-pulse" />
          Verifying...
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-lamo-gray-muted">
          Searching
        </span>
      );
  }
}

export function HuntItemCard({
  item,
  progress,
  isVerifying,
  maxRetries,
  rejectionReason,
  deniedMessage,
  onRevealClue,
  onTakePhoto,
  onContestPhoto,
}: HuntItemCardProps) {
  const isFound = progress.status === 'found';
  const isAppealDenied = progress.status === 'rejected' && !!deniedMessage;
  const isHostReviewing = progress.status === 'rejected' && !isAppealDenied;
  const attemptsRemaining = maxRetries - progress.attemptsUsed;
  const canTakePhoto = !isFound && !isVerifying && !isHostReviewing && !isAppealDenied && attemptsRemaining > 0 && progress.status !== 'pending_review';
  const canContest = !!rejectionReason && !isFound && !isVerifying && !isHostReviewing && !isAppealDenied && attemptsRemaining > 0;

  return (
    <div
      className={`rounded-xl border p-5 transition-colors ${
        isFound
          ? 'bg-green-50/50 border-green-200'
          : 'bg-white border-lamo-border'
      }`}
    >
      {/* Header: description + status */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className={`font-medium ${isFound ? 'text-green-800' : 'text-lamo-dark'}`}>
          {item.description}
        </p>
        <StatusBadge status={progress.status} isVerifying={isVerifying} isAppealDenied={isAppealDenied} />
      </div>

      {/* Points */}
      <p className="text-xs text-lamo-gray-muted mb-3">
        {item.basePoints} pts
      </p>

      {/* Clues */}
      {(item.clues ?? []).length > 0 && (
        <div className="space-y-2 mb-4">
          {(item.clues ?? []).map((clue, i) => {
            const isRevealed = progress.cluesRevealed.includes(clue.id);

            if (isRevealed) {
              return (
                <div
                  key={clue.id}
                  className="px-3 py-2 rounded-lg bg-lamo-bg text-sm text-lamo-dark"
                >
                  <span className="text-xs font-semibold text-lamo-gray-muted mr-2">Clue {i + 1}:</span>
                  {clue.text}
                </div>
              );
            }

            return (
              <button
                key={clue.id}
                onClick={() => onRevealClue(item.id, clue.id)}
                disabled={isFound}
                className="w-full text-left px-3 py-2 rounded-lg border border-dashed border-lamo-border text-sm text-lamo-gray-muted hover:border-lamo-blue/40 hover:text-lamo-blue transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Reveal Clue {i + 1} (-{clue.pointCost}pts)
              </button>
            );
          })}
        </div>
      )}

      {/* Rejection reason (AI) */}
      {rejectionReason && !isFound && !isHostReviewing && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-700">
          Photo rejected: {rejectionReason}
        </div>
      )}

      {/* Host denial message */}
      {deniedMessage && !isFound && !isHostReviewing && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
          {deniedMessage}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onTakePhoto(item.id)}
            disabled={!canTakePhoto}
            className="inline-flex items-center gap-2 px-4 py-2 bg-lamo-blue text-white text-sm font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M1 8a2 2 0 0 1 2-2h.93a2 2 0 0 0 1.664-.89l.812-1.22A2 2 0 0 1 8.07 3h3.86a2 2 0 0 1 1.664.89l.812 1.22A2 2 0 0 0 16.07 6H17a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8Zm13.5 3a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM10 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
            </svg>
            Take Photo
          </button>
          {canContest && (
            <button
              onClick={() => onContestPhoto(item.id)}
              className="inline-flex items-center gap-1.5 px-4 py-2 border border-amber-300 text-amber-700 text-sm font-semibold rounded-pill hover:bg-amber-50 transition-colors"
            >
              Contest
            </button>
          )}
        </div>

        {!isFound && (
          <span className={`text-xs ${attemptsRemaining <= 0 ? 'text-red-500 font-medium' : 'text-lamo-gray-muted'}`}>
            {attemptsRemaining <= 0 ? 'No attempts left' : `${attemptsRemaining} attempt${attemptsRemaining !== 1 ? 's' : ''} left`}
          </span>
        )}
      </div>
    </div>
  );
}
