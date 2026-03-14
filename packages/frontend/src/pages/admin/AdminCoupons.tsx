import { useState, useEffect } from 'react';
import { adminApi } from '@/lib/admin-api';
import type { Coupon } from '@lamo-trivia/shared';

export default function AdminCoupons() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createCredits, setCreateCredits] = useState('10');
  const [createMaxUses, setCreateMaxUses] = useState('1');
  const [createExpDays, setCreateExpDays] = useState('30');
  const [createNote, setCreateNote] = useState('');
  const [createCustomCode, setCreateCustomCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Send email form
  const [sendingCode, setSendingCode] = useState<string | null>(null);
  const [sendTo, setSendTo] = useState('');
  const [sendName, setSendName] = useState('');
  const [sendMessage, setSendMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState('');

  const fetchCoupons = () => {
    setLoading(true);
    adminApi
      .listCoupons()
      .then((res) => setCoupons(res.coupons))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchCoupons();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      await adminApi.createCoupon({
        credits: Number(createCredits),
        maxUses: Number(createMaxUses) || 1,
        expiresInDays: Number(createExpDays) || undefined,
        note: createNote.trim(),
        code: createCustomCode.trim() || undefined,
      });
      setShowCreate(false);
      setCreateCredits('10');
      setCreateMaxUses('1');
      setCreateExpDays('30');
      setCreateNote('');
      setCreateCustomCode('');
      fetchCoupons();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setCreating(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sendingCode || !sendTo.trim()) return;
    setSending(true);
    setSendResult('');
    try {
      const result = await adminApi.sendCoupon(sendingCode, {
        to: sendTo.trim(),
        senderName: sendName.trim() || undefined,
        message: sendMessage.trim() || undefined,
      });
      setSendResult(`Sent to ${result.sentTo}`);
      setSendTo('');
      setSendMessage('');
    } catch (err) {
      setSendResult(`Error: ${err instanceof Error ? err.message : 'Failed'}`);
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (code: string) => {
    if (!confirm(`Delete coupon ${code}?`)) return;
    try {
      await adminApi.deleteCoupon(code);
      fetchCoupons();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-white text-2xl font-semibold">Coupons</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 transition-colors"
        >
          {showCreate ? 'Cancel' : 'Create Coupon'}
        </button>
      </div>

      {error && <p className="text-red-400 mb-4">{error}</p>}

      {/* Create form */}
      {showCreate && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 mb-6">
          <h3 className="text-white font-medium mb-3">New Coupon</h3>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-slate-400 text-xs block mb-1">Credits</label>
                <input
                  type="number"
                  value={createCredits}
                  onChange={(e) => setCreateCredits(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-slate-500"
                  min="1"
                  max="10000"
                  required
                />
              </div>
              <div>
                <label className="text-slate-400 text-xs block mb-1">Max Uses</label>
                <input
                  type="number"
                  value={createMaxUses}
                  onChange={(e) => setCreateMaxUses(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-slate-500"
                  min="1"
                  max="10000"
                />
              </div>
              <div>
                <label className="text-slate-400 text-xs block mb-1">Expires (days)</label>
                <input
                  type="number"
                  value={createExpDays}
                  onChange={(e) => setCreateExpDays(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-slate-500"
                  min="0"
                  placeholder="0 = never"
                />
              </div>
              <div>
                <label className="text-slate-400 text-xs block mb-1">Custom Code</label>
                <input
                  type="text"
                  value={createCustomCode}
                  onChange={(e) => setCreateCustomCode(e.target.value.toUpperCase())}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-slate-500"
                  placeholder="Auto-generated"
                  maxLength={20}
                />
              </div>
            </div>
            <div>
              <label className="text-slate-400 text-xs block mb-1">Note (shown to recipient)</label>
              <input
                type="text"
                value={createNote}
                onChange={(e) => setCreateNote(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-slate-500"
                placeholder="e.g. Welcome bonus for friends!"
                maxLength={500}
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={creating}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-500 transition-colors disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
              {createError && <p className="text-red-400 text-sm">{createError}</p>}
            </div>
          </form>
        </div>
      )}

      {/* Coupon list */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Code</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Credits</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Usage</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Expires</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Note</th>
              <th className="text-right px-4 py-3 text-slate-400 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {coupons.map((c) => (
              <>
                <tr key={c.code} className="border-b border-slate-800/50">
                  <td className="px-4 py-3 text-white font-mono font-bold">{c.code}</td>
                  <td className="px-4 py-3 text-green-400">+{c.credits}</td>
                  <td className="px-4 py-3 text-slate-300">
                    {c.usedCount}/{c.maxUses}
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-4 py-3 text-slate-400 truncate max-w-[200px]">
                    {c.note || '-'}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button
                      onClick={() => setSendingCode(sendingCode === c.code ? null : c.code)}
                      className="text-blue-400 hover:text-blue-300 text-xs"
                    >
                      Email
                    </button>
                    <button
                      onClick={() => handleDelete(c.code)}
                      className="text-red-400 hover:text-red-300 text-xs"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
                {/* Inline send email form */}
                {sendingCode === c.code && (
                  <tr key={`${c.code}-send`} className="border-b border-slate-800/50">
                    <td colSpan={6} className="px-4 py-3 bg-slate-800/30">
                      <form onSubmit={handleSend} className="flex flex-wrap gap-2 items-end">
                        <div className="flex-1 min-w-[200px]">
                          <label className="text-slate-400 text-xs block mb-1">Recipient email</label>
                          <input
                            type="email"
                            value={sendTo}
                            onChange={(e) => setSendTo(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-white text-sm focus:outline-none"
                            required
                          />
                        </div>
                        <div className="w-32">
                          <label className="text-slate-400 text-xs block mb-1">Your name</label>
                          <input
                            type="text"
                            value={sendName}
                            onChange={(e) => setSendName(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-white text-sm focus:outline-none"
                            placeholder="Optional"
                          />
                        </div>
                        <div className="flex-1 min-w-[200px]">
                          <label className="text-slate-400 text-xs block mb-1">Personal message</label>
                          <input
                            type="text"
                            value={sendMessage}
                            onChange={(e) => setSendMessage(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-white text-sm focus:outline-none"
                            placeholder="Optional"
                            maxLength={500}
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={sending}
                          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-500 disabled:opacity-50"
                        >
                          {sending ? 'Sending...' : 'Send'}
                        </button>
                      </form>
                      {sendResult && (
                        <p className={`text-sm mt-2 ${sendResult.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
                          {sendResult}
                        </p>
                      )}
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
        {coupons.length === 0 && !loading && (
          <p className="text-slate-500 text-center py-8">No coupons yet</p>
        )}
      </div>

      {loading && <p className="text-slate-400 mt-4">Loading...</p>}
    </div>
  );
}
