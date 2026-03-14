import { useState, useEffect } from 'react';
import { adminApi } from '@/lib/admin-api';

interface ErrorMeta {
  route?: string;
  method?: string;
  ts?: number;
  msg?: string;
}

export default function AdminErrors() {
  const [errors, setErrors] = useState<Array<{ key: string; metadata: unknown }>>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [complete, setComplete] = useState(true);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const fetchErrors = (appendCursor?: string) => {
    setLoading(true);
    setFetchError('');
    adminApi
      .getErrors({ cursor: appendCursor })
      .then((res) => {
        if (appendCursor) {
          setErrors((prev) => [...prev, ...res.errors]);
        } else {
          setErrors(res.errors);
        }
        setCursor(res.cursor);
        setComplete(res.complete);
      })
      .catch((err) => setFetchError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchErrors();
  }, []);

  return (
    <div>
      <h2 className="text-white text-2xl font-semibold mb-6">Errors</h2>

      {fetchError && <p className="text-red-400 mb-4">{fetchError}</p>}

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Timestamp</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Route</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Method</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Message</th>
            </tr>
          </thead>
          <tbody>
            {errors.map((err) => {
              const meta = (err.metadata || {}) as ErrorMeta;
              const isExpanded = expandedKey === err.key;
              return (
                <>
                  <tr
                    key={err.key}
                    onClick={() => setExpandedKey(isExpanded ? null : err.key)}
                    className="border-b border-slate-800/50 hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-2 text-slate-400">
                      {meta.ts ? new Date(meta.ts).toLocaleString() : '-'}
                    </td>
                    <td className="px-4 py-2 text-slate-300">{meta.route || '-'}</td>
                    <td className="px-4 py-2 text-slate-400">{meta.method || '-'}</td>
                    <td className="px-4 py-2 text-red-400 truncate max-w-md">{meta.msg || '-'}</td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${err.key}-expanded`} className="border-b border-slate-800/50">
                      <td colSpan={4} className="px-4 py-3 bg-slate-800/30">
                        <pre className="text-xs text-slate-400 whitespace-pre-wrap font-mono overflow-auto">
                          {JSON.stringify(meta, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
        {errors.length === 0 && !loading && (
          <p className="text-slate-500 text-center py-8">No errors recorded</p>
        )}
      </div>

      {loading && <p className="text-slate-400 mt-4">Loading...</p>}

      {!complete && cursor && !loading && (
        <button
          onClick={() => fetchErrors(cursor)}
          className="mt-4 px-4 py-2 bg-slate-800 text-white text-sm rounded-lg hover:bg-slate-700 transition-colors"
        >
          Load More
        </button>
      )}
    </div>
  );
}
