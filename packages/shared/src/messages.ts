import type {
  GameState, ClientQuestion, Player, GroupState, GroupMember, GroupGame,
  ClientHuntState, HuntItem, HuntAppeal, HuntResults, HuntTeamSummary,
} from './types';

// Client -> Server
export type ClientMessage =
  | { type: 'join_game'; gameId: string; username: string }
  | { type: 'leave_game' }
  | { type: 'start_game' }
  | { type: 'submit_answer'; questionIndex: number; answerIndex: number }
  | { type: 'claim_host' }
  | { type: 'rematch'; newGameId: string }
  | { type: 'ping' };

// Server -> Client
export type ServerMessage =
  | { type: 'game_state'; state: GameState }
  | { type: 'player_joined'; player: Player }
  | { type: 'player_left'; playerId: string; newHostId?: string }
  | { type: 'host_changed'; hostId: string }
  | { type: 'game_starting'; countdown: number }
  | { type: 'question'; question: ClientQuestion; questionIndex: number; totalQuestions: number }
  | { type: 'answer_result'; correct: boolean; correctIndex: number; scores: Record<string, number> }
  | { type: 'game_finished'; finalScores: Record<string, number>; rankings: Player[] }
  | { type: 'rematch'; newGameId: string }
  | { type: 'game_expired'; message: string }
  | { type: 'error'; message: string; code?: string }
  | { type: 'pong' };

// Group Client -> Server
export type GroupClientMessage =
  | { type: 'join_group'; username: string; memberId?: string }
  | { type: 'recover_member'; username: string }
  | { type: 'leave_group' }
  | { type: 'invite_to_game'; gameId: string; gameName: string }
  | { type: 'ping' };

// Group Server -> Client
export type GroupServerMessage =
  | { type: 'join_confirmed'; memberId: string }
  | { type: 'group_state'; state: GroupState }
  | { type: 'member_joined'; member: GroupMember }
  | { type: 'member_left'; username: string }
  | { type: 'member_online'; username: string }
  | { type: 'member_offline'; username: string }
  | { type: 'game_created'; game: GroupGame }
  | { type: 'game_updated'; game: GroupGame }
  | { type: 'game_removed'; gameId: string }
  | { type: 'game_invite'; gameId: string; gameName: string; inviterUsername: string }
  | { type: 'error'; message: string; code?: string }
  | { type: 'pong' };

// --- Scavenger Hunt Messages ---

// Hunt Client -> Server
export type HuntClientMessage =
  | { type: 'join_hunt'; huntId: string; username: string }
  | { type: 'rejoin_hunt'; huntId: string; username: string }
  | { type: 'leave_hunt' }
  | { type: 'start_hunt' }
  | { type: 'reveal_clue'; itemId: string; clueId: string }
  | { type: 'submit_photo'; itemId: string; uploadId: string }
  | { type: 'approve_appeal'; playerId: string; itemId: string }
  | { type: 'reject_appeal'; playerId: string; itemId: string }
  | { type: 'claim_host' }
  | { type: 'contest_photo'; itemId: string }
  | { type: 'send_message'; message: string; targetPlayerId?: string }
  | { type: 'ping' };

// Hunt Server -> Client
export type HuntServerMessage =
  | { type: 'hunt_state'; state: ClientHuntState }
  | { type: 'player_joined'; player: Player }
  | { type: 'player_left'; playerId: string; newHostId?: string }
  | { type: 'host_changed'; hostId: string }
  | { type: 'hunt_starting'; countdown: number }
  | { type: 'hunt_started'; items: HuntItem[]; endsAt: number }
  | { type: 'clue_revealed'; itemId: string; clueId: string; clueText: string; newScore: number }
  | { type: 'photo_verifying'; itemId: string }
  | { type: 'photo_accepted'; itemId: string; pointsEarned: number; newScore: number }
  | { type: 'photo_rejected'; itemId: string; reason: string; attemptsRemaining: number }
  | { type: 'appeal_submitted'; itemId: string }
  | { type: 'appeal_received'; appeal: HuntAppeal }
  | { type: 'appeal_approved'; itemId: string; pointsEarned: number; newScore: number }
  | { type: 'appeal_rejected'; itemId: string; returnToSearching?: boolean }
  | { type: 'teams_updated'; teams: HuntTeamSummary[] }
  | { type: 'hunt_finished'; results: HuntResults }
  | { type: 'hunt_history_saved'; huntId: string; hostSecret: string }
  | { type: 'host_message'; message: string }
  | { type: 'hunt_expired'; message: string }
  | { type: 'time_warning'; secondsRemaining: number }
  | { type: 'credits_deducted'; amount: number; remaining: number }
  | { type: 'error'; message: string; code?: string }
  | { type: 'pong' };
