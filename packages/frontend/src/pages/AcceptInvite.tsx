import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { API_BASE, AUTH_TOKEN_KEY } from '@/lib/api';
import { useAuthContext } from '@/contexts/AuthContext';

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { refreshUser } = useAuthContext();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Accepting your invite...');
  const [credits, setCredits] = useState(0);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Invalid invite link.');
      return;
    }

    async function acceptInvite() {
      try {
        const res = await fetch(`${API_BASE}/auth/accept-invite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: 'Something went wrong' }));
          throw new Error((body as { error: string }).error || `Error ${res.status}`);
        }

        const data = await res.json() as { token: string; user: { credits: number }; isNewUser: boolean };

        // Store the session token to log them in
        localStorage.setItem(AUTH_TOKEN_KEY, data.token);
        setCredits(data.user.credits);
        setStatus('success');
        setMessage(
          data.isNewUser
            ? 'Welcome to LAMO Trivia! Your account has been created.'
            : 'Your credits have been added!',
        );

        // Refresh the auth context so the app knows they're logged in
        await refreshUser();
      } catch (err) {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Failed to accept invite');
      }
    }

    acceptInvite();
  }, [token, refreshUser]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="max-w-md w-full text-center">
        {status === 'loading' && (
          <div>
            <div className="text-4xl mb-4 animate-pulse">...</div>
            <p className="text-gray-400">{message}</p>
          </div>
        )}

        {status === 'success' && (
          <div>
            <div className="text-4xl mb-4">🎉</div>
            <h1 className="text-2xl font-bold text-white mb-2">{message}</h1>
            <p className="text-gray-400 mb-6">
              You have <span className="text-indigo-400 font-bold">{credits}</span> credits ready to use.
            </p>
            <button
              onClick={() => navigate('/')}
              className="px-6 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-500 transition-colors"
            >
              Start Playing
            </button>
          </div>
        )}

        {status === 'error' && (
          <div>
            <div className="text-4xl mb-4">😔</div>
            <h1 className="text-2xl font-bold text-white mb-2">Invite Error</h1>
            <p className="text-red-400 mb-6">{message}</p>
            <button
              onClick={() => navigate('/')}
              className="px-6 py-3 bg-slate-700 text-white font-medium rounded-lg hover:bg-slate-600 transition-colors"
            >
              Go to Home
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
