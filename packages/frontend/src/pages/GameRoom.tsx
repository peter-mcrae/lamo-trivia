import { useParams, useNavigate, Link } from 'react-router-dom';
import { useEffect, useRef, useState, useCallback } from 'react';
import { GAME_EXPIRY_MS } from '@lamo-trivia/shared';
import { useWebSocket } from '../hooks/useWebSocket';
import { useGameState } from '../hooks/useGameState';
import { useUsername } from '../hooks/useUsername';
import { UsernameModal } from '../components/UsernameModal';
import { PlayerList } from '../components/PlayerList';
import { QuestionCard } from '../components/QuestionCard';
import { Timer } from '../components/Timer';
import { ScoreBoard } from '../components/ScoreBoard';
import { RematchModal } from '../components/RematchModal';
import { Button } from '../components/ui/Button';
import { GroupMembersCard } from '../components/GroupMembersCard';
import { api } from '../lib/api';

export default function GameRoom() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { username, setUsername, hasUsername } = useUsername();
  const [error, setError] = useState<string | null>(null);
  const [startingGame, setStartingGame] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [copied, setCopied] = useState(false);
  const [expiryTimeLeft, setExpiryTimeLeft] = useState<number | null>(null);
  const [showRematchModal, setShowRematchModal] = useState(false);
  const [groupName, setGroupName] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const joinedRef = useRef(false);
  const hadGameStateRef = useRef(false);
  const groupIdRef = useRef<string | undefined>();

  const {
    gameState,
    currentQuestion,
    questionIndex,
    totalQuestions,
    selectedAnswer,
    setSelectedAnswer,
    answerResult,
    countdown,
    setCountdown,
    rankings,
    handleMessage,
    reset: resetGameState,
  } = useGameState();

  const onMessage = useCallback(
    (message: Parameters<typeof handleMessage>[0]) => {
      if (message.type === 'error') {
        setError(message.message);
        return;
      }
      if (message.type === 'game_expired') {
        const dest = groupIdRef.current ? `/group/${groupIdRef.current}` : '/lobby';
        setError('This game has expired. Returning...');
        setTimeout(() => navigate(dest), 3000);
        return;
      }
      if (message.type === 'rematch') {
        navigate(`/game/${message.newGameId}`);
        return;
      }
      handleMessage(message);
    },
    [handleMessage, navigate],
  );

  const { connected, send } = useWebSocket({
    gameId: gameId!,
    onMessage,
    onClose: () => {
      // Reset joinedRef so we rejoin on reconnect
      joinedRef.current = false;
    },
  });

  // Reset all state when navigating to a new game (e.g., Play Again)
  useEffect(() => {
    joinedRef.current = false;
    resetGameState();
    setError(null);
    setStartingGame(false);
    setShowRematchModal(false);
    setExpiryTimeLeft(null);
  }, [gameId, resetGameState]);

  // Track whether we've had game state (for reconnection detection)
  useEffect(() => {
    if (gameState) hadGameStateRef.current = true;
  }, [gameState]);

  // Join or rejoin game once connected and have a username
  useEffect(() => {
    if (connected && hasUsername && !joinedRef.current) {
      // If we previously had game state, this is a reconnection
      const messageType = hadGameStateRef.current ? 'rejoin_game' : 'join_game';
      if (send({ type: messageType, gameId: gameId!, username: username! })) {
        joinedRef.current = true;
      }
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

  // Countdown timer for "starting" phase (3 → 2 → 1)
  useEffect(() => {
    if (gameState?.phase !== 'starting' || countdown === null || countdown <= 0) return;
    const id = setTimeout(() => setCountdown((c) => (c !== null ? c - 1 : c)), 1000);
    return () => clearTimeout(id);
  }, [gameState?.phase, countdown, setCountdown]);

  const handleAnswer = (answerIndex: number) => {
    if (answerResult) return; // Can't change after results are revealed
    setSelectedAnswer(answerIndex);
    send({ type: 'submit_answer', questionIndex, answerIndex });
  };

  const handleStartGame = () => {
    setStartingGame(true);
    setError(null);
    send({ type: 'start_game' });
  };

  // Clear loading state when game phase advances or an error arrives
  useEffect(() => {
    if (startingGame && gameState?.phase && gameState.phase !== 'waiting') {
      setStartingGame(false);
    }
  }, [startingGame, gameState?.phase]);

  useEffect(() => {
    if (error) setStartingGame(false);
  }, [error]);

  const handleShare = async () => {
    const url = window.location.href;
    const text = `Join my LAMO Trivia game!\n${gameState?.config.name ?? 'Game'} — Code: ${gameState?.id}\n${url}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: 'LAMO Trivia', text });
        return;
      } catch {
        // User cancelled or share failed — fall through to clipboard
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard failed silently
    }
  };

  const handleClaimHost = () => {
    send({ type: 'claim_host' });
  };

  const handleRematchCreated = (newGameId: string) => {
    send({ type: 'rematch', newGameId });
    navigate(`/game/${newGameId}`);
  };

  // Expiry countdown — only active during waiting phase
  useEffect(() => {
    if (!gameState || gameState.phase !== 'waiting') {
      setExpiryTimeLeft(null);
      return;
    }

    const updateExpiry = () => {
      const remaining = GAME_EXPIRY_MS - (Date.now() - gameState.createdAt);
      setExpiryTimeLeft(Math.max(0, remaining));
    };

    updateExpiry();
    const id = setInterval(updateExpiry, 1000);
    return () => clearInterval(id);
  }, [gameState?.phase, gameState?.createdAt]);

  const formatExpiry = (ms: number): string => {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Track groupId in a ref so the onMessage callback can access it
  useEffect(() => {
    groupIdRef.current = gameState?.config.groupId;
  }, [gameState?.config.groupId]);

  // Fetch group name when the game belongs to a group
  useEffect(() => {
    const groupId = gameState?.config.groupId;
    if (!groupId) return;
    api.getGroup(groupId).then((g) => setGroupName(g.name)).catch(() => {});
  }, [gameState?.config.groupId]);

  const backPath = gameState?.config.groupId
    ? `/group/${gameState.config.groupId}`
    : '/lobby';
  const backLabel = gameState?.config.groupId ? 'Back to Group' : 'Back to Lobby';

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
            <Button onClick={() => navigate(backPath)}>{backLabel}</Button>
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
      {/* Group context */}
      {gameState.config.groupId && (
        <div className="mb-4">
          <Link
            to={`/group/${gameState.config.groupId}`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-lamo-blue hover:text-lamo-blue/80 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M12.5 9.75A2.75 2.75 0 0 0 9.75 7H4.56l2.22 2.22a.75.75 0 1 1-1.06 1.06l-3.5-3.5a.75.75 0 0 1 0-1.06l3.5-3.5a.75.75 0 0 1 1.06 1.06L4.56 5.5h5.19a4.25 4.25 0 0 1 0 8.5h-1a.75.75 0 0 1 0-1.5h1a2.75 2.75 0 0 0 2.75-2.75Z" clipRule="evenodd" />
            </svg>
            {groupName ?? 'Group'}
          </Link>
        </div>
      )}

      {/* Group members online */}
      {gameState.config.groupId && (gameState.phase === 'waiting' || gameState.phase === 'finished') && (
        <GroupMembersCard
          groupId={gameState.config.groupId}
          gameId={gameState.id}
          gameName={gameState.config.name}
          gamePlayerUsernames={gameState.players.map((p) => p.username)}
        />
      )}

      {/* Error banner */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
          {error}
        </div>
      )}

      {/* Waiting Phase */}
      {gameState.phase === 'waiting' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-2xl font-bold text-lamo-dark">{gameState.config.name}</h2>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-lamo-gray-muted text-sm">
                  Game Code: <span className="font-mono font-bold text-lamo-dark">{gameState.id}</span>
                </p>
                <button
                  onClick={handleShare}
                  className="text-xs px-2.5 py-1 rounded-full bg-lamo-blue/10 text-lamo-blue font-medium hover:bg-lamo-blue/20 transition-colors"
                >
                  {copied ? 'Copied!' : 'Share'}
                </button>
              </div>
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

          {/* Expiry countdown */}
          {expiryTimeLeft !== null && (
            <p className={`text-xs mb-4 ${
              expiryTimeLeft < 5 * 60 * 1000
                ? 'text-red-500 bg-red-50 px-3 py-1.5 rounded-lg inline-block'
                : 'text-lamo-gray-muted'
            }`}>
              Game expires in {formatExpiry(expiryTimeLeft)}
            </p>
          )}

          <div className="mb-6">
            <h3 className="text-sm font-semibold text-lamo-dark mb-3">Players</h3>
            <PlayerList players={gameState.players} hostId={gameState.hostId} />
          </div>

          {startingGame ? (
            <div className="flex flex-col items-center py-6 gap-3">
              <div className="w-8 h-8 border-4 border-lamo-blue/30 border-t-lamo-blue rounded-full animate-spin" />
              <p className="text-sm text-lamo-gray-muted">
                {gameState.config.aiTopic
                  ? '🤖 Generating AI questions... hang tight!'
                  : 'Loading questions...'}
              </p>
            </div>
          ) : (
            <div className="flex gap-3">
              {isHost && (
                <Button onClick={handleStartGame} disabled={!canStart}>
                  {canStart ? 'Start Game' : `Need ${gameState.config.minPlayers - gameState.players.length} more`}
                </Button>
              )}
              {!isHost && (
                <div className="flex items-center gap-3">
                  <p className="text-sm text-lamo-gray-muted py-2">Waiting for host to start...</p>
                  <button
                    onClick={handleClaimHost}
                    className="text-xs px-2.5 py-1 rounded-full border border-lamo-border text-lamo-gray-muted hover:text-lamo-dark hover:border-lamo-blue/40 transition-colors"
                  >
                    Claim Host
                  </button>
                </div>
              )}
              <Button variant="secondary" onClick={() => navigate(backPath)}>
                Leave
              </Button>
            </div>
          )}
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
      {gameState.phase === 'finished' && rankings && rankings.length > 0 && (
        <div>
          <h2 className="text-2xl font-bold text-lamo-dark text-center mb-2">Game Over!</h2>
          <p className="text-lamo-gray-muted text-center mb-8">{gameState.config.name}</p>

          {/* Podium */}
          <div className="flex items-end justify-center gap-3 mb-8">
            {/* 2nd Place */}
            {rankings[1] && (
              <div className="flex flex-col items-center w-28">
                <span className="text-3xl mb-1" title={rankings[1].avatar.name}>{rankings[1].avatar.emoji}</span>
                <span className="text-sm font-semibold text-lamo-dark truncate w-full text-center">{rankings[1].username}</span>
                <span className="text-xs text-lamo-gray-muted mb-2">{gameState.scores[rankings[1].id] ?? 0} pts</span>
                <div className="w-full h-24 rounded-t-xl bg-gradient-to-t from-gray-300 to-gray-200 flex items-center justify-center">
                  <span className="text-2xl font-bold text-gray-600">2nd</span>
                </div>
              </div>
            )}

            {/* 1st Place */}
            <div className="flex flex-col items-center w-28">
              <span className="text-xl mb-1">👑</span>
              <span className="text-4xl mb-1" title={rankings[0].avatar.name}>{rankings[0].avatar.emoji}</span>
              <span className="text-sm font-bold text-lamo-dark truncate w-full text-center">{rankings[0].username}</span>
              <span className="text-xs text-lamo-gray-muted mb-2">{gameState.scores[rankings[0].id] ?? 0} pts</span>
              <div className="w-full h-32 rounded-t-xl bg-gradient-to-t from-yellow-400 to-yellow-300 flex items-center justify-center">
                <span className="text-2xl font-bold text-yellow-700">1st</span>
              </div>
            </div>

            {/* 3rd Place */}
            {rankings[2] && (
              <div className="flex flex-col items-center w-28">
                <span className="text-3xl mb-1" title={rankings[2].avatar.name}>{rankings[2].avatar.emoji}</span>
                <span className="text-sm font-semibold text-lamo-dark truncate w-full text-center">{rankings[2].username}</span>
                <span className="text-xs text-lamo-gray-muted mb-2">{gameState.scores[rankings[2].id] ?? 0} pts</span>
                <div className="w-full h-16 rounded-t-xl bg-gradient-to-t from-orange-300 to-orange-200 flex items-center justify-center">
                  <span className="text-2xl font-bold text-orange-600">3rd</span>
                </div>
              </div>
            )}
          </div>

          {/* 4th place and beyond */}
          {rankings.length > 3 && (
            <div className="space-y-2 mb-8">
              {rankings.slice(3).map((player, i) => (
                <div
                  key={player.id}
                  className="flex items-center justify-between px-5 py-3 rounded-xl bg-lamo-bg border border-lamo-border"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-lamo-gray-muted w-6">{i + 4}th</span>
                    <span className="text-xl" title={player.avatar.name}>{player.avatar.emoji}</span>
                    <span className="font-medium text-lamo-dark">{player.username}</span>
                  </div>
                  <span className="font-bold text-lamo-blue">{gameState.scores[player.id] ?? 0}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-center gap-3">
            {isHost && (
              <Button onClick={() => setShowRematchModal(true)}>
                Play Again
              </Button>
            )}
            <Button variant="secondary" onClick={() => navigate(backPath)}>
              {backLabel}
            </Button>
          </div>

          {showRematchModal && (
            <RematchModal
              currentConfig={gameState.config}
              onRematchCreated={handleRematchCreated}
              onClose={() => setShowRematchModal(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}
