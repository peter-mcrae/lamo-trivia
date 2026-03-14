import { useState, useEffect } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { CREDIT_PRICING } from '@lamo-trivia/shared';
import type { CreditTransaction } from '@lamo-trivia/shared';
import { API_BASE, getAuthHeaders, api } from '@/lib/api';

export default function Credits() {
  const { user, loading, logout, refreshUser } = useAuthContext();
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Coupon state
  const [couponCode, setCouponCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [couponSuccess, setCouponSuccess] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    fetch(`${API_BASE}/credits/transactions`, {
      headers: getAuthHeaders(),
    })
      .then((r) => r.json())
      .then((d: { transactions: CreditTransaction[] }) => setTransactions(d.transactions))
      .catch((err) => console.error('Failed to load transactions', err));
  }, [user]);

  const handleBuy = async () => {
    setBuying(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error('Checkout failed', { status: res.status, body });
        throw new Error('Checkout failed');
      }
      const data = (await res.json()) as { url: string };
      if (!data.url) {
        throw new Error('No checkout URL returned');
      }
      window.location.href = data.url;
    } catch (err) {
      console.error('Buy credits error', err);
      setError('Failed to start checkout. Please try again.');
      setBuying(false);
    }
  };

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!couponCode.trim()) return;

    setRedeeming(true);
    setCouponError(null);
    setCouponSuccess(null);

    try {
      const result = await api.redeemCoupon(couponCode.trim());
      setCouponSuccess(`Redeemed! +${result.credits} credits. New balance: ${result.newBalance}`);
      setCouponCode('');
      // Refresh user data and transactions
      refreshUser?.();
      fetch(`${API_BASE}/credits/transactions`, { headers: getAuthHeaders() })
        .then((r) => r.json())
        .then((d: { transactions: CreditTransaction[] }) => setTransactions(d.transactions))
        .catch(() => {});
    } catch (err) {
      setCouponError(err instanceof Error ? err.message : 'Failed to redeem coupon');
    } finally {
      setRedeeming(false);
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

      {error && (
        <div className="mb-6 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
          {error}
        </div>
      )}

      {/* Buy */}
      <div className="bg-lamo-bg rounded-xl border border-lamo-border p-6 mb-6">
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

      {/* Redeem Coupon */}
      <div className="bg-lamo-bg rounded-xl border border-lamo-border p-6 mb-8">
        <h2 className="font-medium text-lamo-dark mb-3">Have a coupon?</h2>
        <form onSubmit={handleRedeem} className="flex gap-2">
          <input
            type="text"
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
            placeholder="Enter coupon code"
            className="flex-1 px-4 py-2.5 border border-lamo-border rounded-lg text-sm focus:outline-none focus:border-lamo-primary"
            maxLength={20}
          />
          <button
            type="submit"
            disabled={redeeming || !couponCode.trim()}
            className="px-5 py-2.5 bg-lamo-dark text-white font-medium text-sm rounded-lg hover:bg-lamo-dark/90 transition-colors disabled:opacity-50"
          >
            {redeeming ? 'Redeeming...' : 'Redeem'}
          </button>
        </form>
        {couponError && (
          <p className="text-red-500 text-sm mt-2">{couponError}</p>
        )}
        {couponSuccess && (
          <p className="text-green-600 text-sm mt-2">{couponSuccess}</p>
        )}
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
                    tx.type === 'purchase' || tx.type === 'refund' || tx.type === 'coupon' || tx.type === 'admin_credit'
                      ? 'text-green-600'
                      : 'text-red-500'
                  }`}
                >
                  {tx.type === 'deduction' || tx.type === 'admin_debit' ? '-' : '+'}
                  {Math.abs(tx.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
