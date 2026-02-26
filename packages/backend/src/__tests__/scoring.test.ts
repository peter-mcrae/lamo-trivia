import { describe, it, expect } from 'vitest';
import { calculateRoundScores, type ScoringInput } from '../scoring';

function makeInput(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    players: [{ id: 'p1' }],
    answersThisRound: {},
    correctIndex: 2,
    currentScores: { p1: 0 },
    streaks: { p1: 0 },
    scoringMethod: 'correct-only',
    streakBonus: false,
    ...overrides,
  };
}

describe('calculateRoundScores', () => {
  // --- Basic scoring ---

  it('awards 1000 points for a correct answer', () => {
    const result = calculateRoundScores(
      makeInput({ answersThisRound: { p1: 2 } }),
    );
    expect(result.scores.p1).toBe(1000);
    expect(result.pointsThisRound.p1).toBe(1000);
  });

  it('awards 0 points for a wrong answer', () => {
    const result = calculateRoundScores(
      makeInput({ answersThisRound: { p1: 0 } }),
    );
    expect(result.scores.p1).toBe(0);
    expect(result.pointsThisRound.p1).toBe(0);
  });

  it('awards 0 points when player did not answer', () => {
    const result = calculateRoundScores(makeInput());
    expect(result.scores.p1).toBe(0);
    expect(result.pointsThisRound.p1).toBe(0);
  });

  it('accumulates scores across rounds', () => {
    const result = calculateRoundScores(
      makeInput({
        answersThisRound: { p1: 2 },
        currentScores: { p1: 3000 },
      }),
    );
    expect(result.scores.p1).toBe(4000);
  });

  // --- Multiple players ---

  it('scores multiple players independently', () => {
    const result = calculateRoundScores(
      makeInput({
        players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
        answersThisRound: { p1: 2, p2: 0, p3: 2 },
        currentScores: { p1: 0, p2: 0, p3: 0 },
        streaks: { p1: 0, p2: 0, p3: 0 },
      }),
    );
    expect(result.scores.p1).toBe(1000);
    expect(result.scores.p2).toBe(0);
    expect(result.scores.p3).toBe(1000);
  });

  // --- Streak bonus disabled ---

  it('gives flat 1000 per correct with streak bonus disabled', () => {
    const result = calculateRoundScores(
      makeInput({
        answersThisRound: { p1: 2 },
        streaks: { p1: 5 }, // high streak but bonus disabled
        streakBonus: false,
      }),
    );
    expect(result.pointsThisRound.p1).toBe(1000);
  });

  // --- Streak bonus enabled ---

  it('awards 1000 (x1) for first correct in streak', () => {
    const result = calculateRoundScores(
      makeInput({
        answersThisRound: { p1: 2 },
        streaks: { p1: 0 },
        streakBonus: true,
      }),
    );
    // streak becomes 1 => multiplier = min(1, 3) = 1
    expect(result.pointsThisRound.p1).toBe(1000);
    expect(result.streaks.p1).toBe(1);
  });

  it('awards 2000 (x2) for second consecutive correct', () => {
    const result = calculateRoundScores(
      makeInput({
        answersThisRound: { p1: 2 },
        streaks: { p1: 1 }, // already 1 streak going in
        streakBonus: true,
      }),
    );
    // streak becomes 2 => multiplier = min(2, 3) = 2
    expect(result.pointsThisRound.p1).toBe(2000);
    expect(result.streaks.p1).toBe(2);
  });

  it('awards 3000 (x3 max) for third and beyond consecutive correct', () => {
    const result = calculateRoundScores(
      makeInput({
        answersThisRound: { p1: 2 },
        streaks: { p1: 2 },
        streakBonus: true,
      }),
    );
    expect(result.pointsThisRound.p1).toBe(3000);
    expect(result.streaks.p1).toBe(3);
  });

  it('caps streak multiplier at 3', () => {
    const result = calculateRoundScores(
      makeInput({
        answersThisRound: { p1: 2 },
        streaks: { p1: 10 }, // way past 3
        streakBonus: true,
      }),
    );
    // multiplier = min(11, 3) = 3
    expect(result.pointsThisRound.p1).toBe(3000);
  });

  it('resets streak to 0 on wrong answer', () => {
    const result = calculateRoundScores(
      makeInput({
        answersThisRound: { p1: 0 }, // wrong
        streaks: { p1: 5 },
        streakBonus: true,
      }),
    );
    expect(result.streaks.p1).toBe(0);
    expect(result.pointsThisRound.p1).toBe(0);
  });

  it('resets streak to 0 when player does not answer', () => {
    const result = calculateRoundScores(
      makeInput({
        answersThisRound: {}, // no answer
        streaks: { p1: 3 },
        streakBonus: true,
      }),
    );
    expect(result.streaks.p1).toBe(0);
  });

  // --- Speed-bonus scoring method ---

  it('speed-bonus method gives same 1000 base as correct-only', () => {
    const result = calculateRoundScores(
      makeInput({
        answersThisRound: { p1: 2 },
        scoringMethod: 'speed-bonus',
      }),
    );
    expect(result.pointsThisRound.p1).toBe(1000);
  });
});
