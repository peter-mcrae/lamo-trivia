import { useState, useEffect } from 'react';
import { NavLink, Outlet, Link, Navigate } from 'react-router-dom';
import { adminApi } from '@/lib/admin-api';

const navItems = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/users', label: 'Users', end: false },
  { to: '/admin/analytics', label: 'Analytics', end: false },
  { to: '/admin/errors', label: 'Errors', end: false },
];

export function AdminLayout() {
  const [authState, setAuthState] = useState<'loading' | 'authorized' | 'denied'>('loading');

  useEffect(() => {
    adminApi
      .checkAccess()
      .then((ok) => setAuthState(ok ? 'authorized' : 'denied'));
  }, []);

  if (authState === 'loading') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-slate-400">Verifying admin access...</p>
      </div>
    );
  }

  if (authState === 'denied') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex min-h-screen bg-slate-950">
      {/* Sidebar */}
      <aside className="w-56 bg-slate-900 border-r border-slate-800 flex flex-col">
        <div className="px-5 py-4 border-b border-slate-800">
          <h1 className="text-white font-semibold text-lg">Admin Panel</h1>
          <p className="text-slate-400 text-xs mt-0.5">LAMO Trivia</p>
        </div>
        <nav className="flex-1 py-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `block px-5 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'text-white bg-slate-800'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-slate-800">
          <Link
            to="/"
            className="text-slate-400 text-sm hover:text-white transition-colors"
          >
            &larr; Back to site
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
