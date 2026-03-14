import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import type { HuntConfigInput } from '@lamo-trivia/shared';
import { HuntConfigForm } from '@/components/HuntConfigForm';
import { useAuthContext } from '@/contexts/AuthContext';
import { api } from '@/lib/api';

export default function CreateHunt() {
  const navigate = useNavigate();
  const { user, loading } = useAuthContext();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (config: HuntConfigInput) => {
    setSubmitting(true);
    setError('');
    try {
      const result = await api.createHunt(config);
      navigate(`/hunt/${result.huntId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create hunt. Try again.');
      setSubmitting(false);
    }
  };

  if (loading) return null;

  if (!user) {
    return (
      <div className="max-w-lg mx-auto py-10 px-6 text-center">
        <h2 className="text-2xl font-bold text-lamo-dark mb-4">Sign In Required</h2>
        <p className="text-lamo-gray-muted mb-6">
          You need to sign in and have credits to create a scavenger hunt.
          Credits are used for AI photo verification.
        </p>
        <Link
          to="/login"
          className="inline-block px-6 py-2.5 bg-lamo-primary text-white font-medium rounded-lg hover:bg-lamo-primary/90 transition-colors"
        >
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto py-10 px-6">
      <h2 className="text-2xl font-bold text-lamo-dark mb-2">Create Scavenger Hunt</h2>
      <p className="text-sm text-lamo-gray-muted mb-6">
        Your balance: <strong>{user.credits} credits</strong>.{' '}
        <Link to="/credits" className="text-lamo-primary hover:underline">
          Buy more
        </Link>
      </p>
      <HuntConfigForm
        submitLabel="Create Hunt"
        submittingLabel="Creating..."
        onSubmit={handleSubmit}
        submitting={submitting}
        error={error}
        showCreditEstimate
        userCredits={user.credits}
      />
    </div>
  );
}
