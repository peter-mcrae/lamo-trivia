import { useState, useEffect, useRef } from 'react';

interface UsernameModalProps {
  onSubmit: (username: string) => void;
  onClose?: () => void;
}

export function UsernameModal({ onSubmit, onClose }: UsernameModalProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Focus trap
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="username-modal-title"
      ref={dialogRef}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl p-8 w-full max-w-sm shadow-xl"
      >
        <h3 id="username-modal-title" className="text-xl font-bold text-lamo-dark mb-2">Pick a username</h3>
        <p className="text-sm text-lamo-gray-muted mb-5">No account needed. Just a name.</p>
        <label htmlFor="username-input" className="sr-only">Username</label>
        <input
          id="username-input"
          ref={inputRef}
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
        {error && <p className="text-red-500 text-sm mt-1" role="alert">{error}</p>}
        <button
          type="submit"
          className="w-full mt-4 px-6 py-2.5 bg-lamo-blue text-white font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors"
        >
          Let's Go
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="w-full mt-2 text-sm text-lamo-gray hover:text-lamo-dark transition-colors"
          >
            Go back
          </button>
        )}
      </form>
    </div>
  );
}
