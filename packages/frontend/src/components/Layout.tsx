import { useState, useEffect, useRef } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useAuthContext } from "@/contexts/AuthContext";
import { Arrow, Brand } from "@/components/Brand";

export function Layout() {
  const { user } = useAuthContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const createRef = useRef<HTMLDivElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const isHome = location.pathname === "/";
  useEffect(() => {
    setMenuOpen(false);
    setCreateOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (createRef.current && !createRef.current.contains(e.target as Node))
        setCreateOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (createOpen) {
          setCreateOpen(false);
          createButton.current?.focus();
        }
        if (menuOpen) {
          setMenuOpen(false);
          menuButton.current?.focus();
        }
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [createOpen, menuOpen]);
  const createItems = [
    { to: "/create", label: "Trivia", detail: "Host a quiz for your friends" },
    {
      to: "/riddle-wordle",
      label: "Riddle Guess",
      detail: "Solve a word puzzle on your own",
    },
    {
      to: "/hunt/create",
      label: "Scavenger Hunt",
      detail: "Create a photo challenge",
    },
  ];
  const handleJoinCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    navigate(`/game/${encodeURIComponent(joinCode.trim())}`);
    setJoinCode("");
    setMenuOpen(false);
  };
  return (
    <div className={`app-shell ${isHome ? "home-shell" : "inner-shell"}`}>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <div className="site-width header-inner">
          <Link to="/" className="brand-link" aria-label="LAMO Trivia home">
            <Brand />
          </Link>
          <nav className="desktop-nav" aria-label="Main navigation">
            <div
              ref={createRef}
              className="create-navigation"
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget))
                  setCreateOpen(false);
              }}
            >
              <button
                ref={createButton}
                onClick={() => setCreateOpen(!createOpen)}
                aria-expanded={createOpen}
                aria-controls="game-navigation"
              >
                Let’s play{" "}
                <span
                  className={createOpen ? "chevron is-open" : "chevron"}
                  aria-hidden="true"
                >
                  ⌄
                </span>
              </button>
              {createOpen && (
                <div id="game-navigation" className="game-dropdown">
                  {createItems.map((item) => (
                    <Link key={item.to} to={item.to}>
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.detail}</small>
                      </span>
                      <Arrow diagonal />
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <NavLink to="/groups">My groups</NavLink>
            <NavLink to="/how-to-play">How to play</NavLink>
          </nav>
          <div className="header-actions">
            <Link to={user ? "/credits" : "/login"} className="account-link">
              {user ? `My account · ${user.credits} credits` : "Sign in"}
            </Link>
            {isHome ? (
              <Link to="/create" className="nav-play">
                Create trivia <Arrow />
              </Link>
            ) : (
              <form
                className="join-control header-join"
                onSubmit={handleJoinCode}
              >
                <label htmlFor="header-game-code" className="sr-only">
                  Game code
                </label>
                <input
                  id="header-game-code"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="Game code"
                  maxLength={30}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <button type="submit" disabled={!joinCode.trim()}>
                  Join <Arrow />
                </button>
              </form>
            )}
          </div>
          <button
            ref={menuButton}
            onClick={() => setMenuOpen(!menuOpen)}
            className="mobile-toggle"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
          >
            <span aria-hidden="true">{menuOpen ? "✕" : "☰"}</span>
          </button>
        </div>
        {menuOpen && (
          <nav
            id="mobile-navigation"
            className="mobile-navigation"
            aria-label="Mobile navigation"
          >
            {createItems.map((item) => (
              <Link key={item.to} to={item.to}>
                {item.label}
                <Arrow diagonal />
              </Link>
            ))}
            <Link to="/groups">My groups</Link>
            <Link to="/how-to-play">How to play</Link>
            <Link to={user ? "/credits" : "/login"}>
              {user ? `My account · ${user.credits} credits` : "Sign in"}
            </Link>
            <form onSubmit={handleJoinCode} className="join-control">
              <label htmlFor="mobile-game-code" className="sr-only">
                Game code
              </label>
              <input
                id="mobile-game-code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Game code"
                maxLength={30}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <button type="submit" disabled={!joinCode.trim()}>
                Join <Arrow />
              </button>
            </form>
          </nav>
        )}
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className={isHome ? "home-main" : "app-main"}
      >
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="site-width">
          <div className="footer-top">
            <div>
              <Link to="/" aria-label="LAMO Trivia home">
                <Brand />
              </Link>
              <p>
                A little competition.
                <br />A lot of good company.
              </p>
            </div>
            <nav aria-label="Games">
              <h2>MAKE YOUR MOVE</h2>
              <Link to="/create">Trivia</Link>
              <Link to="/riddle-wordle">Riddle Guess</Link>
              <Link to="/hunt/create">Scavenger Hunt</Link>
            </nav>
            <nav aria-label="Resources">
              <h2>THE GOOD STUFF</h2>
              <Link to="/groups">My groups</Link>
              <Link to="/how-to-play">How to play</Link>
              <Link to="/about">About LAMO</Link>
            </nav>
            <div className="footer-signoff">
              One more
              <br />
              round<span>?</span>
            </div>
          </div>
          <div className="footer-bottom">
            <p>© {new Date().getFullYear()} LAMO Trivia</p>
            <a href="https://lamoventures.com">
              Made by LAMO Ventures <Arrow diagonal />
            </a>
            <span>Good games. Real connections.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
