import type { GameState, ClientQuestion, Player, GroupState, GroupMember, GroupGame } from './types';

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
  | { type: 'error'; message: string; code?: string }
  | { type: 'pong' };
