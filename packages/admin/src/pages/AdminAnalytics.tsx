import { useState, useEffect } from 'react';
import { adminApi, type AdminOverview } from '@/lib/admin-api';

const EVENT_TYPES = [
  '',
  'game_created',
  'game_started',
  'game_finished',
  'hunt_created',
  'hunt_started',
  'hunt_finished',
  'photo_verified',
  'vision_comparison',
];

export default function AdminAnalytics() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [events, setEvents] = useState<Array<{ key: string; metadata: unknown }>>([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [complete, setComplete] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi
      .getOverview()
      .then(setOverview)
      .catch(() => {});
  }, []);

  const fetchEvents = (type: string, date: string, appendCursor?: string) => {
    setLoading(true);
    setError('');
    adminApi
      .getEvents({
        type: type || undefined,
        date: date || undefined,
        cursor: appendCursor,
      })
      .then((res) => {
        if (appendCursor) {
          setEvents((prev) => [...prev, ...res.events]);
        } else {
          setEvents(res.events);
        }
        setCursor(res.cursor);
        setComplete(res.complete);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchEvents(typeFilter, dateFilter);
  }, [typeFilter, dateFilter]);

  return (
    <div>
      <h2 className="text-white text-2xl font-semibold mb-6">Analytics</h2>

      {/* Summary cards */}
      {overview && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {Object.entries(overview.eventCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([type, count]) => (
              <div
                key={type}
                className="bg-slate-900 border border-slate-800 rounded-lg p-4"
              >
                <p className="text-slate-400 text-xs">{type}</p>
                <p className="text-white text-xl font-bold">{count}</p>
              </div>
            ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-slate-500"
        >
          <option value="">All event types</option>
          {EVENT_TYPES.filter(Boolean).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-slate-500"
        />
      </div>

      {error && <p className="text-red-400 mb-4">{error}</p>}

      {/* Events list */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Type</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Timestamp</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Metadata</th>
            </tr>
          </thead>
          <tbody>
            {events.map((evt) => {
              const meta = evt.metadata as Record<string, unknown> | null;
              return (
                <tr key={evt.key} className="border-b border-slate-800/50">
                  <td className="px-4 py-2 text-slate-300">{meta?.type as string || '-'}</td>
                  <td className="px-4 py-2 text-slate-400">
                    {meta?.ts ? new Date(meta.ts as number).toLocaleString() : '-'}
                  </td>
                  <td className="px-4 py-2 text-slate-500 font-mono text-xs">
                    {JSON.stringify(meta, null, 0)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {events.length === 0 && !loading && (
          <p className="text-slate-500 text-center py-8">No events found</p>
        )}
      </div>

      {loading && <p className="text-slate-400 mt-4">Loading...</p>}

      {!complete && cursor && !loading && (
        <button
          onClick={() => fetchEvents(typeFilter, dateFilter, cursor)}
          className="mt-4 px-4 py-2 bg-slate-800 text-white text-sm rounded-lg hover:bg-slate-700 transition-colors"
        >
          Load More
        </button>
      )}
    </div>
  );
}
