import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthContext } from '@/contexts/AuthContext';

export default function Login() {
  const { sendCode, verifyCode } = useAuthContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSending(true);
    try {
      await sendCode(email);
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code');
    } finally {
      setSending(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSending(true);
    try {
      await verifyCode(email, code);
      navigate(searchParams.get('returnTo') || '/credits');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-6 py-16">
      <h1 className="text-2xl font-bold text-lamo-dark mb-2">Sign In</h1>
      <p className="text-lamo-gray-muted mb-8">
        Sign in to purchase credits for scavenger hunts.
      </p>

      {step === 'email' ? (
        <form onSubmit={handleSendCode} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-lamo-dark mb-1">
              Email address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full px-3 py-2 border border-lamo-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-lamo-primary/30 focus:border-lamo-primary"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={sending || !email}
            className="w-full py-2.5 bg-lamo-primary text-white font-medium rounded-lg hover:bg-lamo-primary/90 transition-colors disabled:opacity-50"
          >
            {sending ? 'Sending...' : 'Continue'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyCode} className="space-y-4">
          <p className="text-sm text-lamo-gray">
            We sent a 6-digit code to <strong>{email}</strong>
          </p>
          <div>
            <label htmlFor="code" className="block text-sm font-medium text-lamo-dark mb-1">
              Login code
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              maxLength={6}
              required
              className="w-full px-3 py-2 border border-lamo-border rounded-lg text-sm tracking-[0.3em] text-center font-mono text-lg focus:outline-none focus:ring-2 focus:ring-lamo-primary/30 focus:border-lamo-primary"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={sending || code.length !== 6}
            className="w-full py-2.5 bg-lamo-primary text-white font-medium rounded-lg hover:bg-lamo-primary/90 transition-colors disabled:opacity-50"
          >
            {sending ? 'Verifying...' : 'Continue'}
          </button>
          <button
            type="button"
            onClick={() => { setStep('email'); setCode(''); setError(''); }}
            className="w-full text-sm text-lamo-gray hover:text-lamo-dark transition-colors"
          >
            Use a different email
          </button>
        </form>
      )}
    </div>
  );
}
