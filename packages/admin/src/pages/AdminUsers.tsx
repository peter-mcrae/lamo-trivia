import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '@/lib/admin-api';
import type { UserWithActivity } from '@/lib/admin-api';

function activityLabel(user: UserWithActivity): { text: string; color: string } {
  const ageDays = (Date.now() - user.createdAt) / (1000 * 60 * 60 * 24);
  const txCount = user.transactionCount;

  if (ageDays < 7 && txCount <= 1) return { text: 'New', color: 'text-blue-400' };
  if (txCount >= 10) return { text: 'Active', color: 'text-green-400' };
  if (txCount >= 3) return { text: 'Moderate', color: 'text-yellow-400' };
  return { text: 'Low', color: 'text-slate-500' };
}

export default function AdminUsers() {
  const [users, setUsers] = useState<UserWithActivity[]>([]);
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [complete, setComplete] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Inline give-credits state
  const [creditEmail, setCreditEmail] = useState<string | null>(null);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const [creditLoading, setCreditLoading] = useState(false);
  const [creditMsg, setCreditMsg] = useState('');

  // Invite user state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteMsg, setInviteMsg] = useState('');

  const fetchUsers = (searchTerm: string, appendCursor?: string) => {
    setLoading(true);
    setError('');
    adminApi
      .listUsers({ search: searchTerm, cursor: appendCursor })
      .then((res) => {
        if (appendCursor) {
          setUsers((prev) => [...prev, ...res.users]);
        } else {
          setUsers(res.users);
        }
        setCursor(res.cursor);
        setComplete(res.complete);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchUsers('');
  }, []);

  const handleSearch = (value: string) => {
    setSearch(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchUsers(value);
    }, 300);
  };

  const handleGiveCredits = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditEmail) return;
    const amount = parseInt(creditAmount, 10);
    if (!amount || !creditReason.trim()) return;

    setCreditLoading(true);
    setCreditMsg('');
    try {
      const res = await adminApi.adjustCredits(creditEmail, amount, creditReason.trim());
      setCreditMsg(`Done! New balance: ${res.newBalance}`);
      setCreditAmount('');
      setCreditReason('');
      // Update the user in the list
      setUsers((prev) =>
        prev.map((u) =>
          u.email === creditEmail ? { ...u, credits: res.newBalance } : u,
        ),
      );
      setTimeout(() => {
        setCreditEmail(null);
        setCreditMsg('');
      }, 1500);
    } catch (err) {
      setCreditMsg(err instanceof Error ? err.message : 'Failed');
    } finally {
      setCreditLoading(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteLoading(true);
    setInviteMsg('');
    try {
      const res = await adminApi.inviteUser(inviteEmail.trim());
      setInviteMsg(`Invite sent to ${res.email} (${res.credits} credits)`);
      setInviteEmail('');
    } catch (err) {
      setInviteMsg(err instanceof Error ? err.message : 'Failed to invite');
    } finally {
      setInviteLoading(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-white text-2xl font-semibold">Users</h2>
      </div>

      {/* Invite User */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
        <h3 className="text-white text-sm font-medium mb-3">Invite New User</h3>
        <form onSubmit={handleInvite} className="flex items-center gap-3">
          <input
            type="email"
            placeholder="Email address..."
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="flex-1 max-w-sm bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-slate-500"
            required
          />
          <button
            type="submit"
            disabled={inviteLoading}
            className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-500 transition-colors disabled:opacity-50"
          >
            {inviteLoading ? 'Sending...' : 'Send Invite (1,000 credits)'}
          </button>
        </form>
        {inviteMsg && (
          <p className={`text-sm mt-2 ${inviteMsg.startsWith('Invite sent') ? 'text-green-400' : 'text-red-400'}`}>
            {inviteMsg}
          </p>
        )}
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search by email..."
        value={search}
        onChange={(e) => handleSearch(e.target.value)}
        className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white text-sm placeholder-slate-500 mb-6 focus:outline-none focus:border-slate-500"
      />

      {error && <p className="text-red-400 mb-4">{error}</p>}

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Email</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Credits</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Activity</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Created</th>
              <th className="text-right px-4 py-3 text-slate-400 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const activity = activityLabel(user);
              return (
                <tr
                  key={user.email}
                  className="border-b border-slate-800/50 hover:bg-slate-800/50 transition-colors"
                >
                  <td
                    className="px-4 py-3 text-white cursor-pointer hover:underline"
                    onClick={() => navigate(`/users/${encodeURIComponent(user.email)}`)}
                  >
                    {user.email}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{user.credits}</td>
                  <td className={`px-4 py-3 ${activity.color}`}>{activity.text}</td>
                  <td className="px-4 py-3 text-slate-400">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setCreditEmail(creditEmail === user.email ? null : user.email);
                        setCreditAmount('');
                        setCreditReason('');
                        setCreditMsg('');
                      }}
                      className="px-3 py-1 bg-slate-800 text-slate-300 text-xs rounded hover:bg-slate-700 transition-colors"
                    >
                      {creditEmail === user.email ? 'Cancel' : 'Give Credits'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Inline credit form */}
        {creditEmail && (
          <div className="border-t border-slate-800 px-4 py-3 bg-slate-800/30">
            <form onSubmit={handleGiveCredits} className="flex items-center gap-3 flex-wrap">
              <span className="text-slate-400 text-sm">
                Give credits to <span className="text-white">{creditEmail}</span>:
              </span>
              <input
                type="number"
                placeholder="Amount"
                value={creditAmount}
                onChange={(e) => setCreditAmount(e.target.value)}
                className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-slate-500"
                required
              />
              <input
                type="text"
                placeholder="Reason"
                value={creditReason}
                onChange={(e) => setCreditReason(e.target.value)}
                className="flex-1 min-w-[150px] bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-slate-500"
                required
              />
              <button
                type="submit"
                disabled={creditLoading}
                className="px-3 py-1 bg-green-700 text-white text-xs rounded hover:bg-green-600 transition-colors disabled:opacity-50"
              >
                {creditLoading ? 'Saving...' : 'Confirm'}
              </button>
              {creditMsg && (
                <span className={`text-xs ${creditMsg.startsWith('Done') ? 'text-green-400' : 'text-red-400'}`}>
                  {creditMsg}
                </span>
              )}
            </form>
          </div>
        )}

        {users.length === 0 && !loading && (
          <p className="text-slate-500 text-center py-8">No users found</p>
        )}
      </div>

      {loading && <p className="text-slate-400 mt-4">Loading...</p>}

      {!complete && cursor && !loading && (
        <button
          onClick={() => fetchUsers(search, cursor)}
          className="mt-4 px-4 py-2 bg-slate-800 text-white text-sm rounded-lg hover:bg-slate-700 transition-colors"
        >
          Load More
        </button>
      )}
    </div>
  );
}
