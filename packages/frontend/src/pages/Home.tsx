import { Link } from 'react-router-dom';
import { TRIVIA_CATEGORIES } from '@lamo-trivia/shared';
import { SEO } from '@/components/SEO';

export default function Home() {
  return (
    <>
      <SEO
        title="LAMO Trivia - Free Online Trivia Games for Family & Friends"
        description="Play free online trivia games with family and friends. No sign-up required. Choose from Harry Potter, Science, History, Sports, and more categories. Create private groups or join public games instantly."
        keywords="trivia games, online trivia, free trivia, family trivia, Harry Potter trivia, science trivia, history trivia, sports trivia, multiplayer trivia, trivia night"
        canonical="https://lamotrivia.app"
        ogTitle="LAMO Trivia - Free Online Trivia Games"
        ogDescription="Play free online trivia games with family and friends. No sign-up required. Instant multiplayer trivia fun!"
      />
      <div>
      {/* Hero */}
      <section className="text-center pt-20 pb-16 px-6">
        <h1 className="text-6xl font-bold tracking-tight mb-4 animate-fade-in-up">
          <span className="text-lamo-lime">LAMO</span>{' '}
          <span className="text-lamo-dark">Trivia</span>
        </h1>
        <p className="text-xl text-lamo-dark font-medium max-w-md mx-auto mb-2 animate-fade-in-up">
          Family trivia night, anywhere, anytime.
        </p>
        <p className="text-base text-lamo-gray-muted max-w-md mx-auto mb-10 animate-fade-in-up">
          No sign-up. No downloads. Just fun.
        </p>
        <div className="flex gap-4 justify-center animate-fade-in-up">
          <Link
            to="/lobby"
            className="inline-flex items-center px-8 py-3 bg-lamo-blue text-white font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors"
          >
            Play Now
          </Link>
          <Link
            to="/create"
            className="inline-flex items-center px-8 py-3 border border-lamo-border text-lamo-dark font-semibold rounded-pill hover:bg-lamo-bg transition-colors"
          >
            Create Game
          </Link>
        </div>
        <div className="flex gap-4 justify-center mt-4 animate-fade-in-up">
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

      {/* Categories */}
      <section className="max-w-3xl mx-auto px-6 pb-16">
        <h2 className="text-2xl font-bold text-lamo-dark text-center mb-8">
          Pick Your Challenge
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {TRIVIA_CATEGORIES.map((cat) => (
            <Link
              key={cat.id}
              to={`/trivia/${cat.id}`}
              className="flex flex-col items-center gap-1.5 p-4 rounded-2xl bg-lamo-bg border border-lamo-border hover:scale-105 hover:shadow-md transition-all cursor-pointer"
            >
              <span className="text-3xl">{cat.icon}</span>
              <span className="text-sm font-semibold text-lamo-dark">{cat.name}</span>
              <span className="text-xs text-lamo-gray-muted">{cat.questionCount} Qs</span>
            </Link>
          ))}
          <Link
            to="/create"
            className="flex flex-col items-center gap-1.5 p-4 rounded-2xl bg-gradient-to-br from-lamo-blue/5 to-lamo-lime/10 border border-dashed border-lamo-blue/30 hover:scale-105 hover:shadow-md transition-all cursor-pointer"
          >
            <span className="text-3xl">🤖</span>
            <span className="text-sm font-semibold text-lamo-dark">AI Generated</span>
            <span className="text-xs text-lamo-gray-muted">Any topic!</span>
          </Link>
          <Link
            to="/riddle-wordle"
            className="flex flex-col items-center gap-1.5 p-4 rounded-2xl bg-gradient-to-br from-green-50 to-yellow-50 border border-dashed border-green-300 hover:scale-105 hover:shadow-md transition-all cursor-pointer"
          >
            <span className="text-3xl">🧩</span>
            <span className="text-sm font-semibold text-lamo-dark">Riddle Wordle</span>
            <span className="text-xs text-lamo-gray-muted">Solve riddles!</span>
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
          Free Online Trivia Games
        </h2>
        <div className="prose prose-lg max-w-none text-lamo-gray">
          <p className="mb-4">
            LAMO Trivia offers the best free online trivia experience for families and friends. 
            Whether you're looking for <Link to="/trivia/harry-potter" className="text-lamo-blue hover:underline">Harry Potter trivia</Link>, 
            {' '}<Link to="/trivia/science" className="text-lamo-blue hover:underline">science questions</Link>, 
            {' '}<Link to="/trivia/history" className="text-lamo-blue hover:underline">history quizzes</Link>, 
            or <Link to="/trivia/sports" className="text-lamo-blue hover:underline">sports trivia</Link>, 
            we have something for everyone.
          </p>
          <p className="mb-4">
            Our platform makes it easy to host virtual trivia nights, family game nights, or 
            friendly competitions. With no sign-up required, you can start playing instantly. 
            Simply <Link to="/create" className="text-lamo-blue hover:underline">create a game</Link>, 
            share the code, and invite your friends to join.
          </p>
          <p>
            New to trivia? Check out our <Link to="/how-to-play" className="text-lamo-blue hover:underline">complete guide</Link> 
            {' '}or learn <Link to="/about" className="text-lamo-blue hover:underline">more about LAMO Trivia</Link>.
          </p>
        </div>
      </section>
    </div>
    </>
  );
}
