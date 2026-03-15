import { Link } from 'react-router-dom';
import { SEO } from '@/components/SEO';

export default function Home() {
  return (
    <>
      <SEO
        title="LAMO Games - Free Online Trivia, Riddle Guess & Scavenger Hunts"
        description="Play free online games with family and friends. Multiplayer trivia, Riddle Guess puzzles, and AI-powered scavenger hunts. No sign-up required."
        keywords="trivia games, online trivia, free trivia, family trivia, riddle guess, scavenger hunt, photo scavenger hunt, multiplayer games, game night"
        canonical="https://lamotrivia.app"
        ogTitle="LAMO Games - Free Online Games for Families & Friends"
        ogDescription="Trivia, Riddle Guess, and Scavenger Hunts. No sign-up required. Instant multiplayer fun!"
      />
      <div>
      {/* Hero */}
      <section className="text-center pt-20 pb-10 px-6">
        <h1 className="text-6xl font-bold tracking-tight mb-4 animate-fade-in-up">
          <span className="text-lamo-lime">LAMO</span>{' '}
          <span className="text-lamo-dark">Games</span>
        </h1>
        <p className="text-xl text-lamo-dark font-medium max-w-md mx-auto mb-2 animate-fade-in-up">
          Challenge your friends. No app needed.
        </p>
        <p className="text-base text-lamo-gray-muted max-w-md mx-auto animate-fade-in-up">
          Free. Instant. Zero downloads.
        </p>
      </section>

      {/* Game Modes */}
      <section className="max-w-3xl mx-auto px-6 pb-12">
        <h2 className="text-2xl font-bold text-lamo-dark text-center mb-6">
          Choose Your Game
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Link
            to="/create"
            className="group flex flex-col items-center gap-3 p-6 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-lamo-blue/20 hover:border-lamo-blue hover:scale-105 hover:shadow-lg transition-all"
          >
            <span className="text-5xl group-hover:scale-110 transition-transform">🧠</span>
            <span className="text-lg font-bold text-lamo-dark">Trivia</span>
            <span className="text-sm text-lamo-gray-muted text-center">Multiplayer quiz with friends and family</span>
          </Link>
          <Link
            to="/riddle-wordle"
            className="group flex flex-col items-center gap-3 p-6 rounded-2xl bg-gradient-to-br from-green-50 to-yellow-50 border-2 border-green-200 hover:border-green-400 hover:scale-105 hover:shadow-lg transition-all"
          >
            <span className="text-5xl group-hover:scale-110 transition-transform">🧩</span>
            <span className="text-lg font-bold text-lamo-dark">Riddle Guess</span>
            <span className="text-sm text-lamo-gray-muted text-center">Solve riddles one letter at a time</span>
          </Link>
          <Link
            to="/hunt/create"
            className="group relative flex flex-col items-center gap-3 p-6 rounded-2xl bg-gradient-to-br from-orange-50 to-amber-50 border-2 border-orange-200 hover:border-orange-400 hover:scale-105 hover:shadow-lg transition-all"
          >
            <span className="absolute top-2 right-2 text-[10px] font-semibold bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">
              Uses Credits
            </span>
            <span className="text-5xl group-hover:scale-110 transition-transform">🔍</span>
            <span className="text-lg font-bold text-lamo-dark">Scavenger Hunt</span>
            <span className="text-sm text-lamo-gray-muted text-center">Find items, snap photos, race the clock</span>
          </Link>
        </div>
        <div className="flex gap-4 justify-center mt-6 animate-fade-in-up">
          <Link
            to="/group/new"
            className="text-sm text-lamo-blue font-medium hover:underline"
          >
            Create a Private Group
          </Link>
          <span className="text-lamo-border">|</span>
          <Link
            to="/group/join"
            className="text-sm text-lamo-blue font-medium hover:underline"
          >
            Join a Group
          </Link>
        </div>
      </section>

      {/* How It Works */}
      <section className="max-w-3xl mx-auto px-6 pb-20">
        <h2 className="text-2xl font-bold text-lamo-dark text-center mb-8">
          How It Works
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
          <div className="flex flex-col items-center gap-2">
            <span className="text-4xl">🎮</span>
            <h3 className="font-semibold text-lamo-dark">Create a Game</h3>
            <p className="text-sm text-lamo-gray-muted">Pick categories, set the rules, and get a game code.</p>
          </div>
          <div className="flex flex-col items-center gap-2">
            <span className="text-4xl">📲</span>
            <h3 className="font-semibold text-lamo-dark">Share the Code</h3>
            <p className="text-sm text-lamo-gray-muted">Send it to family and friends — they join instantly.</p>
          </div>
          <div className="flex flex-col items-center gap-2">
            <span className="text-4xl">🏆</span>
            <h3 className="font-semibold text-lamo-dark">Play & Compete</h3>
            <p className="text-sm text-lamo-gray-muted">Answer questions, race the clock, and climb the leaderboard.</p>
          </div>
        </div>
      </section>

      {/* SEO Content Section */}
      <section className="max-w-4xl mx-auto px-6 pb-20">
        <h2 className="text-2xl font-bold text-lamo-dark text-center mb-8">
          Free Online Games for Families & Friends
        </h2>
        <div className="prose prose-lg max-w-none text-lamo-gray">
          <p className="mb-4">
            LAMO Games offers the best free online game night experience for families and friends.
            Play <Link to="/create" className="text-lamo-blue hover:underline">multiplayer trivia</Link> across categories like{' '}
            <Link to="/trivia/harry-potter" className="text-lamo-blue hover:underline">Harry Potter</Link>,{' '}
            <Link to="/trivia/science" className="text-lamo-blue hover:underline">science</Link>,{' '}
            <Link to="/trivia/history" className="text-lamo-blue hover:underline">history</Link>, and{' '}
            <Link to="/trivia/sports" className="text-lamo-blue hover:underline">sports</Link>.
            Challenge yourself with <Link to="/riddle-wordle" className="text-lamo-blue hover:underline">Riddle Guess</Link>,
            or create a <Link to="/hunt/create" className="text-lamo-blue hover:underline">Scavenger Hunt</Link> in a private group with AI-powered photo verification.
          </p>
          <p className="mb-4">
            Just <Link to="/create" className="text-lamo-blue hover:underline">create a game</Link>,
            share the code, and start playing instantly. Trivia is free — scavenger hunts use credits for AI photo verification.
          </p>
          <p>
            New here? Check out our <Link to="/how-to-play" className="text-lamo-blue hover:underline">complete guide</Link>
            {' '}or learn <Link to="/about" className="text-lamo-blue hover:underline">more about LAMO</Link>.
          </p>
        </div>
      </section>
    </div>
    </>
  );
}
