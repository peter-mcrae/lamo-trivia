import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { adminApi } from '@/lib/admin-api';
import type { User, CreditTransaction } from '@lamo-trivia/shared';

export default function AdminUserDetail() {
  const { email } = useParams<{ email: string }>();
  const [user, setUser] = useState<User | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Credit adjustment form
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState('');
  const [adjustSuccess, setAdjustSuccess] = useState('');

  useEffect(() => {
    if (!email) return;
    adminApi
      .getUser(decodeURIComponent(email))
      .then((res) => {
        setUser(res.user);
        setTransactions(res.transactions);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [email]);

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !user) return;

    const numAmount = Number(amount);
    if (!numAmount || !Number.isInteger(numAmount)) {
      setAdjustError('Enter a valid non-zero integer');
      return;
    }
    if (!reason.trim()) {
      setAdjustError('Reason is required');
      return;
    }

    setAdjusting(true);
    setAdjustError('');
    setAdjustSuccess('');

    try {
      const res = await adminApi.adjustCredits(
        decodeURIComponent(email),
        numAmount,
        reason.trim(),
      );
      setUser(res.user);
      setAmount('');
      setReason('');
      setAdjustSuccess(`Credits adjusted. New balance: ${res.newBalance}`);
      // Refresh transactions
      const detail = await adminApi.getUser(decodeURIComponent(email));
      setTransactions(detail.transactions);
    } catch (err) {
      setAdjustError(err instanceof Error ? err.message : 'Failed to adjust credits');
    } finally {
      setAdjusting(false);
    }
  };

  if (loading) return <p className="text-slate-400">Loading...</p>;
  if (error) return <p className="text-red-400">Error: {error}</p>;
  if (!user) return <p className="text-slate-400">User not found</p>;

  return (
    <div>
      <Link
        to="/admin/users"
        className="text-slate-400 text-sm hover:text-white transition-colors mb-4 inline-block"
      >
        &larr; Back to users
      </Link>

      <h2 className="text-white text-2xl font-semibold mb-6">{user.email}</h2>

      {/* User info card */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-slate-400">User ID</p>
            <p className="text-white font-mono text-xs mt-1">{user.userId}</p>
          </div>
          <div>
            <p className="text-slate-400">Credits</p>
            <p className="text-white font-bold text-lg mt-1">{user.credits}</p>
          </div>
          <div>
            <p className="text-slate-400">Created</p>
            <p className="text-white mt-1">{new Date(user.createdAt).toLocaleDateString()}</p>
          </div>
          <div>
            <p className="text-slate-400">Stripe Customer</p>
            <p className="text-white font-mono text-xs mt-1">
              {user.stripeCustomerId || 'N/A'}
            </p>
          </div>
        </div>
      </div>

      {/* Credit adjustment form */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 mb-6">
        <h3 className="text-white font-medium mb-3">Adjust Credits</h3>
        <form onSubmit={handleAdjust} className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-slate-400 text-xs block mb-1">Amount (+/-)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm w-32 focus:outline-none focus:border-slate-500"
              placeholder="e.g. 50 or -10"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-slate-400 text-xs block mb-1">Reason</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm w-full focus:outline-none focus:border-slate-500"
              placeholder="Reason for adjustment"
            />
          </div>
          <button
            type="submit"
            disabled={adjusting}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-500 transition-colors disabled:opacity-50"
          >
            {adjusting ? 'Adjusting...' : 'Apply'}
          </button>
        </form>
        {adjustError && <p className="text-red-400 text-sm mt-2">{adjustError}</p>}
        {adjustSuccess && <p className="text-green-400 text-sm mt-2">{adjustSuccess}</p>}
      </div>

      {/* Transaction history */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <h3 className="text-white font-medium px-5 py-3 border-b border-slate-800">
          Transaction History
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left px-4 py-2 text-slate-400 font-medium">Type</th>
              <th className="text-left px-4 py-2 text-slate-400 font-medium">Amount</th>
              <th className="text-left px-4 py-2 text-slate-400 font-medium">Details</th>
              <th className="text-left px-4 py-2 text-slate-400 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx, i) => (
              <tr key={i} className="border-b border-slate-800/50">
                <td className="px-4 py-2 text-slate-300">{tx.type}</td>
                <td
                  className={`px-4 py-2 font-medium ${
                    tx.amount > 0 ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {tx.amount > 0 ? '+' : ''}{tx.amount}
                </td>
                <td className="px-4 py-2 text-slate-400">{tx.details || '-'}</td>
                <td className="px-4 py-2 text-slate-400">
                  {new Date(tx.timestamp).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {transactions.length === 0 && (
          <p className="text-slate-500 text-center py-6">No transactions</p>
        )}
      </div>
    </div>
  );
}
