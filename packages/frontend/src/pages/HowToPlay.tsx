import { Link } from 'react-router-dom';
import { SEO } from '@/components/SEO';

export default function HowToPlay() {
  return (
    <>
      <SEO
        title="How to Play LAMO Trivia - Complete Guide"
        description="Learn how to play LAMO Trivia games. Step-by-step guide for creating games, joining games, playing with friends, and scoring points. Perfect for beginners!"
        keywords="how to play trivia, trivia game guide, online trivia tutorial, multiplayer trivia instructions"
        canonical="https://lamotrivia.app/how-to-play"
        ogTitle="How to Play LAMO Trivia - Complete Guide"
        ogDescription="Learn how to play LAMO Trivia games with this step-by-step guide."
      />
      <div className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold text-lamo-dark mb-6">How to Play LAMO Trivia</h1>
        
        <div className="prose prose-lg max-w-none">
          <p className="text-lg text-lamo-gray mb-8">
            Playing LAMO Trivia is easy and fun! Follow this guide to get started with your first game.
          </p>

          <section className="mb-12">
            <h2 className="text-2xl font-bold text-lamo-dark mt-8 mb-4">Creating a Game</h2>
            <ol className="list-decimal list-inside text-lamo-gray mb-6 space-y-3">
              <li>
                <strong>Click "Create Game"</strong> from the home page or navigation menu
              </li>
              <li>
                <strong>Choose Your Categories:</strong> Select one or more trivia categories like Harry Potter, 
                Science, History, Sports, or use AI to generate questions on any topic
              </li>
              <li>
                <strong>Configure Settings:</strong>
                <ul className="list-disc list-inside ml-6 mt-2 space-y-1">
                  <li>Number of questions (default: 10)</li>
                  <li>Time per question (default: 15 seconds)</li>
                  <li>Scoring method: Speed Bonus (faster answers = more points) or Correct Only (flat points)</li>
                  <li>Whether to show answers after each question</li>
                </ul>
              </li>
              <li>
                <strong>Get Your Game Code:</strong> Once created, you'll receive a unique game code to share
              </li>
            </ol>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-bold text-lamo-dark mt-8 mb-4">Joining a Game</h2>
            <ol className="list-decimal list-inside text-lamo-gray mb-6 space-y-3">
              <li>
                <strong>Get the Game Code:</strong> Ask the game creator for the game code
              </li>
              <li>
                <strong>Enter Your Username:</strong> Choose a unique username (2-20 characters)
              </li>
              <li>
                <strong>Enter the Code:</strong> Type the game code in the lobby or join page
              </li>
              <li>
                <strong>Wait for Start:</strong> Once all players are ready, the game creator can start the game
              </li>
            </ol>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-bold text-lamo-dark mt-8 mb-4">Playing the Game</h2>
            <ol className="list-decimal list-inside text-lamo-gray mb-6 space-y-3">
              <li>
                <strong>Read the Question:</strong> Each question appears with multiple choice answers
              </li>
              <li>
                <strong>Answer Quickly:</strong> Click on your answer before time runs out
                <ul className="list-disc list-inside ml-6 mt-2 space-y-1">
                  <li>With Speed Bonus scoring, faster correct answers earn more points</li>
                  <li>With Correct Only scoring, all correct answers earn the same points</li>
                </ul>
              </li>
              <li>
                <strong>See Results:</strong> After each question (if enabled), you'll see the correct answer 
                and how other players scored
              </li>
              <li>
                <strong>Track Your Score:</strong> Watch the leaderboard to see your ranking in real-time
              </li>
              <li>
                <strong>Finish Strong:</strong> Complete all questions and see the final results!
              </li>
            </ol>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-bold text-lamo-dark mt-8 mb-4">Scoring System</h2>
            <div className="bg-lamo-bg p-6 rounded-2xl mb-6">
              <h3 className="text-xl font-semibold text-lamo-dark mb-3">Speed Bonus Mode</h3>
              <p className="text-lamo-gray mb-4">
                In Speed Bonus mode, the faster you answer correctly, the more points you earn. 
                This adds excitement and rewards quick thinking!
              </p>
              <ul className="list-disc list-inside text-lamo-gray space-y-1">
                <li>Maximum points for answering immediately</li>
                <li>Points decrease as time passes</li>
                <li>Incorrect answers earn 0 points</li>
              </ul>
            </div>
            <div className="bg-lamo-bg p-6 rounded-2xl mb-6">
              <h3 className="text-xl font-semibold text-lamo-dark mb-3">Correct Only Mode</h3>
              <p className="text-lamo-gray mb-4">
                In Correct Only mode, all correct answers earn the same number of points, regardless 
                of how quickly you answer. Perfect for a more relaxed game!
              </p>
              <ul className="list-disc list-inside text-lamo-gray space-y-1">
                <li>Flat points per correct answer</li>
                <li>No time pressure</li>
                <li>Focus on accuracy over speed</li>
              </ul>
            </div>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-bold text-lamo-dark mt-8 mb-4">Private Groups</h2>
            <p className="text-lamo-gray mb-4">
              Want to play regularly with the same group of friends or family? Create a private group!
            </p>
            <ol className="list-decimal list-inside text-lamo-gray mb-6 space-y-3">
              <li>Click "Create a Private Group" from the home page</li>
              <li>Give your group a name</li>
              <li>Share the group code with your friends</li>
              <li>Create multiple games within your group</li>
              <li>Track scores and compete over time</li>
            </ol>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-bold text-lamo-dark mt-8 mb-4">Tips for Success</h2>
            <ul className="list-disc list-inside text-lamo-gray mb-6 space-y-2">
              <li><strong>Read Carefully:</strong> Take a moment to understand each question before answering</li>
              <li><strong>Trust Your Instincts:</strong> Your first answer is often correct</li>
              <li><strong>Manage Your Time:</strong> Don't spend too long on one question—you can always guess</li>
              <li><strong>Have Fun:</strong> Trivia is about learning and enjoying time with others!</li>
            </ul>
          </section>

          <div className="mt-12 pt-8 border-t border-lamo-border text-center">
            <p className="text-lamo-gray mb-4">Ready to start playing?</p>
            <div className="flex gap-4 justify-center">
              <Link
                to="/create"
                className="inline-flex items-center px-6 py-3 bg-lamo-blue text-white font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors"
              >
                Create Your First Game
              </Link>
              <Link
                to="/lobby"
                className="inline-flex items-center px-6 py-3 border border-lamo-border text-lamo-dark font-semibold rounded-pill hover:bg-lamo-bg transition-colors"
              >
                Join a Game
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
