/**
 * Pure scoring function — extracted from GameRoom.endCurrentQuestion()
 * for testability. No side effects, no Durable Object dependencies.
 */

export interface ScoringInput {
  players: { id: string }[];
  answersThisRound: Record<string, number>;
  correctIndex: number;
  currentScores: Record<string, number>;
  streaks: Record<string, number>;
  scoringMethod: 'speed-bonus' | 'correct-only';
  streakBonus: boolean;
}

export interface ScoringResult {
  scores: Record<string, number>;
  streaks: Record<string, number>;
  /** Points earned this round per player */
  pointsThisRound: Record<string, number>;
}

export function calculateRoundScores(input: ScoringInput): ScoringResult {
  const scores = { ...input.currentScores };
  const streaks = { ...input.streaks };
  const pointsThisRound: Record<string, number> = {};

  for (const player of input.players) {
    const playerId = player.id;
    const answerIndex = input.answersThisRound[playerId];
    const answered = playerId in input.answersThisRound;
    const correct = answered && answerIndex === input.correctIndex;

    let points = 0;
    if (correct) {
      // Base points — both scoring methods give 1000 base
      // (speed-bonus would differentiate with real-time tracking, but with
      // deferred scoring everyone gets the same base)
      points = 1000;

      // Streak bonus
      streaks[playerId] = (streaks[playerId] || 0) + 1;
      if (input.streakBonus) {
        const multiplier = Math.min(streaks[playerId], 3);
        points = points * multiplier;
      }
    } else {
      streaks[playerId] = 0;
    }

    scores[playerId] = (scores[playerId] || 0) + points;
    pointsThisRound[playerId] = points;
  }

  return { scores, streaks, pointsThisRound };
}
