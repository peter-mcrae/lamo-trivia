import { Link } from 'react-router-dom';
import { SEO } from '@/components/SEO';

export default function About() {
  return (
    <>
      <SEO
        title="About LAMO Trivia - Free Online Trivia Games"
        description="Learn about LAMO Trivia, the free online trivia platform that brings families and friends together. No sign-up required, instant multiplayer games, and fun for all ages."
        keywords="about lamo trivia, online trivia platform, family trivia games, free trivia"
        canonical="https://lamotrivia.app/about"
        ogTitle="About LAMO Trivia - Free Online Trivia Games"
        ogDescription="Learn about LAMO Trivia, the free online trivia platform that brings families and friends together."
      />
      <div className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold text-lamo-dark mb-6">About LAMO Trivia</h1>
        
        <div className="prose prose-lg max-w-none">
          <p className="text-lg text-lamo-gray mb-6">
            LAMO Trivia is a free online trivia platform designed to bring families and friends together 
            for fun, engaging trivia games. Whether you're looking for a quick game during a break or 
            planning a virtual trivia night, we make it easy to play together—no sign-up required.
          </p>

          <h2 className="text-2xl font-bold text-lamo-dark mt-8 mb-4">Our Mission</h2>
          <p className="text-lamo-gray mb-6">
            We believe that trivia games should be accessible to everyone, everywhere. That's why we've 
            built a platform that requires no downloads, no accounts, and no hassle. Just create a game, 
            share the code, and start playing instantly.
          </p>

          <h2 className="text-2xl font-bold text-lamo-dark mt-8 mb-4">Features</h2>
          <ul className="list-disc list-inside text-lamo-gray mb-6 space-y-2">
            <li><strong>No Sign-Up Required:</strong> Jump right into games without creating an account</li>
            <li><strong>Multiple Categories:</strong> Choose from Harry Potter, Science, History, Sports, 
              Entertainment, Geography, Math, and more</li>
            <li><strong>AI-Generated Questions:</strong> Create custom trivia games on any topic using AI</li>
            <li><strong>Private Groups:</strong> Create private groups for your family or friends</li>
            <li><strong>Real-Time Multiplayer:</strong> Play with up to 8 players simultaneously</li>
            <li><strong>Flexible Scoring:</strong> Choose between speed bonus or correct-only scoring</li>
            <li><strong>Mobile Friendly:</strong> Works seamlessly on phones, tablets, and desktops</li>
          </ul>

          <h2 className="text-2xl font-bold text-lamo-dark mt-8 mb-4">How to Play</h2>
          <ol className="list-decimal list-inside text-lamo-gray mb-6 space-y-2">
            <li>Create a game by selecting your preferred categories and settings</li>
            <li>Share the game code with your friends or family</li>
            <li>Join the game using the code</li>
            <li>Answer questions as fast as you can to earn points</li>
            <li>Compete for the top spot on the leaderboard!</li>
          </ol>

          <h2 className="text-2xl font-bold text-lamo-dark mt-8 mb-4">Get Started</h2>
          <p className="text-lamo-gray mb-6">
            Ready to start playing? <Link to="/create" className="text-lamo-blue hover:underline">Create your first game</Link> or 
            {' '}<Link to="/lobby" className="text-lamo-blue hover:underline">join an existing game</Link>.
          </p>

          <div className="mt-12 pt-8 border-t border-lamo-border">
            <p className="text-sm text-lamo-gray-muted">
              Have questions or feedback? We'd love to hear from you!
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
