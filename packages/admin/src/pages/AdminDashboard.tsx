import { useState, useEffect } from 'react';
import { adminApi, type AdminOverview } from '@/lib/admin-api';

export default function AdminDashboard() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi
      .getOverview()
      .then(setOverview)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-slate-400">Loading...</p>;
  if (error) return <p className="text-red-400">Error: {error}</p>;
  if (!overview) return null;

  const cards = [
    { label: 'Total Users', value: overview.totalUsers },
    { label: 'Games Created', value: overview.eventCounts['game_created'] ?? 0 },
    { label: 'Hunts Created', value: overview.eventCounts['hunt_created'] ?? 0 },
    { label: 'Errors (30d)', value: overview.totalErrors },
  ];

  const eventTypes = Object.entries(overview.eventCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div>
      <h2 className="text-white text-2xl font-semibold mb-6">Dashboard</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map((card) => (
          <div
            key={card.label}
            className="bg-slate-900 border border-slate-800 rounded-lg p-5"
          >
            <p className="text-slate-400 text-sm">{card.label}</p>
            <p className="text-white text-3xl font-bold mt-1">{card.value}</p>
          </div>
        ))}
      </div>

      {eventTypes.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
          <h3 className="text-white font-medium mb-3">Event Breakdown</h3>
          <div className="space-y-2">
            {eventTypes.map(([type, count]) => (
              <div key={type} className="flex justify-between text-sm">
                <span className="text-slate-300">{type}</span>
                <span className="text-slate-400">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
