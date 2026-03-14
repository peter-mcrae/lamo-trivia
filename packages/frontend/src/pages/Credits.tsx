import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '@/contexts/AuthContext';
import { CREDIT_PRICING } from '@lamo-trivia/shared';
import type { CreditTransaction } from '@lamo-trivia/shared';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export default function Credits() {
  const { user, loading, logout } = useAuthContext();
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [buying, setBuying] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      navigate('/login');
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('lamo_auth_token');
    fetch(`${API_BASE}/credits/transactions`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d: { transactions: CreditTransaction[] }) => setTransactions(d.transactions))
      .catch((err) => console.error('Failed to load transactions', err));
  }, [user]);

  const handleBuy = async () => {
    setBuying(true);
    try {
      const token = localStorage.getItem('lamo_auth_token');
      const res = await fetch(`${API_BASE}/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error('Checkout failed', { status: res.status, body });
        throw new Error('Checkout failed');
      }
      const data = (await res.json()) as { url: string };
      if (!data.url) {
        console.error('No checkout URL in response', data);
        throw new Error('No checkout URL returned');
      }
      window.location.href = data.url;
    } catch (err) {
      console.error('Buy credits error', err);
      setBuying(false);
    }
  };

  if (loading || !user) return null;

  return (
    <div className="max-w-lg mx-auto px-6 py-16">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-lamo-dark">Credits</h1>
          <p className="text-sm text-lamo-gray-muted">{user.email}</p>
        </div>
        <button
          onClick={logout}
          className="text-sm text-lamo-gray hover:text-lamo-dark transition-colors"
        >
          Sign out
        </button>
      </div>

      {/* Balance */}
      <div className="bg-lamo-bg rounded-xl border border-lamo-border p-6 mb-6">
        <p className="text-sm text-lamo-gray mb-1">Current Balance</p>
        <p className="text-4xl font-bold text-lamo-dark">{user.credits}</p>
        <p className="text-sm text-lamo-gray mt-1">credits</p>
      </div>

      {/* Buy */}
      <div className="bg-lamo-bg rounded-xl border border-lamo-border p-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="font-medium text-lamo-dark">
              {CREDIT_PRICING.creditsPerPurchase} Credits
            </p>
            <p className="text-sm text-lamo-gray">
              ${(CREDIT_PRICING.priceInCents / 100).toFixed(2)} USD
            </p>
          </div>
          <button
            onClick={handleBuy}
            disabled={buying}
            className="px-6 py-2.5 bg-lamo-primary text-white font-medium rounded-lg hover:bg-lamo-primary/90 transition-colors disabled:opacity-50"
          >
            {buying ? 'Redirecting...' : 'Buy Credits'}
          </button>
        </div>
        <p className="text-xs text-lamo-gray">
          1 credit = 1 AI photo verification attempt during scavenger hunts.
          Credits are deducted when a hunt starts based on items, retries, and player count.
        </p>
      </div>

      {/* Transactions */}
      {transactions.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-lamo-dark mb-4">Transaction History</h2>
          <div className="space-y-3">
            {transactions.map((tx, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-3 border-b border-lamo-border last:border-0"
              >
                <div>
                  <p className="text-sm font-medium text-lamo-dark">{tx.details}</p>
                  <p className="text-xs text-lamo-gray">
                    {new Date(tx.timestamp).toLocaleDateString()}
                  </p>
                </div>
                <span
                  className={`text-sm font-medium ${
                    tx.type === 'purchase' || tx.type === 'refund'
                      ? 'text-green-600'
                      : 'text-red-500'
                  }`}
                >
                  {tx.type === 'deduction' ? '-' : '+'}
                  {tx.amount}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
