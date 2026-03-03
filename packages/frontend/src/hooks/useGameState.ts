import { useState, useCallback } from 'react';
import type { GameState, ClientQuestion, Player, ServerMessage } from '@lamo-trivia/shared';

interface AnswerResult {
  correct: boolean;
  correctIndex: number;
  scores: Record<string, number>;
}

export function useGameState() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<ClientQuestion | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [answerResult, setAnswerResult] = useState<AnswerResult | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [rankings, setRankings] = useState<Player[] | null>(null);

  const handleMessage = useCallback((message: ServerMessage) => {
    switch (message.type) {
      case 'game_state':
        setGameState(message.state);
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
  }, []);

  return {
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
    reset,
  };
}
