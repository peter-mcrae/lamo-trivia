import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useGameState } from '../hooks/useGameState';
import { useUsername } from '../hooks/useUsername';
import { UsernameModal } from '../components/UsernameModal';
import { PlayerList } from '../components/PlayerList';
import { QuestionCard } from '../components/QuestionCard';
import { Timer } from '../components/Timer';
import { ScoreBoard } from '../components/ScoreBoard';
import { Button } from '../components/ui/Button';

export default function GameRoom() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { username, setUsername, hasUsername } = useUsername();
  const [error, setError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const joinedRef = useRef(false);

  const {
    gameState,
    currentQuestion,
    questionIndex,
    totalQuestions,
    selectedAnswer,
    setSelectedAnswer,
    answerResult,
    countdown,
    rankings,
    handleMessage,
  } = useGameState();

  const onMessage = useCallback(
    (message: Parameters<typeof handleMessage>[0]) => {
      if (message.type === 'error') {
        setError(message.message);
        return;
      }
      handleMessage(message);
    },
    [handleMessage],
  );

  const { connected, send } = useWebSocket({
    gameId: gameId!,
    onMessage,
  });

  // Join game once connected and have a username
  useEffect(() => {
    if (connected && hasUsername && !joinedRef.current) {
      joinedRef.current = true;
      send({ type: 'join_game', gameId: gameId!, username: username! });
    }
  }, [connected, hasUsername, gameId, username, send]);

  // Countdown timer for questions
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (gameState?.phase === 'playing' && currentQuestion && !answerResult) {
      const total = gameState.config.timePerQuestion;
      setTimeLeft(total);
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current!);
            timerRef.current = null;
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [gameState?.phase, currentQuestion, answerResult, gameState?.config.timePerQuestion]);

  const handleAnswer = (answerIndex: number) => {
    if (selectedAnswer !== null) return;
    setSelectedAnswer(answerIndex);
    send({ type: 'submit_answer', questionIndex, answerIndex });
  };

  const handleStartGame = () => {
    send({ type: 'start_game' });
  };

  const handleUsernameSubmit = (name: string) => {
    setUsername(name);
  };

  // Show username modal if needed
  if (!hasUsername) {
    return <UsernameModal onSubmit={handleUsernameSubmit} />;
  }

  // Loading state
  if (!gameState) {
    return (
      <div className="max-w-3xl mx-auto py-10 px-6 text-center">
        {error ? (
          <div>
            <p className="text-red-500 font-medium mb-4">{error}</p>
            <Button onClick={() => navigate('/lobby')}>Back to Lobby</Button>
          </div>
        ) : (
          <p className="text-lamo-gray-muted">Connecting to game...</p>
        )}
      </div>
    );
  }

  const isHost = gameState.players.find((p) => p.username === username)?.id === gameState.hostId;
  const canStart = isHost && gameState.players.length >= gameState.config.minPlayers;

  return (
    <div className="max-w-3xl mx-auto py-10 px-6">
      {/* Error banner */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
          {error}
        </div>
      )}

      {/* Waiting Phase */}
      {gameState.phase === 'waiting' && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-lamo-dark">{gameState.config.name}</h2>
              <p className="text-lamo-gray-muted text-sm mt-1">
                Game Code: <span className="font-mono font-bold text-lamo-dark">{gameState.id}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-lamo-gray-muted">
                {gameState.players.length} / {gameState.config.maxPlayers} players
              </p>
              <p className="text-xs text-lamo-gray-muted mt-0.5">
                Need {gameState.config.minPlayers} to start
              </p>
            </div>
          </div>

          <div className="mb-6">
            <h3 className="text-sm font-semibold text-lamo-dark mb-3">Players</h3>
            <PlayerList players={gameState.players} hostId={gameState.hostId} />
          </div>

          <div className="flex gap-3">
            {isHost && (
              <Button onClick={handleStartGame} disabled={!canStart}>
                {canStart ? 'Start Game' : `Need ${gameState.config.minPlayers - gameState.players.length} more`}
              </Button>
            )}
            {!isHost && (
              <p className="text-sm text-lamo-gray-muted py-2">Waiting for host to start...</p>
            )}
            <Button variant="secondary" onClick={() => navigate('/lobby')}>
              Leave
            </Button>
          </div>
        </div>
      )}

      {/* Starting Phase — Countdown */}
      {gameState.phase === 'starting' && countdown !== null && (
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-lamo-gray-muted mb-4">Game starting in</p>
          <div className="text-7xl font-bold text-lamo-blue animate-pulse">{countdown}</div>
          <p className="text-sm text-lamo-gray-muted mt-6">Get ready!</p>
        </div>
      )}

      {/* Playing Phase */}
      {gameState.phase === 'playing' && currentQuestion && (
        <div>
          <div className="mb-6">
            <Timer seconds={timeLeft} total={gameState.config.timePerQuestion} />
          </div>

          <QuestionCard
            question={currentQuestion}
            questionIndex={questionIndex}
            totalQuestions={totalQuestions}
            selectedAnswer={selectedAnswer}
            correctIndex={answerResult?.correctIndex ?? null}
            showResult={!!answerResult}
            onAnswer={handleAnswer}
          />

          {/* Live scoreboard */}
          <div className="mt-8">
            <h3 className="text-sm font-semibold text-lamo-dark mb-3">Scores</h3>
            <ScoreBoard players={gameState.players} scores={gameState.scores} />
          </div>
        </div>
      )}

      {/* Finished Phase */}
      {gameState.phase === 'finished' && (
        <div>
          <h2 className="text-2xl font-bold text-lamo-dark text-center mb-2">Game Over!</h2>
          <p className="text-lamo-gray-muted text-center mb-8">{gameState.config.name}</p>

          {rankings && rankings.length > 0 && (
            <div className="space-y-3 mb-8">
              {rankings.map((player, i) => {
                const medal = i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : null;
                return (
                  <div
                    key={player.id}
                    className={`flex items-center justify-between px-5 py-4 rounded-xl ${
                      i === 0
                        ? 'bg-yellow-50 border-2 border-yellow-300'
                        : i === 1
                          ? 'bg-gray-50 border-2 border-gray-300'
                          : i === 2
                            ? 'bg-orange-50 border-2 border-orange-300'
                            : 'bg-lamo-bg border border-lamo-border'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-bold text-lamo-gray-muted w-8">
                        {medal ?? `${i + 1}th`}
                      </span>
                      <span className="text-2xl" title={player.avatar.name}>{player.avatar.emoji}</span>
                      <div className="flex flex-col">
                        <span className="font-semibold text-lamo-dark">{player.username}</span>
                        <span className="text-xs text-lamo-gray-muted -mt-0.5">{player.avatar.name}</span>
                      </div>
                    </div>
                    <span className="font-bold text-lamo-blue text-lg">
                      {gameState.scores[player.id] ?? 0}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="text-center">
            <Button onClick={() => navigate('/lobby')}>Back to Lobby</Button>
          </div>
        </div>
      )}
    </div>
  );
}
