import { useParams } from 'react-router-dom';

export default function Results() {
  const { gameId } = useParams<{ gameId: string }>();

  return (
    <div className="max-w-3xl mx-auto py-10 px-6 text-center">
      <h2 className="text-2xl font-bold text-lamo-dark mb-2">Results</h2>
      <p className="text-lamo-gray-muted mb-6">Game {gameId} has ended.</p>
      {/* TODO: Final scores, rankings, play again button */}
    </div>
  );
}
