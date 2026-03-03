import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ServerMessage } from '@lamo-trivia/shared';

// --- Mocks ---

// Mock canvas-confetti
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

// Mock GroupMembersCard (uses its own WebSocket, unrelated to this test)
vi.mock('@/components/GroupMembersCard', () => ({
  GroupMembersCard: () => null,
}));

// Mock api
vi.mock('@/lib/api', () => ({
  api: {
    createGame: vi.fn(),
    getCategories: vi.fn().mockResolvedValue({ categories: [] }),
    getGroup: vi.fn().mockResolvedValue({ name: 'Test Group' }),
  },
}));

// Track WebSocket send calls and simulate server messages
let wsSendSpy: ReturnType<typeof vi.fn>;
let wsOnMessage: ((msg: ServerMessage) => void) | undefined;
let wsConnected: boolean;
let setWsConnected: (v: boolean) => void;

vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: ({ onMessage }: { gameId: string; onMessage?: (msg: ServerMessage) => void }) => {
    wsOnMessage = onMessage;
    return {
      connected: wsConnected,
      send: wsSendSpy,
    };
  },
}));

// Ensure localStorage has a username so the UsernameModal doesn't show
beforeEach(() => {
  localStorage.setItem('lamo-trivia-username', 'TestHost');
});

import GameRoom from '../GameRoom';

// --- Helpers ---

const baseGameState = {
  id: 'GAME-1',
  config: {
    name: 'Test Game',
    categoryIds: ['general'],
    questionCount: 5,
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
  hostId: 'host-1',
  players: [
    {
      id: 'host-1',
      username: 'TestHost',
      avatar: { emoji: '🐕', name: 'Dog' },
      connectedAt: Date.now(),
      score: 0,
    },
  ],
  currentQuestionIndex: 0,
  answers: {},
  scores: {},
  createdAt: Date.now(),
};

function renderGameRoom(initialRoute = '/game/GAME-1') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/game/:gameId" element={<GameRoom />} />
        <Route path="/lobby" element={<div>Lobby</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function simulateServerMessage(msg: ServerMessage) {
  act(() => {
    wsOnMessage?.(msg);
  });
}

// --- Tests ---

describe('GameRoom', () => {
  beforeEach(() => {
    wsSendSpy = vi.fn();
    wsConnected = true;
    wsOnMessage = undefined;
    vi.clearAllMocks();
    localStorage.setItem('lamo-trivia-username', 'TestHost');
  });

  it('sends join_game when connected with a username', () => {
    renderGameRoom();

    expect(wsSendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'join_game',
        gameId: 'GAME-1',
        username: 'TestHost',
      }),
    );
  });

  it('renders waiting phase with game name after receiving game_state', () => {
    renderGameRoom();
    simulateServerMessage({ type: 'game_state', state: baseGameState } as any);

    expect(screen.getByText('Test Game')).toBeInTheDocument();
    expect(screen.getByText(/GAME-1/)).toBeInTheDocument();
  });

  it('shows "Start Game" button for the host in waiting phase', () => {
    renderGameRoom();
    simulateServerMessage({ type: 'game_state', state: baseGameState } as any);

    expect(screen.getByRole('button', { name: /start game/i })).toBeInTheDocument();
  });

  it('renders finished phase with Game Over', () => {
    renderGameRoom();
    simulateServerMessage({ type: 'game_state', state: baseGameState } as any);

    simulateServerMessage({
      type: 'game_finished',
      rankings: baseGameState.players,
      finalScores: { 'host-1': 500 },
    } as any);

    expect(screen.getByText('Game Over!')).toBeInTheDocument();
    expect(screen.getByText('500 pts')).toBeInTheDocument();
  });

  it('shows Play Again button only for host in finished phase', () => {
    renderGameRoom();
    simulateServerMessage({ type: 'game_state', state: baseGameState } as any);

    simulateServerMessage({
      type: 'game_finished',
      rankings: baseGameState.players,
      finalScores: { 'host-1': 500 },
    } as any);

    expect(screen.getByRole('button', { name: /play again/i })).toBeInTheDocument();
  });

  it('does not show Play Again for non-host players', () => {
    renderGameRoom();

    const nonHostState = {
      ...baseGameState,
      players: [
        { ...baseGameState.players[0], id: 'other-1', username: 'OtherPlayer' },
        { id: 'host-1', username: 'SomeHost', avatar: { emoji: '🐈', name: 'Cat' }, connectedAt: Date.now(), score: 0 },
      ],
    };
    simulateServerMessage({ type: 'game_state', state: nonHostState } as any);

    simulateServerMessage({
      type: 'game_finished',
      rankings: nonHostState.players,
      finalScores: { 'other-1': 300, 'host-1': 500 },
    } as any);

    // TestHost matches 'other-1' who is NOT the host
    expect(screen.queryByRole('button', { name: /play again/i })).not.toBeInTheDocument();
  });

  it('displays error messages from server', () => {
    renderGameRoom();

    simulateServerMessage({ type: 'error', message: 'Game is full' } as any);

    expect(screen.getByText('Game is full')).toBeInTheDocument();
  });

  it('shows loading state before game_state arrives', () => {
    renderGameRoom();

    expect(screen.getByText('Connecting to game...')).toBeInTheDocument();
  });
});
