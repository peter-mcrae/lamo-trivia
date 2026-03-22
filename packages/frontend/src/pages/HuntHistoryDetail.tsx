import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { HuntHistoryEntry } from '@lamo-trivia/shared';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { HuntResults } from '../components/HuntResults';
import { getHostSecret, removeHostSecret } from '../hooks/useHuntHostSecrets';

export default function HuntHistoryDetail() {
  const { huntId } = useParams<{ huntId: string }>();
  const navigate = useNavigate();
  const [hunt, setHunt] = useState<Omit<HuntHistoryEntry, 'hostSecret'> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const hostSecret = huntId ? getHostSecret(huntId) : null;
  const isHost = !!hostSecret;

  useEffect(() => {
    if (!huntId) return;
    api
      .getHuntHistoryDetail(huntId)
      .then((data) => setHunt(data.hunt))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [huntId]);

  const handleDelete = async () => {
    if (!huntId || !hostSecret) return;
    setDeleting(true);
    try {
      await api.deleteHuntHistory(huntId, hostSecret);
      removeHostSecret(huntId);
      navigate('/hunts/history', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto py-10 px-6 text-center">
        <p className="text-lamo-gray-muted">Loading hunt details...</p>
      </div>
    );
  }

  if (error || !hunt) {
    return (
      <div className="max-w-3xl mx-auto py-10 px-6 text-center">
        <p className="text-red-500 font-medium mb-4">{error || 'Hunt not found'}</p>
        <Button variant="secondary" onClick={() => navigate('/hunts/history')}>
          Back to History
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-10 px-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-lamo-dark">{hunt.config.name}</h1>
          <p className="text-sm text-lamo-gray-muted mt-1">
            Hosted by {hunt.hostUsername} &middot;{' '}
            {new Date(hunt.finishedAt).toLocaleDateString()} at{' '}
            {new Date(hunt.finishedAt).toLocaleTimeString()}
          </p>
          <p className="text-xs text-lamo-gray-muted mt-0.5">
            {hunt.config.durationMinutes} min &middot; {hunt.config.items.length} items &middot;{' '}
            {hunt.players.length} teams
          </p>
        </div>
        {isHost && (
          <div>
            {showDeleteConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-500">Are you sure?</span>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-xs px-3 py-1.5 rounded-full bg-red-500 text-white font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  {deleting ? 'Deleting...' : 'Yes, Delete'}
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="text-xs px-3 py-1.5 rounded-full border border-lamo-border text-lamo-gray-muted hover:text-lamo-dark transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="text-xs px-3 py-1.5 rounded-full border border-red-200 text-red-500 font-medium hover:bg-red-50 transition-colors"
              >
                Delete Hunt
              </button>
            )}
          </div>
        )}
      </div>

      {/* Results */}
      <HuntResults results={hunt.results} players={hunt.players as any} />

      {/* Photos Section */}
      {Object.keys(hunt.photoKeys).length > 0 && (
        <div className="mt-10">
          <h2 className="text-xl font-bold text-lamo-dark mb-4">Photos</h2>
          {hunt.players.map((player) => {
            const playerPhotos = hunt.photoKeys[player.id];
            if (!playerPhotos || Object.keys(playerPhotos).length === 0) return null;

            return (
              <div key={player.id} className="mb-6">
                <h3 className="text-sm font-semibold text-lamo-dark mb-3 flex items-center gap-2">
                  <span className="text-lg">{player.avatar.emoji}</span>
                  {player.username}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {Object.entries(playerPhotos).map(([itemId, photoKey]) => {
                    const item = hunt.config.items.find((i) => i.id === itemId);
                    const photoFileName = photoKey.split('/').pop() || photoKey;
                    return (
                      <div
                        key={itemId}
                        className="rounded-xl overflow-hidden border border-lamo-border"
                      >
                        <img
                          src={api.getHuntPhotoUrl(hunt.huntId, photoFileName)}
                          alt={item?.description || 'Hunt photo'}
                          className="w-full h-32 object-cover"
                          loading="lazy"
                        />
                        <div className="px-2 py-1.5 bg-lamo-bg">
                          <p className="text-xs text-lamo-gray-muted truncate">
                            {item?.description || itemId}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-center gap-3 mt-8">
        <Button variant="secondary" onClick={() => navigate('/hunts/history')}>
          Back to History
        </Button>
        {hunt.groupId ? (
          <Button
            onClick={() =>
              navigate(`/group/${hunt.groupId}`, {
                state: { cloneHuntConfig: hunt.config },
              })
            }
          >
            Clone Hunt
          </Button>
        ) : (
          <Button
            onClick={() =>
              navigate('/hunt/create', {
                state: { cloneHuntConfig: hunt.config },
              })
            }
          >
            Clone Hunt
          </Button>
        )}
      </div>
    </div>
  );
}
