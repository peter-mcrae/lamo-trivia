import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import type { GameListing } from '@lamo-trivia/shared';
import { GameCard } from '@/components/GameCard';
import { api } from '@/lib/api';

export default function Lobby() {
  const navigate = useNavigate();
  const [games, setGames] = useState<GameListing[]>([]);
  const [loading, setLoading] = useState(true);

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
    navigate(`/game/${gameId}`);
  };

  return (
    <div className="max-w-3xl mx-auto py-10 px-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-lamo-dark">Game Lobby</h2>
        <Link
          to="/create"
          className="px-5 py-2 bg-lamo-blue text-white text-sm font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors"
        >
          Create Game
        </Link>
      </div>

      {loading ? (
        <p className="text-lamo-gray-muted">Loading games...</p>
      ) : games.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-lamo-gray-muted mb-4">No games available yet.</p>
          <Link
            to="/create"
            className="inline-flex items-center px-6 py-2.5 bg-lamo-blue text-white font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors"
          >
            Create the first game
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {games.map((game) => (
            <GameCard key={game.id} game={game} onJoin={handleJoin} />
          ))}
        </div>
      )}
    </div>
  );
}
