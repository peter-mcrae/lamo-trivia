import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';

export function Layout({ children }: { children: ReactNode }) {
  const { user } = useAuthContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Close mobile menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const navLinks = [
    { to: '/lobby', label: 'Play' },
    { to: '/create', label: 'Create Game' },
    { to: '/groups', label: 'Groups' },
    { to: user ? '/credits' : '/login', label: user ? `${user.credits} Credits` : 'Sign In' },
  ];

  return (
    <div className="min-h-screen bg-white">
      <nav className="flex items-center justify-between px-6 h-[52px] bg-lamo-bg-hero/[0.92] backdrop-blur-xl border-b border-lamo-border sticky top-0 z-50">
        <Link
          to="/"
          className="flex items-center gap-2.5 text-lamo-dark font-semibold text-[17px] no-underline"
        >
          LAMO Trivia
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex gap-7">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="text-lamo-gray text-sm font-medium hover:text-lamo-dark transition-colors"
            >
              {link.label}
            </Link>
          ))}
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
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setMenuOpen(false)}
              className="block text-lamo-gray text-base font-medium hover:text-lamo-dark transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}

      <main>{children}</main>
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
                    Groups
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
