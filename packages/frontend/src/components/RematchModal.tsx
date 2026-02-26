import { useState } from 'react';
import type { GameConfig, GameConfigInput } from '@lamo-trivia/shared';
import { GameConfigForm } from './GameConfigForm';
import { api } from '@/lib/api';

interface RematchModalProps {
  currentConfig: GameConfig;
  onRematchCreated: (newGameId: string) => void;
  onClose: () => void;
}

export function RematchModal({ currentConfig, onRematchCreated, onClose }: RematchModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (config: GameConfigInput) => {
    setSubmitting(true);
    setError('');
    try {
      const result = await api.createGame(config);
      onRematchCreated(result.gameId);
    } catch {
      setError('Failed to create game. Try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-lamo-dark">Play Again</h2>
          <button
            onClick={onClose}
            className="text-lamo-gray-muted hover:text-lamo-dark transition-colors text-2xl leading-none px-1"
          >
            &times;
          </button>
        </div>
        <GameConfigForm
          initialConfig={currentConfig}
          submitLabel="Start New Game"
          submittingLabel="Creating..."
          onSubmit={handleSubmit}
          submitting={submitting}
          error={error}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}
