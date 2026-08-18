import { useState, useCallback } from 'react';
import type {
  GameState, ClientQuestion, Player, QuestionReview, ServerMessage,
} from '@lamo-trivia/shared';

interface AnswerResult {
  correct: boolean;
  correctIndex: number;
  scores: Record<string, number>;
}

/** Highest score first — used when a rejoin lands us in an already-finished game. */
function rankPlayers(players: Player[], scores: Record<string, number>): Player[] {
  return [...players].sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0));
}

export function useGameState() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<ClientQuestion | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [answerResult, setAnswerResult] = useState<AnswerResult | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [rankings, setRankings] = useState<Player[] | null>(null);
  // Played questions with correct answers — arrives once the game is finished
  const [review, setReview] = useState<QuestionReview[] | null>(null);
  // Time remaining for the current question (ms) — only set on mid-question rejoin
  const [questionRemainingMs, setQuestionRemainingMs] = useState<number | null>(null);

  const handleMessage = useCallback((message: ServerMessage) => {
    switch (message.type) {
      case 'join_confirmed':
        setPlayerId(message.playerId);
        break;

      case 'game_state':
        setGameState(message.state);
        // Rejoining a finished game: the game_finished broadcast is long gone,
        // so rebuild the results screen from the state snapshot
        if (message.state.phase === 'finished') {
          setRankings(rankPlayers(message.state.players, message.state.scores));
          if (message.state.review) setReview(message.state.review);
        }
        break;

      case 'player_joined':
        setGameState((prev) => {
          if (!prev) return prev;
          return { ...prev, players: [...prev.players, message.player] };
        });
        break;

      case 'player_left':
        setGameState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            players: prev.players.filter((p) => p.id !== message.playerId),
            ...(message.newHostId ? { hostId: message.newHostId } : {}),
          };
        });
        break;

      case 'host_changed':
        setGameState((prev) => {
          if (!prev) return prev;
          return { ...prev, hostId: message.hostId };
        });
        break;

      case 'game_starting':
        setCountdown(message.countdown);
        setGameState((prev) => {
          if (!prev) return prev;
          return { ...prev, phase: 'starting' };
        });
        break;

      case 'question':
        setCurrentQuestion(message.question);
        setQuestionIndex(message.questionIndex);
        setTotalQuestions(message.totalQuestions);
        setQuestionRemainingMs(message.remainingMs ?? null);
        setSelectedAnswer(null);
        setAnswerResult(null);
        setGameState((prev) => {
          if (!prev) return prev;
          return { ...prev, phase: 'playing', currentQuestionIndex: message.questionIndex };
        });
        break;

      case 'answer_result':
        setAnswerResult({
          correct: message.correct,
          correctIndex: message.correctIndex,
          scores: message.scores,
        });
        setGameState((prev) => {
          if (!prev) return prev;
          return { ...prev, scores: message.scores };
        });
        break;

      case 'game_finished':
        setRankings(message.rankings);
        setReview(message.review ?? null);
        setGameState((prev) => {
          if (!prev) return prev;
          return { ...prev, phase: 'finished', scores: message.finalScores };
        });
        break;
    }
  }, []);

  const reset = useCallback(() => {
    setGameState(null);
    setCurrentQuestion(null);
    setQuestionIndex(0);
    setTotalQuestions(0);
    setSelectedAnswer(null);
    setAnswerResult(null);
    setCountdown(null);
    setRankings(null);
    setReview(null);
    setPlayerId(null);
    setQuestionRemainingMs(null);
  }, []);

  return {
    gameState,
    playerId,
    currentQuestion,
    questionIndex,
    totalQuestions,
    selectedAnswer,
    setSelectedAnswer,
    answerResult,
    countdown,
    setCountdown,
    rankings,
    review,
    questionRemainingMs,
    handleMessage,
    reset,
  };
}
