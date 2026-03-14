import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '@/lib/admin-api';
import type { User } from '@lamo-trivia/shared';

export default function AdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [complete, setComplete] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

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

  return (
    <div>
      <h2 className="text-white text-2xl font-semibold mb-6">Users</h2>

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
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr
                key={user.email}
                onClick={() => navigate(`/admin/users/${encodeURIComponent(user.email)}`)}
                className="border-b border-slate-800/50 hover:bg-slate-800/50 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3 text-white">{user.email}</td>
                <td className="px-4 py-3 text-slate-300">{user.credits}</td>
                <td className="px-4 py-3 text-slate-400">
                  {new Date(user.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

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
