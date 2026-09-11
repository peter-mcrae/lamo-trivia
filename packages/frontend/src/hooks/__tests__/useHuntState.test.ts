import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { HuntAppeal, HuntServerMessage } from '@lamo-trivia/shared';
import { useHuntState } from '../useHuntState';

const player = (id: string, username: string) => ({
  id,
  username,
  avatar: { emoji: '🐕', name: 'Dog' },
  connectedAt: 0,
  score: 0,
});

const teamSummary = (playerId: string, username: string) => ({
  playerId,
  username,
  avatar: { emoji: '🐕', name: 'Dog' },
  totalScore: 0,
  itemsFound: 0,
  totalItems: 1,
  itemStatuses: {},
  totalAttempts: 0,
});

function huntState(overrides: Record<string, unknown> = {}) {
  return {
    id: 'HUNT-1',
    config: {
      name: 'Test Hunt',
      items: [],
      durationMinutes: 30,
      maxRetries: 2,
      minPlayers: 1,
      maxPlayers: 2,
    },
    phase: 'playing' as const,
    hostId: 'p1',
    players: [player('p1', 'Host'), player('p2', 'Guest')],
    myProgress: {
      playerId: 'p1',
      totalScore: 0,
      items: {
        'item-1': {
          itemId: 'item-1',
          status: 'pending_review' as const,
          cluesRevealed: [],
          attemptsUsed: 1,
        },
      },
    },
    timeRemaining: 600,
    createdAt: 0,
    ...overrides,
  };
}

const appeal = (playerId: string, itemId: string, extra: Partial<HuntAppeal> = {}): HuntAppeal => ({
  playerId,
  playerUsername: 'Guest',
  itemId,
  itemDescription: 'A red door',
  photoUrl: 'https://api.lamotrivia.app/p/1',
  timestamp: 1,
  ...extra,
});

function send(result: { current: ReturnType<typeof useHuntState> }, message: unknown) {
  act(() => {
    result.current.handleMessage(message as HuntServerMessage);
  });
}

describe('useHuntState — appeal queue dedup', () => {
  it('does not duplicate an appeal the server replays on reconnect', () => {
    const { result } = renderHook(() => useHuntState());

    send(result, { type: 'appeal_received', appeal: appeal('p2', 'item-1') });
    expect(result.current.appeals).toHaveLength(1);

    // The server deliberately re-sends the whole pending list on rejoin,
    // transferHost and claim_host
    send(result, { type: 'appeal_received', appeal: appeal('p2', 'item-1') });
    send(result, { type: 'appeal_received', appeal: appeal('p2', 'item-1') });

    expect(result.current.appeals).toHaveLength(1);
  });

  it('keeps the newest copy of a replayed appeal', () => {
    const { result } = renderHook(() => useHuntState());

    send(result, { type: 'appeal_received', appeal: appeal('p2', 'item-1', { timestamp: 1 }) });
    send(result, {
      type: 'appeal_received',
      appeal: appeal('p2', 'item-1', { timestamp: 2, photoUrl: 'https://api.lamotrivia.app/p/2' }),
    });

    expect(result.current.appeals).toHaveLength(1);
    expect(result.current.appeals[0].timestamp).toBe(2);
    expect(result.current.appeals[0].photoUrl).toBe('https://api.lamotrivia.app/p/2');
  });

  it('still keeps distinct appeals apart', () => {
    const { result } = renderHook(() => useHuntState());

    send(result, { type: 'appeal_received', appeal: appeal('p2', 'item-1') });
    send(result, { type: 'appeal_received', appeal: appeal('p2', 'item-2') });
    send(result, { type: 'appeal_received', appeal: appeal('p3', 'item-1') });

    expect(result.current.appeals).toHaveLength(3);
  });
});

describe('useHuntState — allTeams lifecycle', () => {
  it('keeps allTeams while we are host', () => {
    const { result } = renderHook(() => useHuntState());

    send(result, { type: 'hunt_state', state: huntState({ allTeams: [teamSummary('p1', 'Host')] }) });
    expect(result.current.allTeams).toHaveLength(1);

    // A resync that happens to omit the field must not blank the dashboard
    send(result, { type: 'hunt_state', state: huntState() });
    expect(result.current.allTeams).toHaveLength(1);
  });

  it('clears allTeams once the client is no longer host', () => {
    const { result } = renderHook(() => useHuntState());

    send(result, { type: 'hunt_state', state: huntState({ allTeams: [teamSummary('p1', 'Host')] }) });
    expect(result.current.allTeams).toHaveLength(1);

    // Host transferred away — a demoted host must not keep a stale roster
    send(result, { type: 'hunt_state', state: huntState({ hostId: 'p2' }) });
    expect(result.current.allTeams).toBeNull();
  });
});

describe('useHuntState — attemptsUsed guard', () => {
  it('keeps the existing attemptsUsed when appeal_submitted omits it', () => {
    const { result } = renderHook(() => useHuntState());

    send(result, { type: 'hunt_state', state: huntState() });
    send(result, { type: 'appeal_submitted', itemId: 'item-1' });

    // undefined would become NaN and permanently disable the submit button
    expect(result.current.myProgress?.items['item-1'].attemptsUsed).toBe(1);
    expect(result.current.myProgress?.items['item-1'].status).toBe('rejected');
  });

  it('still applies attemptsUsed when the server sends it', () => {
    const { result } = renderHook(() => useHuntState());

    send(result, { type: 'hunt_state', state: huntState() });
    send(result, { type: 'appeal_submitted', itemId: 'item-1', attemptsUsed: 2 });

    expect(result.current.myProgress?.items['item-1'].attemptsUsed).toBe(2);
  });
});

describe('useHuntState — malformed hunt_state', () => {
  it('applies the rest of the state when myProgress is missing', () => {
    const { result } = renderHook(() => useHuntState());

    send(result, { type: 'hunt_state', state: huntState({ allTeams: [teamSummary('p1', 'Host')] }) });

    // A hunt_state that arrives without myProgress used to throw a TypeError
    // inside handleMessage, and the whole update went with it
    expect(() =>
      send(result, { type: 'hunt_state', state: huntState({ myProgress: undefined, hostId: 'p2' }) }),
    ).not.toThrow();

    expect(result.current.huntState?.hostId).toBe('p2');
    expect(result.current.myProgress).toBeNull();
    // The demotion still registered — this is the line that used to be skipped
    expect(result.current.allTeams).toBeNull();
  });
});

