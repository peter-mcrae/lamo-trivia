import type { Avatar, TriviaCategory } from './types';

export const GAME_DEFAULTS = {
  questionCount: 10,
  minPlayers: 1,
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

export const GAME_EXPIRY_MS = 20 * 60 * 1000; // 20 minutes

// Player avatars — randomly assigned on join, unique per game
export const AVATARS: Avatar[] = [
  // Dog breeds
  { emoji: '🐕', name: 'Golden Retriever' },
  { emoji: '🐩', name: 'Poodle' },
  { emoji: '🦮', name: 'Labrador' },
  { emoji: '🐶', name: 'Beagle' },
  { emoji: '🐺', name: 'Husky' },
  { emoji: '🦊', name: 'Shiba Inu' },
  { emoji: '🐾', name: 'Bulldog' },
  { emoji: '🐕‍🦺', name: 'German Shepherd' },
  { emoji: '🐻', name: 'Bernese' },
  { emoji: '🦴', name: 'Dalmatian' },
  { emoji: '🧡', name: 'Corgi' },
  { emoji: '🐿️', name: 'Chihuahua' },
  { emoji: '🐗', name: 'Boxer' },
  { emoji: '🦁', name: 'Chow Chow' },
  { emoji: '🤍', name: 'Samoyed' },
  // Harry Potter characters
  { emoji: '⚡', name: 'Harry' },
  { emoji: '📚', name: 'Hermione' },
  { emoji: '♟️', name: 'Ron' },
  { emoji: '🧙', name: 'Dumbledore' },
  { emoji: '🐍', name: 'Voldemort' },
  { emoji: '🖤', name: 'Snape' },
  { emoji: '🌕', name: 'Lupin' },
  { emoji: '⭐', name: 'Sirius' },
  { emoji: '🧹', name: 'Ginny' },
  { emoji: '🐉', name: 'Hagrid' },
  { emoji: '🦅', name: 'McGonagall' },
  { emoji: '🌿', name: 'Neville' },
  { emoji: '🦉', name: 'Hedwig' },
  { emoji: '🧦', name: 'Dobby' },
  { emoji: '🔮', name: 'Luna' },
];

export const TRIVIA_CATEGORIES: TriviaCategory[] = [
  { id: 'harry-potter', name: 'Harry Potter', description: 'The Wizarding World', icon: '⚡', questionCount: 30 },
  { id: 'general', name: 'General Knowledge', description: 'A bit of everything', icon: '🧠', questionCount: 50 },
  { id: 'science', name: 'Science', description: 'Physics, chemistry, biology', icon: '🔬', questionCount: 50 },
  { id: 'history', name: 'History', description: 'World events and people', icon: '📜', questionCount: 50 },
  { id: 'sports', name: 'Sports', description: 'Games, athletes, records', icon: '⚽', questionCount: 50 },
  { id: 'entertainment', name: 'Entertainment', description: 'Movies, music, TV', icon: '🎬', questionCount: 50 },
  { id: 'geography', name: 'Geography', description: 'Countries, capitals, landmarks', icon: '🌍', questionCount: 50 },
  { id: 'math', name: 'Math', description: 'Multiplication times tables', icon: '✖️', questionCount: 50 },
];
