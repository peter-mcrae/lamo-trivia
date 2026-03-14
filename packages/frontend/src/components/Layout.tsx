import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';

export function Layout({ children }: { children: ReactNode }) {
  const { user } = useAuthContext();
  return (
    <div className="min-h-screen bg-white">
      <nav className="flex items-center justify-between px-6 h-[52px] bg-lamo-bg-hero/[0.92] backdrop-blur-xl border-b border-lamo-border sticky top-0 z-50">
        <Link
          to="/"
          className="flex items-center gap-2.5 text-lamo-dark font-semibold text-[17px] no-underline"
        >
          LAMO Trivia
        </Link>
        <div className="flex gap-7">
          <Link
            to="/lobby"
            className="text-lamo-gray text-sm font-medium hover:text-lamo-dark transition-colors"
          >
            Play
          </Link>
          <Link
            to="/create"
            className="text-lamo-gray text-sm font-medium hover:text-lamo-dark transition-colors"
          >
            Create Game
          </Link>
          <Link
            to="/groups"
            className="text-lamo-gray text-sm font-medium hover:text-lamo-dark transition-colors"
          >
            Groups
          </Link>
          <Link
            to={user ? '/credits' : '/login'}
            className="text-lamo-gray text-sm font-medium hover:text-lamo-dark transition-colors"
          >
            {user ? `${user.credits} Credits` : 'Sign In'}
          </Link>
        </div>
      </nav>
      <main>{children}</main>
      <footer className="border-t border-lamo-border bg-lamo-bg mt-20">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <h3 className="font-semibold text-lamo-dark mb-4">LAMO Trivia</h3>
              <p className="text-sm text-lamo-gray-muted mb-4">
                Free online trivia and scavenger hunt games for family and friends.
              </p>
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
