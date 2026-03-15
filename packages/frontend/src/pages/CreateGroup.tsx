import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useGroups } from '@/hooks/useGroups';
import { useAuthContext } from '@/contexts/AuthContext';
import { SEO } from '@/components/SEO';

export default function CreateGroup() {
  const navigate = useNavigate();
  const { addGroup } = useGroups();
  const { user, loading } = useAuthContext();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Give your group a name');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const result = await api.createGroup(name.trim());
      addGroup(result.groupId, result.name);
      navigate(`/group/${result.groupId}`);
    } catch {
      setError('Failed to create group. Try again.');
      setSubmitting(false);
    }
  };

  if (loading) return null;

  if (!user) {
    return (
      <div className="max-w-lg mx-auto py-10 px-6 text-center">
        <h2 className="text-2xl font-bold text-lamo-dark mb-4">Sign In Required</h2>
        <p className="text-lamo-gray mb-6">
          Sign in to create a private group. This lets you recover your groups on any device.
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
    <><SEO
        title="Create a Group - LAMO Games"
        description="Create a private group for trivia, riddle guess, and scavenger hunts with friends and family."
        canonical="https://lamotrivia.app/group/new"
      />
    <div className="max-w-lg mx-auto py-10 px-6">
      <h2 className="text-2xl font-bold text-lamo-dark mb-6">Create Private Group</h2>
      <p className="text-sm text-lamo-gray mb-6">
        Create a private space for your family or friends. You'll get a secret code to share with them.
        This group will be tied to your account ({user.email}).
      </p>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-lamo-dark mb-1.5">
            Group Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. The McRae Family"
            maxLength={50}
            className="w-full px-4 py-2.5 border border-lamo-border rounded-xl text-lamo-dark placeholder:text-lamo-gray-muted focus:outline-none focus:ring-2 focus:ring-lamo-blue/40"
            autoFocus
          />
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full px-6 py-3 bg-lamo-blue text-white font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors disabled:opacity-50"
        >
          {submitting ? 'Creating...' : 'Create Group'}
        </button>
      </form>
    </div></>
  );
}
