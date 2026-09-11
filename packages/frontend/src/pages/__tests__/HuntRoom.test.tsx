import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { HuntClientMessage, HuntServerMessage } from '@lamo-trivia/shared';

// --- Mocks ---

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: {
    uploadHuntPhoto: vi.fn(),
    getHuntPhotoUrl: vi.fn(() => ''),
  },
  AUTH_TOKEN_KEY: 'lamo-auth-token',
}));

let wsSendSpy: ReturnType<typeof vi.fn>;
let wsOnMessage: ((msg: HuntServerMessage) => void) | undefined;
let wsConnected: boolean;

vi.mock('@/hooks/useHuntWebSocket', () => ({
  useHuntWebSocket: ({ onMessage }: { onMessage?: (msg: HuntServerMessage) => void }) => {
    wsOnMessage = onMessage;
    return { connected: wsConnected, send: wsSendSpy };
  },
}));

import HuntRoom from '../HuntRoom';

// --- Helpers ---

const player = (id: string, username: string) => ({
  id,
  username,
  avatar: { emoji: '🐕', name: 'Dog' },
  connectedAt: 0,
  score: 0,
});

function baseState(overrides: Record<string, unknown> = {}) {
  return {
    id: 'HUNT-1',
    config: {
      name: 'Test Hunt',
      items: [{ id: 'item-1', description: 'A red door', clues: [] }],
      durationMinutes: 30,
      maxRetries: 2,
      minPlayers: 1,
      maxPlayers: 2,
    },
    phase: 'waiting' as const,
    hostId: 'host-1',
    players: [player('host-1', 'TestHost')],
    myProgress: { playerId: 'host-1', totalScore: 120, items: {} },
    timeRemaining: 1800,
    createdAt: 0,
    ...overrides,
  };
}

function renderHuntRoom() {
  return render(
    <MemoryRouter initialEntries={['/hunt/HUNT-1']}>
      <Routes>
        <Route path="/hunt/:huntId" element={<HuntRoom />} />
        <Route path="/groups" element={<div>Groups Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function serverMessage(msg: unknown) {
  act(() => {
    wsOnMessage?.(msg as HuntServerMessage);
  });
}

function sentMessages(): HuntClientMessage[] {
  return wsSendSpy.mock.calls.map((c) => c[0] as HuntClientMessage);
}

beforeEach(() => {
  wsSendSpy = vi.fn(() => true);
  wsConnected = true;
  wsOnMessage = undefined;
  vi.clearAllMocks();
  localStorage.setItem('lamo-trivia-username', 'TestHost');
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

// --- Tests ---

describe('HuntRoom — start_hunt delivery', () => {
  it('keeps the host controls when the start_hunt send is dropped', () => {
    renderHuntRoom();
    serverMessage({ type: 'hunt_state', state: baseState() });

    wsSendSpy.mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: /start hunt/i }));

    // The spinner must not replace Start / Edit Settings / Leave
    expect(screen.queryByText(/starting hunt\.\.\./i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start hunt/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /leave/i })).toBeInTheDocument();
    expect(screen.getByText(/connection lost/i)).toBeInTheDocument();
  });

  it('shows the spinner when the send succeeds, then recovers if no hunt_starting arrives', () => {
    vi.useFakeTimers();
    renderHuntRoom();
    serverMessage({ type: 'hunt_state', state: baseState() });

    fireEvent.click(screen.getByRole('button', { name: /start hunt/i }));
    expect(sentMessages()).toContainEqual({ type: 'start_hunt' });
    expect(screen.getByText(/starting hunt\.\.\./i)).toBeInTheDocument();

    // The server never answers — the host must get their controls back
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(screen.queryByText(/starting hunt\.\.\./i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start hunt/i })).toBeInTheDocument();
    expect(screen.getByText(/could not start the hunt/i)).toBeInTheDocument();
  });

  it('clears the spinner when hunt_starting does arrive', () => {
    renderHuntRoom();
    serverMessage({ type: 'hunt_state', state: baseState() });

    fireEvent.click(screen.getByRole('button', { name: /start hunt/i }));
    serverMessage({ type: 'hunt_starting', countdown: 3 });

    expect(screen.queryByText(/starting hunt\.\.\./i)).not.toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});

describe('HuntRoom — leaving', () => {
  it('sends leave_hunt before navigating away from the waiting room', () => {
    renderHuntRoom();
    serverMessage({ type: 'hunt_state', state: baseState() });

    fireEvent.click(screen.getByRole('button', { name: /^leave$/i }));

    expect(sentMessages()).toContainEqual({ type: 'leave_hunt' });
    expect(screen.getByText('Groups Page')).toBeInTheDocument();
  });

  it('sends leave_hunt from the finished screen', () => {
    renderHuntRoom();
    serverMessage({ type: 'hunt_state', state: baseState({ phase: 'finished' }) });
    serverMessage({
      type: 'hunt_finished',
      results: { rankings: [], itemStats: [], huntId: 'HUNT-1' },
    });

    fireEvent.click(screen.getByRole('button', { name: /back to groups/i }));

    expect(sentMessages()).toContainEqual({ type: 'leave_hunt' });
  });
});

describe('HuntRoom — finished without results', () => {
  it('renders a usable fallback instead of a blank page', () => {
    renderHuntRoom();
    // A hunt_finished lost to a closing socket: the resync carries the phase
    // but never the results
    serverMessage({ type: 'hunt_state', state: baseState({ phase: 'finished' }) });

    expect(screen.getByText(/hunt complete/i)).toBeInTheDocument();
    expect(screen.getByText('120 pts')).toBeInTheDocument();

    const back = screen.getByRole('button', { name: /back to groups/i });
    fireEvent.click(back);
    expect(sentMessages()).toContainEqual({ type: 'leave_hunt' });
    expect(screen.getByText('Groups Page')).toBeInTheDocument();
  });

  it('prefers the real results screen once they arrive', () => {
    renderHuntRoom();
    serverMessage({ type: 'hunt_state', state: baseState({ phase: 'finished' }) });
    serverMessage({
      type: 'hunt_finished',
      results: { rankings: [], itemStats: [], huntId: 'HUNT-1' },
    });

    expect(screen.queryByText(/didn't reach this device/i)).not.toBeInTheDocument();
  });
});

describe('HuntRoom — host dashboard resync', () => {
  it('asks for a resync when the dashboard opens with no roster to show', () => {
    renderHuntRoom();
    // A freshly promoted host: the state was built for the previous host, so it
    // carries no allTeams
    serverMessage({ type: 'hunt_state', state: baseState({ phase: 'playing' }) });
    expect(sentMessages()).not.toContainEqual({ type: 'ping' });

    fireEvent.click(screen.getByRole('button', { name: /host dashboard/i }));

    // Without a ping nothing ever asks for the resync this spinner waits on,
    // so it spins until the host gives up and reloads
    expect(screen.getByText(/loading team progress/i)).toBeInTheDocument();
    expect(sentMessages()).toContainEqual({ type: 'ping' });
  });

  it('does not ping when the roster is already there', () => {
    renderHuntRoom();
    serverMessage({
      type: 'hunt_state',
      state: baseState({
        phase: 'playing',
        allTeams: [
          {
            playerId: 'host-1',
            username: 'TestHost',
            avatar: { emoji: '\u{1F415}', name: 'Dog' },
            totalScore: 0,
            itemsFound: 0,
            totalItems: 1,
            itemStatuses: {},
            totalAttempts: 0,
          },
        ],
      }),
    });

    expect(sentMessages()).not.toContainEqual({ type: 'ping' });
  });
});

