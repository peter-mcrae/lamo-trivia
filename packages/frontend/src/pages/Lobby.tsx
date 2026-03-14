import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import type { GameListing } from '@lamo-trivia/shared';
import { GameCard } from '@/components/GameCard';
import { api } from '@/lib/api';

export default function Lobby() {
  const navigate = useNavigate();
  const [games, setGames] = useState<GameListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState('');

  const fetchGames = async () => {
    try {
      const res = await api.getGames();
      setGames(res.games);
    } catch {
      console.error('Failed to fetch games');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGames();
    const interval = setInterval(fetchGames, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleJoin = (gameId: string) => {
    const game = games.find((g) => g.id === gameId);
    if (game?.gameMode === 'scavenger-hunt') {
      navigate(`/hunt/${gameId}`);
    } else {
      navigate(`/game/${gameId}`);
    }
  };

  // Only show trivia games that are still waiting for players
  const joinableGames = games.filter((g) => g.phase === 'waiting' && g.gameMode !== 'scavenger-hunt');

  return (
    <div className="max-w-3xl mx-auto py-10 px-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-lamo-dark">Find a Game</h2>
        {joinableGames.length > 0 && (
          <Link
            to="/create"
            className="px-5 py-2 bg-lamo-blue text-white text-sm font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors"
          >
            Create Game
          </Link>
        )}
      </div>

      {loading ? (
        <p className="text-lamo-gray-muted">Loading games...</p>
      ) : joinableGames.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-lg text-lamo-gray-muted mb-6">
            No games right now — start one or join with a code!
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-8">
            <Link
              to="/create"
              className="inline-flex items-center px-6 py-2.5 bg-lamo-blue text-white font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors"
            >
              Start a Game
            </Link>
            <Link
              to="/hunt/create"
              className="inline-flex items-center px-6 py-2.5 border border-lamo-border text-lamo-dark font-semibold rounded-pill hover:bg-lamo-bg transition-colors"
            >
              Create Hunt
            </Link>
          </div>
          <div className="max-w-xs mx-auto">
            <p className="text-sm text-lamo-gray-muted mb-2">Have a game code?</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const code = joinCode.trim().toUpperCase();
                if (code) navigate(`/game/${code}`);
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Enter code"
                className="flex-1 px-3 py-2 border border-lamo-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-lamo-primary/30 focus:border-lamo-primary font-mono text-center uppercase"
              />
              <button
                type="submit"
                disabled={!joinCode.trim()}
                className="px-4 py-2 bg-lamo-blue text-white text-sm font-semibold rounded-lg hover:bg-lamo-blue-dark transition-colors disabled:opacity-50"
              >
                Join
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {joinableGames.map((game) => (
            <GameCard key={game.id} game={game} onJoin={handleJoin} />
          ))}
        </div>
      )}
    </div>
  );
}
