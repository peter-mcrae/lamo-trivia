import { useState } from 'react';

interface UsernameModalProps {
  onSubmit: (username: string) => void;
}

export function UsernameModal({ onSubmit }: UsernameModalProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setError('Username must be at least 2 characters');
      return;
    }
    if (trimmed.length > 20) {
      setError('Username must be at most 20 characters');
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      setError('Only letters, numbers, hyphens, and underscores');
      return;
    }
    onSubmit(trimmed);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl p-8 w-full max-w-sm shadow-xl"
      >
        <h3 className="text-xl font-bold text-lamo-dark mb-2">Pick a username</h3>
        <p className="text-sm text-lamo-gray-muted mb-5">No account needed. Just a name.</p>
        <input
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError('');
          }}
          placeholder="YourName123"
          className="w-full px-4 py-2.5 border border-lamo-border rounded-xl text-lamo-dark placeholder:text-lamo-gray-muted focus:outline-none focus:ring-2 focus:ring-lamo-blue/40 mb-1"
          autoFocus
        />
        {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
        <button
          type="submit"
          className="w-full mt-4 px-6 py-2.5 bg-lamo-blue text-white font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors"
        >
          Let's Go
        </button>
      </form>
    </div>
  );
}
