import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { HuntConfigInput } from '@lamo-trivia/shared';
import { HuntConfigForm } from '@/components/HuntConfigForm';
import { api } from '@/lib/api';

export default function CreateHunt() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (config: HuntConfigInput) => {
    setSubmitting(true);
    setError('');
    try {
      const result = await api.createHunt(config);
      navigate(`/hunt/${result.huntId}`);
    } catch {
      setError('Failed to create hunt. Try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto py-10 px-6">
      <h2 className="text-2xl font-bold text-lamo-dark mb-6">Create Scavenger Hunt</h2>
      <HuntConfigForm
        submitLabel="Create Hunt"
        submittingLabel="Creating..."
        onSubmit={handleSubmit}
        submitting={submitting}
        error={error}
      />
    </div>
  );
}
