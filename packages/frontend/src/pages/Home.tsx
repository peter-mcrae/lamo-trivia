import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div className="text-center py-20 px-6">
      <h1 className="text-5xl font-bold tracking-tight text-lamo-dark mb-4 animate-fade-in-up">
        LAMO Trivia
      </h1>
      <p className="text-lg text-lamo-gray-muted max-w-md mx-auto mb-10">
        Challenge your friends to real-time trivia. No sign-up required.
      </p>
      <div className="flex gap-4 justify-center">
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
    </div>
  );
}
