import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { HuntHistorySummary } from '@lamo-trivia/shared';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';

export default function HuntHistory() {
  const [hunts, setHunts] = useState<HuntHistorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getHuntHistory()
      .then((data) => setHunts(data.hunts))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto py-10 px-6 text-center">
        <p className="text-lamo-gray-muted">Loading hunt history...</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-10 px-6">
      <h1 className="text-3xl font-bold text-lamo-dark mb-2">Hunt History</h1>
      <p className="text-lamo-gray-muted mb-8">Browse past scavenger hunts.</p>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
          {error}
        </div>
      )}

      {hunts.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-lamo-gray-muted mb-4">No hunts yet. Create one to get started!</p>
          <Link to="/hunt/create">
            <Button>Create a Hunt</Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {hunts.map((hunt) => (
            <Link
              key={hunt.huntId}
              to={`/hunt/${hunt.huntId}/history`}
              className="block px-5 py-4 rounded-xl bg-lamo-bg border border-lamo-border hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-lamo-dark">{hunt.name}</h3>
                  <p className="text-xs text-lamo-gray-muted mt-0.5">
                    Hosted by {hunt.hostUsername} &middot; {hunt.teamCount} teams &middot;{' '}
                    {hunt.totalItems} items
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-lamo-blue">
                    {hunt.winnerUsername} ({hunt.winnerScore} pts)
                  </p>
                  <p className="text-xs text-lamo-gray-muted">
                    {new Date(hunt.finishedAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
