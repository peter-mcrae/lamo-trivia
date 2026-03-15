import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GameConfigInput } from '@lamo-trivia/shared';
import { GameConfigForm } from '@/components/GameConfigForm';
import { SEO } from '@/components/SEO';
import { useAuthContext } from '@/contexts/AuthContext';
import { api } from '@/lib/api';

export default function CreateGame() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [groups, setGroups] = useState<{ groupId: string; name: string }[]>([]);

  useEffect(() => {
    if (!user) return;
    api.getMyGroups()
      .then(({ groups: owned }) => setGroups(owned))
      .catch(() => {});
  }, [user]);

  const handleSubmit = async (config: GameConfigInput) => {
    setSubmitting(true);
    setError('');
    try {
      const result = selectedGroupId
        ? await api.createGroupGame(selectedGroupId, config)
        : await api.createGame(config);
      navigate(`/game/${result.gameId}`);
    } catch {
      setError('Failed to create game. Try again.');
      setSubmitting(false);
    }
  };

  return (
    <><SEO
        title="Create a Trivia Game - LAMO Games"
        description="Create a free multiplayer trivia game. Choose categories, set the rules, and share the code with friends and family."
        canonical="https://lamotrivia.app/create"
      />
    <div className="max-w-lg mx-auto py-10 px-6">
      <h2 className="text-2xl font-bold text-lamo-dark mb-6">Create Game</h2>

      {groups.length > 0 && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-lamo-dark mb-1.5">
            Create in
          </label>
          <select
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value)}
            className="w-full px-4 py-2.5 border border-lamo-border rounded-xl text-lamo-dark bg-white focus:outline-none focus:ring-2 focus:ring-lamo-blue/40"
          >
            <option value="">Public (anyone with the code can join)</option>
            {groups.map((g) => (
              <option key={g.groupId} value={g.groupId}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <GameConfigForm
        submitLabel="Create Game"
        submittingLabel="Creating..."
        onSubmit={handleSubmit}
        submitting={submitting}
        error={error}
      />
    </div></>
  );
}
