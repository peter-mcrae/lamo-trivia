import { z } from 'zod';

export const UsernameSchema = z
  .string()
  .min(2, 'Username must be at least 2 characters')
  .max(20, 'Username must be at most 20 characters')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Only letters, numbers, hyphens, and underscores');

export const ScoringMethodSchema = z.enum(['speed-bonus', 'correct-only']);

export const GameConfigSchema = z.object({
  name: z.string().min(1).max(50),
  categoryIds: z.array(z.string().min(1)),
  questionCount: z.number().int().min(5).max(30),
  minPlayers: z.number().int().min(1).max(8).default(1),
  maxPlayers: z.number().int().min(2).max(12).default(8),
  timePerQuestion: z.number().int().min(1).max(60).default(15),
  scoringMethod: ScoringMethodSchema.default('speed-bonus'),
  streakBonus: z.boolean().default(false),
  showAnswers: z.boolean().default(true),
  timeBetweenQuestions: z.number().int().min(1).max(15).default(5),
  isPrivate: z.boolean().default(false),
  groupId: z.string().min(1).optional(),
  aiTopic: z.string().min(2).max(100).optional(),
}).refine(
  (data) => data.aiTopic || data.categoryIds.length > 0,
  { message: 'Select at least one category or provide an AI topic', path: ['categoryIds'] },
).refine(
  (data) => data.minPlayers <= data.maxPlayers,
  { message: 'Min players must be less than or equal to max players', path: ['minPlayers'] },
);

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('join_game'), gameId: z.string(), username: UsernameSchema }),
  z.object({ type: z.literal('rejoin_game'), gameId: z.string(), username: UsernameSchema }),
  z.object({ type: z.literal('leave_game') }),
  z.object({ type: z.literal('start_game') }),
  z.object({
    type: z.literal('submit_answer'),
    questionIndex: z.number().int().min(0),
    answerIndex: z.number().int().min(0).max(3),
  }),
  z.object({ type: z.literal('claim_host') }),
  z.object({ type: z.literal('rematch'), newGameId: z.string().min(1) }),
  z.object({ type: z.literal('ping') }),
]);

export type GameConfigInput = z.infer<typeof GameConfigSchema>;

export const GroupNameSchema = z.string().min(1).max(50);

export const GroupClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('join_group'), username: UsernameSchema, memberId: z.string().uuid().optional() }),
  z.object({ type: z.literal('recover_member'), username: UsernameSchema }),
  z.object({ type: z.literal('leave_group') }),
  z.object({ type: z.literal('invite_to_game'), gameId: z.string().min(1), gameName: z.string().min(1).max(50) }),
  z.object({ type: z.literal('ping') }),
]);

// --- Scavenger Hunt Schemas ---

export const HuntClueSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(200),
  pointCost: z.number().int().min(0).max(500).default(200),
});

export const HuntItemSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1).max(300),
  basePoints: z.number().int().min(100).max(5000).default(1000),
  clues: z.array(HuntClueSchema).max(3).default([]),
});

export const HuntConfigSchema = z.object({
  name: z.string().min(1).max(50),
  items: z.array(HuntItemSchema).min(1).max(15),
  durationMinutes: z.number().int().min(5).max(60).default(30),
  maxRetries: z.number().int().min(1).max(5).default(2),
  basePointsPerItem: z.number().int().min(100).max(5000).default(1000),
  hintPointCost: z.number().int().min(0).max(500).default(200),
  minPlayers: z.number().int().min(1).max(8).default(1),
  maxPlayers: z.number().int().min(2).max(12).default(2),
  isPrivate: z.boolean().default(false),
  groupId: z.string().min(1).optional(),
}).refine(
  (data) => data.minPlayers <= data.maxPlayers,
  { message: 'Min players must be less than or equal to max players', path: ['minPlayers'] },
);

export type HuntConfigInput = z.infer<typeof HuntConfigSchema>;

// --- Auth Schemas ---

export const EmailSchema = z.string().email('Invalid email address').max(254);

export const MagicCodeSchema = z.string().length(6).regex(/^\d{6}$/, 'Code must be 6 digits');

export const SendCodeRequestSchema = z.object({
  email: EmailSchema,
});

export const VerifyCodeRequestSchema = z.object({
  email: EmailSchema,
  code: MagicCodeSchema,
});

export const HuntClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('join_hunt'), huntId: z.string(), username: UsernameSchema }),
  z.object({ type: z.literal('rejoin_hunt'), huntId: z.string(), username: UsernameSchema }),
  z.object({ type: z.literal('leave_hunt') }),
  z.object({ type: z.literal('start_hunt') }),
  z.object({ type: z.literal('reveal_clue'), itemId: z.string(), clueId: z.string() }),
  z.object({ type: z.literal('submit_photo'), itemId: z.string(), uploadId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/, 'Invalid upload ID format') }),
  z.object({ type: z.literal('approve_appeal'), playerId: z.string(), itemId: z.string() }),
  z.object({ type: z.literal('reject_appeal'), playerId: z.string(), itemId: z.string() }),
  z.object({ type: z.literal('contest_photo'), itemId: z.string() }),
  z.object({ type: z.literal('claim_host') }),
  z.object({ type: z.literal('send_message'), message: z.string().min(1).max(200), targetPlayerId: z.string().optional() }),
  z.object({ type: z.literal('ping') }),
]);
