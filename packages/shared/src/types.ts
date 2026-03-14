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
  groupId?: string;
  aiTopic?: string;
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
  questionCount: number;
  playerCount: number;
  minPlayers: number;
  maxPlayers: number;
  timePerQuestion: number;
  scoringMethod: ScoringMethod;
  streakBonus: boolean;
  showAnswers: boolean;
  isPrivate: boolean;
  groupId?: string;
  phase: GamePhase;
  createdAt: number;
  aiTopic?: string;
  gameMode: GameMode;
}

export interface GroupMember {
  memberId?: string;
  username: string;
  joinedAt: number;
  online: boolean;
}

export interface GroupGame {
  gameId: string;
  name: string;
  hostUsername: string;
  playerCount: number;
  maxPlayers: number;
  phase: GamePhase;
  createdAt: number;
  categoryIds: string[];
  aiTopic?: string;
  gameMode: GameMode;
}

export interface GroupState {
  id: string;
  name: string;
  createdAt: number;
  members: GroupMember[];
  games: GroupGame[];
}

export interface TriviaCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
  questionCount: number;
}

// --- Game Mode ---

export type GameMode = 'trivia' | 'scavenger-hunt';

// --- Scavenger Hunt Types ---

export interface HuntClue {
  id: string;
  text: string;
  pointCost: number;
}

export interface HuntItem {
  id: string;
  description: string;
  basePoints: number;
  clues: HuntClue[];
}

export type HuntItemStatus = 'searching' | 'pending_review' | 'found' | 'rejected';

export interface HuntItemProgress {
  itemId: string;
  status: HuntItemStatus;
  cluesRevealed: string[];
  attemptsUsed: number;
  foundAt?: number;
  photoUrl?: string;
  lastRejectedPhotoUrl?: string;
}

export interface HuntPlayerProgress {
  playerId: string;
  items: Record<string, HuntItemProgress>;
  totalScore: number;
}

export interface HuntConfig {
  name: string;
  items: HuntItem[];
  durationMinutes: number;
  maxRetries: number;
  basePointsPerItem: number;
  hintPointCost: number;
  minPlayers: number;
  maxPlayers: number;
  isPrivate: boolean;
  groupId?: string;
}

export interface HuntState {
  id: string;
  config: HuntConfig;
  phase: GamePhase;
  hostId: string;
  players: Player[];
  progress: Record<string, HuntPlayerProgress>;
  createdAt: number;
  startedAt?: number;
  endsAt?: number;
}

export interface HuntTeamSummary {
  playerId: string;
  username: string;
  avatar: Avatar;
  totalScore: number;
  itemsFound: number;
  totalItems: number;
  itemStatuses: Record<string, HuntItemStatus>;
  totalAttempts: number;
}

export interface ClientHuntState {
  id: string;
  config: HuntConfig;
  phase: GamePhase;
  hostId: string;
  players: Player[];
  myProgress: HuntPlayerProgress;
  timeRemaining: number;
  createdAt: number;
  startedAt?: number;
  endsAt?: number;
  allTeams?: HuntTeamSummary[];
}

export interface HuntAppeal {
  playerId: string;
  playerUsername: string;
  itemId: string;
  itemDescription: string;
  photoUrl: string;
  timestamp: number;
  isContest?: boolean;
}

export interface HuntResultsRanking {
  player: Player;
  score: number;
  itemsFound: number;
  totalItems: number;
}

export interface HuntResultsItemDetail {
  itemId: string;
  description: string;
  found: boolean;
  pointsEarned: number;
  cluesUsed: number;
  attempts: number;
}

export interface HuntResults {
  rankings: HuntResultsRanking[];
  itemBreakdown: Record<string, HuntResultsItemDetail[]>;
}

export interface HuntHistorySummary {
  huntId: string;
  name: string;
  hostUsername: string;
  teamCount: number;
  winnerUsername: string;
  winnerScore: number;
  totalItems: number;
  finishedAt: number;
  groupId?: string;
}

// --- Credit System & Auth Types ---

export interface User {
  userId: string;
  email: string;
  credits: number;
  createdAt: number;
  stripeCustomerId?: string;
}

export interface Session {
  userId: string;
  email: string;
  expiresAt: number;
}

export interface MagicCode {
  code: string;
  expiresAt: number;
  attempts: number;
}

export type CreditTransactionType = 'purchase' | 'deduction' | 'refund' | 'admin_credit' | 'admin_debit';

export interface CreditTransaction {
  type: CreditTransactionType;
  amount: number;
  timestamp: number;
  details: string;
  huntId?: string;
  stripeSessionId?: string;
}

export interface HuntHistoryEntry {
  huntId: string;
  config: {
    name: string;
    items: Array<{ id: string; description: string; basePoints: number }>;
    durationMinutes: number;
    maxRetries: number;
    hintPointCost: number;
  };
  hostUsername: string;
  hostSecret: string;
  players: Array<{ id: string; username: string; avatar: Avatar }>;
  results: HuntResults;
  photoKeys: Record<string, Record<string, string>>;
  createdAt: number;
  startedAt: number;
  finishedAt: number;
  groupId?: string;
}
