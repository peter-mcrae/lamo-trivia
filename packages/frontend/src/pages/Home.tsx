import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SEO } from "@/components/SEO";
import { Arrow } from "@/components/Brand";

export default function Home() {
  const [code, setCode] = useState("");
  const navigate = useNavigate();
  return (
    <>
      <SEO
        title="LAMO Trivia — Trivia, riddles & game nights with friends"
        description="Choose your next game: free multiplayer trivia, solo word riddles, or photo scavenger hunts. Clear rules, easy invitations, and no app to download."
        canonical="https://lamotrivia.app"
      />
      <div className="play-home">
        <section
          className="game-selection site-width"
          aria-labelledby="home-heading"
        >
          <div className="selection-heading">
            <div>
              <p className="eyebrow">YOUR NEXT GAME NIGHT STARTS HERE</p>
              <h1 id="home-heading">
                Pick a game.
                <br />
                <span>Bring your people.</span>
              </h1>
              <p>
                Challenge your friends to trivia, solve a riddle on your own,
                <br className="desktop-break" /> or head outside for a photo
                scavenger hunt.
              </p>
            </div>
            <form
              className="join-panel"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim())
                  navigate(`/game/${encodeURIComponent(code.trim())}`);
              }}
            >
              <label htmlFor="home-game-code">Joining a trivia game?</label>
              <p>Enter the code your host shared with you.</p>
              <div className="join-control">
                <input
                  id="home-game-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Game code"
                  maxLength={30}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                />
                <button type="submit" disabled={!code.trim()}>
                  Join <Arrow />
                </button>
              </div>
              <Link to="/group/join">Have a private group code instead?</Link>
            </form>
          </div>

          <div className="game-options">
            <article
              className="game-option trivia-option"
              aria-labelledby="trivia-title"
            >
              <div className="option-content">
                <p className="option-meta">
                  01 / PLAY TOGETHER <span>FREE</span>
                </p>
                <h2 id="trivia-title">Trivia</h2>
                <p>
                  Pick a topic and invite your friends. Answer questions against
                  the clock and see who comes out on top.
                </p>
              </div>
              <div
                className="game-example trivia-example"
                aria-label="Example trivia question and answers"
              >
                <div className="example-label">
                  EXAMPLE QUESTION <span>20 sec</span>
                </div>
                <p>
                  Which planet has the most
                  <br />
                  prominent rings?
                </p>
                <div className="example-answers">
                  <span>Jupiter</span>
                  <span className="example-correct">
                    Saturn <span aria-hidden="true">✓</span>
                  </span>
                  <span>Mars</span>
                  <span>Neptune</span>
                </div>
              </div>
              <div className="option-bottom">
                <p>
                  1–12 players <span>·</span> No account needed
                </p>
                <Link to="/create" className="option-button">
                  Create a trivia game <Arrow />
                </Link>
              </div>
            </article>

            <article
              className="game-option riddle-option"
              aria-labelledby="riddle-title"
            >
              <div className="option-content">
                <p className="option-meta">
                  02 / PLAY SOLO <span>FREE</span>
                </p>
                <h2 id="riddle-title">Riddle Guess</h2>
                <p>
                  Read a riddle, then guess the answer in five tries. Letter
                  colors tell you when you’re getting closer.
                </p>
              </div>
              <div
                className="game-example riddle-example"
                aria-label="Example riddle, answered with the word piano"
              >
                <div className="example-label">EXAMPLE RIDDLE</div>
                <p>
                  I have keys but no locks.
                  <br />
                  What am I?
                </p>
                <div className="example-word" aria-label="Piano">
                  {"PIANO".split("").map((letter, i) => (
                    <span key={i} aria-hidden="true">
                      {letter}
                    </span>
                  ))}
                </div>
                <span className="example-caption">
                  Green = right letter, right spot.
                </span>
              </div>
              <div className="option-bottom">
                <p>
                  1 player <span>·</span> No account needed
                </p>
                <Link to="/riddle-wordle" className="option-button">
                  Play a riddle <Arrow />
                </Link>
              </div>
            </article>

            <article
              className="game-option hunt-option"
              aria-labelledby="hunt-title"
            >
              <div className="option-content">
                <p className="option-meta">03 / GET OUT & PLAY</p>
                <h2 id="hunt-title">Scavenger Hunt</h2>
                <p>
                  Create a list of things to find. Players take photos, and AI
                  checks each find as they race for points.
                </p>
              </div>
              <div
                className="game-example hunt-example"
                aria-label="Example scavenger hunt list"
              >
                <div className="example-label">
                  EXAMPLE HUNT <span>3 things to find</span>
                </div>
                <ol className="example-checklist">
                  <li>
                    <span aria-hidden="true">01</span> Something blue
                  </li>
                  <li>
                    <span aria-hidden="true">02</span> A leaf bigger than your
                    hand
                  </li>
                  <li>
                    <span aria-hidden="true">03</span> A perfectly round object
                  </li>
                </ol>
                <span className="example-caption">
                  Find an item. Take a photo. Earn points.
                </span>
              </div>
              <div className="option-bottom">
                <p>
                  Private group <span>·</span> Host uses credits
                </p>
                <Link to="/hunt/create" className="option-button">
                  Set up a hunt <Arrow />
                </Link>
              </div>
            </article>
          </div>
          <div className="first-time-note">
            <span>New to LAMO? Everything plays in your browser.</span>
            <Link to="/how-to-play">
              Read the game guides <Arrow diagonal />
            </Link>
          </div>
        </section>

        <section className="game-night-guide" aria-labelledby="how-heading">
          <div className="site-width">
            <div className="guide-heading">
              <p className="eyebrow">FROM “WHO’S IN?” TO GAME ON.</p>
              <h2 id="how-heading">
                Your first trivia night,
                <br />
                in three simple steps.
              </h2>
            </div>
            <div className="guide-steps">
              <div>
                <span>01</span>
                <h3>Make it your game.</h3>
                <p>
                  Choose a topic or a ready-made category. Set the number of
                  questions and the time limit.
                </p>
              </div>
              <div>
                <span>02</span>
                <h3>Send the invitation.</h3>
                <p>
                  Share your game code. Your friends enter it here and choose a
                  name—no account needed.
                </p>
              </div>
              <div>
                <span>03</span>
                <h3>Play for the top spot.</h3>
                <p>
                  The host starts the round. Everyone answers on their own
                  device and follows the live scores.
                </p>
              </div>
            </div>
            <nav className="topic-links" aria-label="Trivia categories">
              <span>Explore trivia topics</span>
              <Link to="/trivia/harry-potter">Harry Potter</Link>
              <Link to="/trivia/science">Science</Link>
              <Link to="/trivia/history">History</Link>
              <Link to="/trivia/sports">Sports</Link>
            </nav>
            <div className="private-group-row">
              <div>
                <h3>Same people, next time?</h3>
                <p>
                  A private group keeps your trivia games and scavenger hunts
                  together.
                </p>
              </div>
              <div>
                <Link to="/group/new" className="group-create">
                  Create a group <Arrow />
                </Link>
                <Link to="/group/join">Join a group</Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
