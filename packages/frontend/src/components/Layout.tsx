import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

export function Layout({ children }: { children: ReactNode }) {
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
        </div>
      </nav>
      <main>{children}</main>
    </div>
  );
}
