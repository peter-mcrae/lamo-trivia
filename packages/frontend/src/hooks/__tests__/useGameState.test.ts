import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGameState } from '../useGameState';

const initialGameState = {
  id: 'TEST-0001',
  config: {
    name: 'Test',
    categoryIds: ['general'],
    questionCount: 10,
    minPlayers: 1,
    maxPlayers: 8,
    timePerQuestion: 15,
    scoringMethod: 'speed-bonus' as const,
    streakBonus: false,
    showAnswers: true,
    timeBetweenQuestions: 5,
    isPrivate: false,
  },
  phase: 'waiting' as const,
  hostId: 'p1',
  players: [
    {
      id: 'p1',
      username: 'Player1',
      avatar: { emoji: '🐕', name: 'Golden Retriever' },
      connectedAt: Date.now(),
      score: 0,
    },
  ],
  currentQuestionIndex: 0,
  answers: {},
  scores: {},
  createdAt: Date.now(),
};

describe('useGameState', () => {
  it('returns correct initial state', () => {
    const { result } = renderHook(() => useGameState());

    expect(result.current.gameState).toBeNull();
    expect(result.current.currentQuestion).toBeNull();
    expect(result.current.questionIndex).toBe(0);
    expect(result.current.totalQuestions).toBe(0);
    expect(result.current.selectedAnswer).toBeNull();
    expect(result.current.answerResult).toBeNull();
    expect(result.current.countdown).toBeNull();
    expect(result.current.rankings).toBeNull();
  });

  it('game_state message sets gameState', () => {
    const { result } = renderHook(() => useGameState());

    act(() => {
      result.current.handleMessage({
        type: 'game_state',
        state: initialGameState,
      } as any);
    });

    expect(result.current.gameState).toEqual(initialGameState);
  });

  it('player_joined appends player to gameState', () => {
    const { result } = renderHook(() => useGameState());

    act(() => {
      result.current.handleMessage({
        type: 'game_state',
        state: initialGameState,
      } as any);
    });

    const newPlayer = {
      id: 'p2',
      username: 'Player2',
      avatar: { emoji: '🐈', name: 'Cat' },
      connectedAt: Date.now(),
      score: 0,
    };

    act(() => {
      result.current.handleMessage({
        type: 'player_joined',
        player: newPlayer,
      } as any);
    });

    expect(result.current.gameState!.players).toHaveLength(2);
    expect(result.current.gameState!.players[1]).toEqual(newPlayer);
  });

  it('player_left removes player by ID', () => {
    const { result } = renderHook(() => useGameState());

    const stateWithTwoPlayers = {
      ...initialGameState,
      players: [
        ...initialGameState.players,
        {
          id: 'p2',
          username: 'Player2',
          avatar: { emoji: '🐈', name: 'Cat' },
          connectedAt: Date.now(),
          score: 0,
        },
      ],
    };

    act(() => {
      result.current.handleMessage({
        type: 'game_state',
        state: stateWithTwoPlayers,
      } as any);
    });

    act(() => {
      result.current.handleMessage({
        type: 'player_left',
        playerId: 'p2',
      } as any);
    });

    expect(result.current.gameState!.players).toHaveLength(1);
    expect(result.current.gameState!.players[0].id).toBe('p1');
  });

  it('player_left with newHostId updates hostId', () => {
    const { result } = renderHook(() => useGameState());

    const stateWithTwoPlayers = {
      ...initialGameState,
      players: [
        ...initialGameState.players,
        {
          id: 'p2',
          username: 'Player2',
          avatar: { emoji: '🐈', name: 'Cat' },
          connectedAt: Date.now(),
          score: 0,
        },
      ],
    };

    act(() => {
      result.current.handleMessage({
        type: 'game_state',
        state: stateWithTwoPlayers,
      } as any);
    });

    act(() => {
      result.current.handleMessage({
        type: 'player_left',
        playerId: 'p1',
        newHostId: 'p2',
      } as any);
    });

    expect(result.current.gameState!.players).toHaveLength(1);
    expect(result.current.gameState!.hostId).toBe('p2');
  });

  it('host_changed updates hostId', () => {
    const { result } = renderHook(() => useGameState());

    act(() => {
      result.current.handleMessage({
        type: 'game_state',
        state: initialGameState,
      } as any);
    });

    expect(result.current.gameState!.hostId).toBe('p1');

    act(() => {
      result.current.handleMessage({
        type: 'host_changed',
        hostId: 'p2',
      } as any);
    });

    expect(result.current.gameState!.hostId).toBe('p2');
  });

  it('game_starting sets countdown and phase to starting', () => {
    const { result } = renderHook(() => useGameState());

    act(() => {
      result.current.handleMessage({
        type: 'game_state',
        state: initialGameState,
      } as any);
    });

    act(() => {
      result.current.handleMessage({
        type: 'game_starting',
        countdown: 3,
      } as any);
    });

    expect(result.current.countdown).toBe(3);
    expect(result.current.gameState!.phase).toBe('starting');
  });

  it('question sets currentQuestion and resets selectedAnswer', () => {
    const { result } = renderHook(() => useGameState());

    act(() => {
      result.current.handleMessage({
        type: 'game_state',
        state: initialGameState,
      } as any);
    });

    // Set a selected answer first
    act(() => {
      result.current.setSelectedAnswer(2);
    });
    expect(result.current.selectedAnswer).toBe(2);

    const question = {
      text: 'What is 2 + 2?',
      options: ['1', '2', '3', '4'],
      category: 'math',
    };

    act(() => {
      result.current.handleMessage({
        type: 'question',
        question,
        questionIndex: 1,
        totalQuestions: 10,
      } as any);
    });

    expect(result.current.currentQuestion).toEqual(question);
    expect(result.current.questionIndex).toBe(1);
    expect(result.current.totalQuestions).toBe(10);
    expect(result.current.selectedAnswer).toBeNull();
    expect(result.current.answerResult).toBeNull();
    expect(result.current.gameState!.phase).toBe('playing');
  });

  it('answer_result updates scores and sets result', () => {
    const { result } = renderHook(() => useGameState());

    act(() => {
      result.current.handleMessage({
        type: 'game_state',
        state: initialGameState,
      } as any);
    });

    const scores = { p1: 100 };

    act(() => {
      result.current.handleMessage({
        type: 'answer_result',
        correct: true,
        correctIndex: 3,
        scores,
      } as any);
    });

    expect(result.current.answerResult).toEqual({
      correct: true,
      correctIndex: 3,
      scores,
    });
    expect(result.current.gameState!.scores).toEqual(scores);
  });

  it('game_finished sets rankings and phase to finished', () => {
    const { result } = renderHook(() => useGameState());

    act(() => {
      result.current.handleMessage({
        type: 'game_state',
        state: initialGameState,
      } as any);
    });

    const rankings = [
      {
        id: 'p1',
        username: 'Player1',
        avatar: { emoji: '🐕', name: 'Golden Retriever' },
        connectedAt: Date.now(),
        score: 200,
      },
    ];

    const finalScores = { p1: 200 };

    act(() => {
      result.current.handleMessage({
        type: 'game_finished',
        rankings,
        finalScores,
      } as any);
    });

    expect(result.current.rankings).toEqual(rankings);
    expect(result.current.gameState!.phase).toBe('finished');
    expect(result.current.gameState!.scores).toEqual(finalScores);
  });

  it('reset clears all state back to initial values after a full game', () => {
    const { result } = renderHook(() => useGameState());

    // Simulate a full game: join → start → question → answer → finish
    act(() => {
      result.current.handleMessage({
        type: 'game_state',
        state: initialGameState,
      } as any);
    });

    act(() => {
      result.current.handleMessage({
        type: 'game_starting',
        countdown: 3,
      } as any);
    });

    act(() => {
      result.current.handleMessage({
        type: 'question',
        question: { text: 'Q?', options: ['A', 'B', 'C', 'D'], category: 'general' },
        questionIndex: 2,
        totalQuestions: 10,
      } as any);
    });

    act(() => {
      result.current.setSelectedAnswer(1);
    });

    act(() => {
      result.current.handleMessage({
        type: 'answer_result',
        correct: true,
        correctIndex: 1,
        scores: { p1: 100 },
      } as any);
    });

    act(() => {
      result.current.handleMessage({
        type: 'game_finished',
        rankings: initialGameState.players,
        finalScores: { p1: 100 },
      } as any);
    });

    // Verify state is populated from the finished game
    expect(result.current.gameState).not.toBeNull();
    expect(result.current.gameState!.phase).toBe('finished');
    expect(result.current.currentQuestion).not.toBeNull();
    expect(result.current.questionIndex).toBe(2);
    expect(result.current.totalQuestions).toBe(10);
    expect(result.current.answerResult).not.toBeNull();
    expect(result.current.rankings).not.toBeNull();

    // Reset (simulates what happens on Play Again navigation)
    act(() => {
      result.current.reset();
    });

    // All state should be back to initial values
    expect(result.current.gameState).toBeNull();
    expect(result.current.currentQuestion).toBeNull();
    expect(result.current.questionIndex).toBe(0);
    expect(result.current.totalQuestions).toBe(0);
    expect(result.current.selectedAnswer).toBeNull();
    expect(result.current.answerResult).toBeNull();
    expect(result.current.countdown).toBeNull();
    expect(result.current.rankings).toBeNull();
  });
});
