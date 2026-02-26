import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GameConfigInput } from '@lamo-trivia/shared';
import { GameConfigForm } from '@/components/GameConfigForm';
import { api } from '@/lib/api';

export default function CreateGame() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (config: GameConfigInput) => {
    setSubmitting(true);
    setError('');
    try {
      const result = await api.createGame(config);
      navigate(`/game/${result.gameId}`);
    } catch {
      setError('Failed to create game. Try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto py-10 px-6">
      <h2 className="text-2xl font-bold text-lamo-dark mb-6">Create Game</h2>
      <GameConfigForm
        submitLabel="Create Game"
        submittingLabel="Creating..."
        onSubmit={handleSubmit}
        submitting={submitting}
        error={error}
      />
    </div>
  );
}
