import type { TriviaCategory } from './types';

export const GAME_DEFAULTS = {
  questionCount: 10,
  minPlayers: 2,
  maxPlayers: 8,
  timePerQuestion: 15,
  scoringMethod: 'speed-bonus',
  streakBonus: false,
  showAnswers: true,
  timeBetweenQuestions: 5,
} as const;

export const SCORING_METHODS = [
  { id: 'speed-bonus', name: 'Speed Bonus', description: 'Faster correct answers earn more points' },
  { id: 'correct-only', name: 'Correct Only', description: 'Flat points per correct answer, no time pressure' },
] as const;

export const GAME_LIMITS = {
  maxGamesPerLobby: 50,
  maxUsernameLength: 20,
  minUsernameLength: 2,
} as const;

export const TRIVIA_CATEGORIES: TriviaCategory[] = [
  { id: 'harry-potter', name: 'Harry Potter', description: 'The Wizarding World', icon: '⚡', questionCount: 30 },
  { id: 'general', name: 'General Knowledge', description: 'A bit of everything', icon: '🧠', questionCount: 50 },
  { id: 'science', name: 'Science', description: 'Physics, chemistry, biology', icon: '🔬', questionCount: 50 },
  { id: 'history', name: 'History', description: 'World events and people', icon: '📜', questionCount: 50 },
  { id: 'sports', name: 'Sports', description: 'Games, athletes, records', icon: '⚽', questionCount: 50 },
  { id: 'entertainment', name: 'Entertainment', description: 'Movies, music, TV', icon: '🎬', questionCount: 50 },
  { id: 'geography', name: 'Geography', description: 'Countries, capitals, landmarks', icon: '🌍', questionCount: 50 },
];
