export interface Avatar {
  emoji: string;
  name: string;
}

export interface Player {
  id: string;
  username: string;
  avatar: Avatar;
  connectedAt: number;
  score: number;
}

export type ScoringMethod = 'speed-bonus' | 'correct-only';

export interface GameConfig {
  name: string;
  categoryIds: string[];
  questionCount: number;
  minPlayers: number;
  maxPlayers: number;
  timePerQuestion: number;
  scoringMethod: ScoringMethod;
  streakBonus: boolean;
  showAnswers: boolean;
  timeBetweenQuestions: number;
  isPrivate: boolean;
}

export type GamePhase = 'waiting' | 'starting' | 'playing' | 'finished';

export interface Question {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
  categoryId: string;
}

export type ClientQuestion = Omit<Question, 'correctIndex'>;

export interface GameState {
  id: string;
  config: GameConfig;
  phase: GamePhase;
  hostId: string;
  players: Player[];
  currentQuestionIndex: number;
  answers: Record<string, number>;
  scores: Record<string, number>;
  createdAt: number;
  startedAt?: number;
}

export interface GameListing {
  id: string;
  name: string;
  hostUsername: string;
  categoryIds: string[];
  playerCount: number;
  maxPlayers: number;
  scoringMethod: ScoringMethod;
  phase: GamePhase;
}

export interface TriviaCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
  questionCount: number;
}
