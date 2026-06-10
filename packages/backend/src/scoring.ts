/**
 * Pure scoring function — extracted from GameRoom.endCurrentQuestion()
 * for testability. No side effects, no Durable Object dependencies.
 */

const BASE_POINTS = 1000;
const MAX_SPEED_BONUS_FRACTION = 0.5; // up to +50% of base for instant answers

export interface ScoringInput {
  players: { id: string }[];
  answersThisRound: Record<string, number>;
  /** Timestamp (ms) each answer was submitted — used by speed-bonus scoring */
  answerTimesThisRound?: Record<string, number>;
  correctIndex: number;
  currentScores: Record<string, number>;
  streaks: Record<string, number>;
  scoringMethod: 'speed-bonus' | 'correct-only';
  streakBonus: boolean;
  /** When the question was sent (ms) — used by speed-bonus scoring */
  questionStartedAt?: number;
  /** Time allowed per question in seconds — used by speed-bonus scoring */
  timePerQuestion?: number;
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
      points = BASE_POINTS;

      // Speed bonus: linear bonus up to +50% of base, scaled by fraction of time remaining
      if (input.scoringMethod === 'speed-bonus') {
        const answeredAt = input.answerTimesThisRound?.[playerId];
        const totalMs = (input.timePerQuestion ?? 0) * 1000;
        if (answeredAt !== undefined && input.questionStartedAt !== undefined && totalMs > 0) {
          const elapsed = answeredAt - input.questionStartedAt;
          const fractionRemaining = Math.min(Math.max(1 - elapsed / totalMs, 0), 1);
          points += Math.round(BASE_POINTS * MAX_SPEED_BONUS_FRACTION * fractionRemaining);
        }
      }

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
