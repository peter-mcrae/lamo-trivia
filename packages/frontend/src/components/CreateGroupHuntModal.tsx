import { useState } from 'react';
import type { HuntConfigInput } from '@lamo-trivia/shared';
import { HuntConfigForm } from './HuntConfigForm';
import { useAuthContext } from '@/contexts/AuthContext';
import { api } from '@/lib/api';

interface CreateGroupHuntModalProps {
  groupId: string;
  onHuntCreated: (huntId: string) => void;
  onClose: () => void;
}

export function CreateGroupHuntModal({ groupId, onHuntCreated, onClose }: CreateGroupHuntModalProps) {
  const { user } = useAuthContext();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (config: HuntConfigInput) => {
    setSubmitting(true);
    setError('');
    try {
      const result = await api.createGroupHunt(groupId, config);
      onHuntCreated(result.huntId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create hunt. Try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-lamo-dark">New Scavenger Hunt</h2>
          <button
            onClick={onClose}
            className="text-lamo-gray-muted hover:text-lamo-dark transition-colors text-2xl leading-none px-1"
          >
            &times;
          </button>
        </div>
        {!user ? (
          <div className="text-center py-6">
            <p className="text-lamo-gray mb-4">
              You need to sign in and have credits to create a scavenger hunt.
            </p>
            <a
              href="/login"
              className="inline-block px-6 py-2.5 bg-lamo-primary text-white font-medium rounded-lg hover:bg-lamo-primary/90 transition-colors"
            >
              Sign In
            </a>
          </div>
        ) : (
          <HuntConfigForm
            submitLabel="Create Hunt"
            submittingLabel="Creating..."
            onSubmit={handleSubmit}
            submitting={submitting}
            error={error}
            showCreditEstimate
            userCredits={user.credits}
          />
        )}
      </div>
    </div>
  );
}
