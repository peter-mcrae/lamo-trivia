import type { HuntAppeal } from '@lamo-trivia/shared';

interface AppealBannerProps {
  appeals: HuntAppeal[];
  onApprove: (playerId: string, itemId: string) => void;
  onReject: (playerId: string, itemId: string) => void;
}

export function AppealBanner({ appeals, onApprove, onReject }: AppealBannerProps) {
  if (appeals.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-lamo-dark flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-amber-500">
          <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
        </svg>
        Pending Appeals ({appeals.length})
      </h3>

      {appeals.map((appeal) => (
        <div
          key={`${appeal.playerId}-${appeal.itemId}`}
          className="rounded-xl border border-amber-200 bg-amber-50/50 p-4"
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-sm font-medium text-lamo-dark">
                {appeal.playerUsername}
              </p>
              <p className="text-xs text-lamo-gray-muted mt-0.5">
                {appeal.itemDescription}
              </p>
            </div>
          </div>

          {appeal.photoUrl && (
            <div className="mb-3 rounded-lg overflow-hidden bg-black">
              <img
                src={appeal.photoUrl}
                alt="Appeal photo"
                className="w-full max-h-40 object-contain"
              />
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => onApprove(appeal.playerId, appeal.itemId)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-green-600 text-white text-sm font-semibold rounded-pill hover:bg-green-700 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
              </svg>
              Approve
            </button>
            <button
              onClick={() => onReject(appeal.playerId, appeal.itemId)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-red-600 text-white text-sm font-semibold rounded-pill hover:bg-red-700 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
