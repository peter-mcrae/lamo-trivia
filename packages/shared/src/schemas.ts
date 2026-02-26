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
  timePerQuestion: z.number().int().min(5).max(60).default(15),
  scoringMethod: ScoringMethodSchema.default('speed-bonus'),
  streakBonus: z.boolean().default(false),
  showAnswers: z.boolean().default(true),
  timeBetweenQuestions: z.number().int().min(3).max(15).default(5),
  isPrivate: z.boolean().default(false),
  aiTopic: z.string().min(2).max(100).optional(),
}).refine(
  (data) => data.aiTopic || data.categoryIds.length > 0,
  { message: 'Select at least one category or provide an AI topic', path: ['categoryIds'] },
);

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('join_game'), gameId: z.string(), username: z.string() }),
  z.object({ type: z.literal('leave_game') }),
  z.object({ type: z.literal('start_game') }),
  z.object({
    type: z.literal('submit_answer'),
    questionIndex: z.number().int().min(0),
    answerIndex: z.number().int().min(0).max(3),
  }),
  z.object({ type: z.literal('claim_host') }),
  z.object({ type: z.literal('ping') }),
]);

export type GameConfigInput = z.infer<typeof GameConfigSchema>;
