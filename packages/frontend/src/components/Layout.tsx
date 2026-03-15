import { useState, useEffect, useRef } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthContext } from '@/contexts/AuthContext';

export function Layout() {
  const { user } = useAuthContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const location = useLocation();
  const navigate = useNavigate();
  const createRef = useRef<HTMLDivElement>(null);

  // Close menus on route change
  useEffect(() => {
    setMenuOpen(false);
    setCreateOpen(false);
  }, [location.pathname]);

  // Close create dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (createRef.current && !createRef.current.contains(e.target as Node)) {
        setCreateOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const createItems = [
    { to: '/create', label: 'Trivia', icon: '🧠' },
    { to: '/riddle-wordle', label: 'Riddle Wordle', icon: '🧩' },
    { to: '/hunt/create', label: 'Scavenger Hunt', icon: '🔍' },
  ];

  const handleJoinCode = (e: React.FormEvent) => {
    e.preventDefault();
    const code = joinCode.trim();
    if (!code) return;
    navigate(`/game/${code}`);
    setJoinCode('');
    setMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-white">
      <nav className="flex items-center justify-between px-6 h-[52px] bg-lamo-bg-hero/[0.92] backdrop-blur-xl border-b border-lamo-border sticky top-0 z-50">
        <Link
          to="/"
          className="flex items-center gap-2.5 text-lamo-dark font-semibold text-[17px] no-underline shrink-0"
        >
          LAMO Trivia
        </Link>

        {/* Desktop: center join input */}
        <form onSubmit={handleJoinCode} className="hidden md:flex items-center gap-1.5 mx-4">
          <input
            type="text"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="Game code"
            maxLength={30}
            className="w-28 px-3 py-1.5 text-sm border border-lamo-border rounded-lg bg-white placeholder:text-lamo-gray-muted focus:outline-none focus:ring-2 focus:ring-lamo-blue/40"
          />
          <button
            type="submit"
            disabled={!joinCode.trim()}
            className="px-3 py-1.5 text-sm bg-lamo-blue text-white font-medium rounded-lg hover:bg-lamo-blue-dark transition-colors disabled:opacity-40"
          >
            Join
          </button>
        </form>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-7 shrink-0">
          {/* Create Game dropdown */}
          <div ref={createRef} className="relative">
            <button
              onClick={() => setCreateOpen(!createOpen)}
              className="text-lamo-gray text-sm font-medium hover:text-lamo-dark transition-colors flex items-center gap-1"
            >
              Create Game
              <svg className={`w-3.5 h-3.5 transition-transform ${createOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {createOpen && (
              <div className="absolute top-full right-0 mt-2 w-48 bg-white rounded-xl border border-lamo-border shadow-lg py-1 z-50">
                {createItems.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-lamo-gray hover:bg-lamo-bg hover:text-lamo-dark transition-colors"
                  >
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <Link
            to="/groups"
            className="text-lamo-gray text-sm font-medium hover:text-lamo-dark transition-colors"
          >
            My Groups
          </Link>

          {/* Account / Sign In */}
          {user ? (
            <Link
              to="/credits"
              className="flex flex-col items-end leading-tight hover:opacity-80 transition-opacity"
            >
              <span className="text-sm font-medium text-lamo-dark">My Account</span>
              <span className="text-[11px] text-lamo-gray-muted">{user.credits} credits</span>
            </Link>
          ) : (
            <Link
              to="/login"
              className="text-lamo-gray text-sm font-medium hover:text-lamo-dark transition-colors"
            >
              Sign In
            </Link>
          )}
        </div>

        {/* Mobile hamburger button */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="md:hidden text-lamo-dark p-1"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        >
          {menuOpen ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </nav>

      {/* Mobile menu panel */}
      {menuOpen && (
        <div className="md:hidden bg-white/95 backdrop-blur-xl border-b border-lamo-border px-6 py-4 space-y-3 sticky top-[52px] z-40">
          {/* Mobile join input */}
          <form onSubmit={handleJoinCode} className="flex gap-2">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="Enter game code"
              maxLength={30}
              className="flex-1 px-3 py-2 text-sm border border-lamo-border rounded-lg bg-white placeholder:text-lamo-gray-muted focus:outline-none focus:ring-2 focus:ring-lamo-blue/40"
            />
            <button
              type="submit"
              disabled={!joinCode.trim()}
              className="px-4 py-2 text-sm bg-lamo-blue text-white font-medium rounded-lg hover:bg-lamo-blue-dark transition-colors disabled:opacity-40"
            >
              Join
            </button>
          </form>
          <div className="text-lamo-gray-muted text-xs font-semibold uppercase tracking-wide pt-1">
            Create Game
          </div>
          {createItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2 pl-2 text-lamo-gray text-base font-medium hover:text-lamo-dark transition-colors"
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
          <Link
            to="/groups"
            onClick={() => setMenuOpen(false)}
            className="block text-lamo-gray text-base font-medium hover:text-lamo-dark transition-colors"
          >
            My Groups
          </Link>
          {user ? (
            <Link
              to="/credits"
              onClick={() => setMenuOpen(false)}
              className="block text-lamo-gray text-base font-medium hover:text-lamo-dark transition-colors"
            >
              My Account <span className="text-sm text-lamo-gray-muted">({user.credits} credits)</span>
            </Link>
          ) : (
            <Link
              to="/login"
              onClick={() => setMenuOpen(false)}
              className="block text-lamo-gray text-base font-medium hover:text-lamo-dark transition-colors"
            >
              Sign In
            </Link>
          )}
        </div>
      )}

      <main><Outlet /></main>
      <footer className="border-t border-lamo-border bg-lamo-bg mt-20">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div>
              <h3 className="font-semibold text-lamo-dark mb-4">LAMO Trivia</h3>
              <p className="text-sm text-lamo-gray-muted mb-4">
                Free online trivia, puzzles, and scavenger hunts for friends and family.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-lamo-dark mb-4">Games</h3>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link to="/lobby" className="text-lamo-gray hover:text-lamo-dark transition-colors">
                    Trivia
                  </Link>
                </li>
                <li>
                  <Link to="/riddle-wordle" className="text-lamo-gray hover:text-lamo-dark transition-colors">
                    Riddle Wordle
                  </Link>
                </li>
                <li>
                  <Link to="/hunt/create" className="text-lamo-gray hover:text-lamo-dark transition-colors">
                    Scavenger Hunts
                  </Link>
                </li>
                <li>
                  <Link to="/groups" className="text-lamo-gray hover:text-lamo-dark transition-colors">
                    My Groups
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-lamo-dark mb-4">Learn More</h3>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link to="/about" className="text-lamo-gray hover:text-lamo-dark transition-colors">
                    About
                  </Link>
                </li>
                <li>
                  <Link to="/how-to-play" className="text-lamo-gray hover:text-lamo-dark transition-colors">
                    How to Play
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-lamo-dark mb-4">Categories</h3>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link to="/trivia/harry-potter" className="text-lamo-gray hover:text-lamo-dark transition-colors">
                    Harry Potter
                  </Link>
                </li>
                <li>
                  <Link to="/trivia/science" className="text-lamo-gray hover:text-lamo-dark transition-colors">
                    Science
                  </Link>
                </li>
                <li>
                  <Link to="/trivia/history" className="text-lamo-gray hover:text-lamo-dark transition-colors">
                    History
                  </Link>
                </li>
                <li>
                  <Link to="/trivia/sports" className="text-lamo-gray hover:text-lamo-dark transition-colors">
                    Sports
                  </Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t border-lamo-border text-center text-sm text-lamo-gray-muted">
            <p>&copy; {new Date().getFullYear()} LAMO Trivia. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
