import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useGroups } from '@/hooks/useGroups';

export default function JoinGroup() {
  const navigate = useNavigate();
  const { addGroup } = useGroups();
  const [code, setCode] = useState('');
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = code.trim().toLowerCase().replace(/\s+/g, '-');
    if (!cleaned) {
      setError('Enter a group code');
      return;
    }

    setValidating(true);
    setError('');
    try {
      const result = await api.getGroup(cleaned);
      addGroup(cleaned, result.name);
      navigate(`/group/${cleaned}`);
    } catch {
      setError('Group not found. Check the code and try again.');
      setValidating(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto py-10 px-6">
      <h2 className="text-2xl font-bold text-lamo-dark mb-6">Join Private Group</h2>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-lamo-dark mb-1.5">
            Group Code
          </label>
          <input
            type="text"
            value={code}
            onChange={(e) => { setCode(e.target.value); setError(''); }}
            placeholder="e.g. brave-mountain-golden-river"
            className="w-full px-4 py-2.5 border border-lamo-border rounded-xl text-lamo-dark font-mono placeholder:text-lamo-gray-muted placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-lamo-blue/40"
            autoFocus
          />
          <p className="text-xs text-lamo-gray-muted mt-1.5">
            Enter the 4-word code shared with you
          </p>
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={validating}
          className="w-full px-6 py-3 bg-lamo-blue text-white font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors disabled:opacity-50"
        >
          {validating ? 'Checking...' : 'Join Group'}
        </button>
      </form>

      <div className="mt-8 pt-6 border-t border-lamo-border text-center">
        <p className="text-sm text-lamo-gray-muted mb-3">Don't have a code?</p>
        <Link
          to="/group/new"
          className="text-sm text-lamo-blue font-medium hover:underline"
        >
          Create a new group
        </Link>
      </div>
    </div>
  );
}
