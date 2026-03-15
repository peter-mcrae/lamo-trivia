import { Link } from 'react-router-dom';
import { SEO } from '@/components/SEO';

export default function HowToPlay() {
  return (
    <>
      <SEO
        title="How to Play - LAMO Games Complete Guide"
        description="Learn how to play all LAMO games: Trivia, Riddle Guess, and Scavenger Hunts. Covers creating games, joining groups, scoring, and passwordless login."
        keywords="how to play trivia, riddle guess, scavenger hunt, game guide, online trivia tutorial, multiplayer trivia instructions, LAMO games"
        canonical="https://lamotrivia.app/how-to-play"
        ogTitle="How to Play - LAMO Games Complete Guide"
        ogDescription="Everything you need to know about Trivia, Riddle Guess, and Scavenger Hunts."
      />
      <div className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold text-lamo-dark mb-3">How to Play</h1>
        <p className="text-lg text-lamo-gray mb-10">
          Everything you need to know to start playing LAMO Games with friends and family.
        </p>

        {/* Quick Links */}
        <nav className="mb-12 p-5 bg-lamo-bg rounded-2xl border border-lamo-border">
          <h2 className="text-sm font-semibold text-lamo-dark mb-3">Jump to a section</h2>
          <div className="flex flex-wrap gap-2">
            <a href="#getting-started" className="text-sm text-lamo-blue hover:underline">Getting Started</a>
            <span className="text-lamo-border">·</span>
            <a href="#groups" className="text-sm text-lamo-blue hover:underline">Groups</a>
            <span className="text-lamo-border">·</span>
            <a href="#trivia" className="text-sm text-lamo-blue hover:underline">Trivia</a>
            <span className="text-lamo-border">·</span>
            <a href="#riddle-guess" className="text-sm text-lamo-blue hover:underline">Riddle Guess</a>
            <span className="text-lamo-border">·</span>
            <a href="#scavenger-hunt" className="text-sm text-lamo-blue hover:underline">Scavenger Hunts</a>
            <span className="text-lamo-border">·</span>
            <a href="#accounts" className="text-sm text-lamo-blue hover:underline">Accounts & Login</a>
          </div>
        </nav>

        <div className="prose prose-lg max-w-none">

          {/* Getting Started */}
          <section id="getting-started" className="mb-14 scroll-mt-20">
            <h2 className="text-2xl font-bold text-lamo-dark mb-4">Getting Started</h2>
            <p className="text-lamo-gray mb-4">
              LAMO Games is free to play in your browser — no downloads, no app installs. Just pick a game type,
              share the code or link, and start playing.
            </p>
            <ol className="list-decimal list-inside text-lamo-gray space-y-3">
              <li><strong>Choose a game</strong> — Trivia, Riddle Guess, or Scavenger Hunt</li>
              <li><strong>Create or join</strong> — start a new game or enter a code to join one</li>
              <li><strong>Pick a username</strong> — no account needed for trivia and riddle games</li>
              <li><strong>Play!</strong> — compete in real-time with friends and family</li>
            </ol>
          </section>

          {/* Groups */}
          <section id="groups" className="mb-14 scroll-mt-20">
            <h2 className="text-2xl font-bold text-lamo-dark mb-4">Groups</h2>
            <p className="text-lamo-gray mb-4">
              Groups are the easiest way to play with the same people regularly. Create a group,
              share the code, and everyone can see and join games from the group page.
            </p>
            <ol className="list-decimal list-inside text-lamo-gray space-y-3 mb-6">
              <li><Link to="/group/new" className="text-lamo-blue hover:underline">Create a group</Link> and give it a name</li>
              <li>Share the group code with friends and family</li>
              <li>Anyone with the code can join and see all group games</li>
              <li>Start trivia, riddle, or scavenger hunt games from within the group</li>
            </ol>
            <div className="bg-lamo-bg p-5 rounded-2xl border border-lamo-border">
              <p className="text-sm text-lamo-gray">
                <strong className="text-lamo-dark">Tip:</strong> You can also create games
                outside of groups using the <Link to="/create" className="text-lamo-blue hover:underline">Create Game</Link> page
                and share the game code directly.
              </p>
            </div>
          </section>

          {/* Trivia */}
          <section id="trivia" className="mb-14 scroll-mt-20">
            <h2 className="text-2xl font-bold text-lamo-dark mb-4">Trivia</h2>
            <p className="text-lamo-gray mb-4">
              Real-time multiplayer trivia with multiple-choice questions. Answer fast for bonus points.
            </p>

            <h3 className="text-xl font-semibold text-lamo-dark mb-3">Creating a Game</h3>
            <ol className="list-decimal list-inside text-lamo-gray space-y-3 mb-6">
              <li>
                <strong>Choose categories</strong> — pick from options like Harry Potter, Science, History, Sports,
                or use AI to generate questions on any topic
              </li>
              <li>
                <strong>Configure settings</strong>:
                <ul className="list-disc list-inside ml-6 mt-2 space-y-1">
                  <li>Number of questions (default: 10)</li>
                  <li>Time per question (default: 7 seconds)</li>
                  <li>Scoring: Speed Bonus or Correct Only</li>
                  <li>Whether to show correct answers after each question</li>
                </ul>
              </li>
              <li><strong>Share the game code</strong> or link with players</li>
              <li><strong>Start when ready</strong> — the host controls when the game begins</li>
            </ol>

            <h3 className="text-xl font-semibold text-lamo-dark mb-3">Scoring</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <div className="bg-lamo-bg p-5 rounded-2xl border border-lamo-border">
                <h4 className="font-semibold text-lamo-dark mb-2">Speed Bonus Mode</h4>
                <p className="text-sm text-lamo-gray">
                  Faster correct answers earn more points. Rewards quick thinking!
                </p>
              </div>
              <div className="bg-lamo-bg p-5 rounded-2xl border border-lamo-border">
                <h4 className="font-semibold text-lamo-dark mb-2">Correct Only Mode</h4>
                <p className="text-sm text-lamo-gray">
                  All correct answers earn the same points regardless of speed. More relaxed!
                </p>
              </div>
            </div>

            <div className="text-center">
              <Link
                to="/create"
                className="inline-flex items-center px-5 py-2.5 bg-lamo-blue text-white font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors text-sm"
              >
                Create a Trivia Game
              </Link>
            </div>
          </section>

          {/* Riddle Guess */}
          <section id="riddle-guess" className="mb-14 scroll-mt-20">
            <h2 className="text-2xl font-bold text-lamo-dark mb-4">Riddle Guess</h2>
            <p className="text-lamo-gray mb-4">
              A word-guessing puzzle game. You get a riddle and must figure out the answer by guessing
              letters, similar to Wordle — but the clue is a riddle instead of just blanks.
            </p>

            <h3 className="text-xl font-semibold text-lamo-dark mb-3">How It Works</h3>
            <ol className="list-decimal list-inside text-lamo-gray space-y-3 mb-6">
              <li><strong>Read the riddle</strong> — each puzzle presents a riddle with a one-word answer</li>
              <li><strong>Guess letters</strong> — type letters to guess the answer, one at a time</li>
              <li>
                <strong>Feedback on each guess</strong>:
                <ul className="list-disc list-inside ml-6 mt-2 space-y-1">
                  <li>Correct letters in the right position are highlighted green</li>
                  <li>Correct letters in the wrong position are highlighted yellow</li>
                  <li>Letters not in the answer are grayed out</li>
                </ul>
              </li>
              <li><strong>Solve before running out of guesses</strong> to earn the most points</li>
            </ol>

            <div className="bg-lamo-bg p-5 rounded-2xl border border-lamo-border mb-6">
              <p className="text-sm text-lamo-gray">
                <strong className="text-lamo-dark">Tip:</strong> Use the riddle clue to narrow down your options.
                Think about what word could be both the answer to the riddle and match the letter pattern you've uncovered.
              </p>
            </div>

            <div className="text-center">
              <Link
                to="/riddle-wordle"
                className="inline-flex items-center px-5 py-2.5 bg-lamo-blue text-white font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors text-sm"
              >
                Play Riddle Guess
              </Link>
            </div>
          </section>

          {/* Scavenger Hunt */}
          <section id="scavenger-hunt" className="mb-14 scroll-mt-20">
            <h2 className="text-2xl font-bold text-lamo-dark mb-4">Scavenger Hunts</h2>
            <p className="text-lamo-gray mb-4">
              Real-world photo challenges with AI verification. Create a list of items, set a timer,
              and race to find and photograph everything.
            </p>

            <h3 className="text-xl font-semibold text-lamo-dark mb-3">Quick Overview</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="bg-lamo-bg p-4 rounded-2xl border border-lamo-border text-center">
                <span className="text-2xl block mb-1">📝</span>
                <p className="text-sm font-medium text-lamo-dark">Create items to find</p>
              </div>
              <div className="bg-lamo-bg p-4 rounded-2xl border border-lamo-border text-center">
                <span className="text-2xl block mb-1">📸</span>
                <p className="text-sm font-medium text-lamo-dark">Snap photos of what you find</p>
              </div>
              <div className="bg-lamo-bg p-4 rounded-2xl border border-lamo-border text-center">
                <span className="text-2xl block mb-1">🤖</span>
                <p className="text-sm font-medium text-lamo-dark">AI verifies your photos</p>
              </div>
            </div>

            <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5 mb-6">
              <p className="text-sm text-lamo-gray">
                <strong className="text-lamo-dark">Credits Required:</strong> Scavenger hunts use credits
                for AI photo verification. Only the hunt creator needs credits — all other players join free.
                <Link to="/credits" className="text-lamo-blue hover:underline ml-1">Get credits</Link>
              </p>
            </div>

            <div className="text-center">
              <Link
                to="/how-to-hunt"
                className="inline-flex items-center px-5 py-2.5 bg-lamo-blue text-white font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors text-sm"
              >
                Full Scavenger Hunt Guide
              </Link>
            </div>
          </section>

          {/* Accounts & Login */}
          <section id="accounts" className="mb-14 scroll-mt-20">
            <h2 className="text-2xl font-bold text-lamo-dark mb-4">Accounts & Login</h2>

            <h3 className="text-xl font-semibold text-lamo-dark mb-3">No Passwords</h3>
            <p className="text-lamo-gray mb-4">
              LAMO uses <strong>passwordless magic link login</strong>. When you sign in, we send
              a 6-digit code to your email — enter it and you're in. No password to remember or reset.
            </p>

            <h3 className="text-xl font-semibold text-lamo-dark mb-3">When Do You Need an Account?</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div className="bg-green-50 border border-green-200 p-5 rounded-2xl">
                <h4 className="font-semibold text-green-800 mb-2">No Account Needed</h4>
                <ul className="text-sm text-lamo-gray space-y-1">
                  <li>Playing trivia games</li>
                  <li>Playing Riddle Guess</li>
                  <li>Joining a game via code or link</li>
                </ul>
              </div>
              <div className="bg-blue-50 border border-blue-200 p-5 rounded-2xl">
                <h4 className="font-semibold text-blue-800 mb-2">Account Required</h4>
                <ul className="text-sm text-lamo-gray space-y-1">
                  <li>Creating groups</li>
                  <li>Hosting scavenger hunts</li>
                  <li>Purchasing credits</li>
                </ul>
              </div>
            </div>

            <div className="text-center">
              <Link
                to="/login"
                className="inline-flex items-center px-5 py-2.5 border border-lamo-border text-lamo-dark font-semibold rounded-pill hover:bg-lamo-bg transition-colors text-sm"
              >
                Sign In
              </Link>
            </div>
          </section>

          {/* CTA */}
          <div className="mt-12 pt-8 border-t border-lamo-border text-center">
            <p className="text-lamo-gray mb-4">Ready to play?</p>
            <div className="flex gap-4 justify-center flex-wrap">
              <Link
                to="/create"
                className="inline-flex items-center px-6 py-3 bg-lamo-blue text-white font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors"
              >
                Create a Game
              </Link>
              <Link
                to="/groups"
                className="inline-flex items-center px-6 py-3 border border-lamo-border text-lamo-dark font-semibold rounded-pill hover:bg-lamo-bg transition-colors"
              >
                My Groups
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
