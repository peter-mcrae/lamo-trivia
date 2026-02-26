import { describe, it, expect } from 'vitest';
import { UsernameSchema, GameConfigSchema, ClientMessageSchema } from '../schemas';

describe('UsernameSchema', () => {
  it('accepts a valid username like "player1"', () => {
    expect(UsernameSchema.safeParse('player1').success).toBe(true);
  });

  it('accepts exactly 2 characters (min length)', () => {
    expect(UsernameSchema.safeParse('ab').success).toBe(true);
  });

  it('accepts exactly 20 characters (max length)', () => {
    const name = 'a'.repeat(20);
    expect(UsernameSchema.safeParse(name).success).toBe(true);
  });

  it('accepts underscores and hyphens', () => {
    expect(UsernameSchema.safeParse('a_b-c').success).toBe(true);
  });

  it('rejects a single character (too short)', () => {
    const result = UsernameSchema.safeParse('a');
    expect(result.success).toBe(false);
  });

  it('rejects 21 characters (too long)', () => {
    const name = 'a'.repeat(21);
    const result = UsernameSchema.safeParse(name);
    expect(result.success).toBe(false);
  });

  it('rejects username with spaces', () => {
    const result = UsernameSchema.safeParse('player one');
    expect(result.success).toBe(false);
  });

  it('rejects username with special characters', () => {
    const result = UsernameSchema.safeParse('player@1');
    expect(result.success).toBe(false);
  });

  it('rejects empty string', () => {
    const result = UsernameSchema.safeParse('');
    expect(result.success).toBe(false);
  });
});

describe('GameConfigSchema', () => {
  const validConfig = {
    name: 'Test Game',
    categoryIds: ['general'],
    questionCount: 10,
  };

  it('accepts a valid minimal config with one category', () => {
    const result = GameConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('accepts config with aiTopic and empty categoryIds', () => {
    const result = GameConfigSchema.safeParse({
      name: 'AI Game',
      categoryIds: [],
      questionCount: 10,
      aiTopic: 'Space exploration',
    });
    expect(result.success).toBe(true);
  });

  it('rejects config with no categoryIds and no aiTopic', () => {
    const result = GameConfigSchema.safeParse({
      name: 'Bad Game',
      categoryIds: [],
      questionCount: 10,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = GameConfigSchema.safeParse({
      ...validConfig,
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects name longer than 50 characters', () => {
    const result = GameConfigSchema.safeParse({
      ...validConfig,
      name: 'x'.repeat(51),
    });
    expect(result.success).toBe(false);
  });

  it('rejects questionCount less than 5', () => {
    const result = GameConfigSchema.safeParse({
      ...validConfig,
      questionCount: 4,
    });
    expect(result.success).toBe(false);
  });

  it('rejects questionCount greater than 30', () => {
    const result = GameConfigSchema.safeParse({
      ...validConfig,
      questionCount: 31,
    });
    expect(result.success).toBe(false);
  });

  it('rejects timePerQuestion less than 5', () => {
    const result = GameConfigSchema.safeParse({
      ...validConfig,
      timePerQuestion: 4,
    });
    expect(result.success).toBe(false);
  });

  it('rejects timePerQuestion greater than 60', () => {
    const result = GameConfigSchema.safeParse({
      ...validConfig,
      timePerQuestion: 61,
    });
    expect(result.success).toBe(false);
  });

  it('applies correct defaults for optional fields', () => {
    const result = GameConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minPlayers).toBe(1);
      expect(result.data.maxPlayers).toBe(8);
      expect(result.data.timePerQuestion).toBe(15);
      expect(result.data.scoringMethod).toBe('speed-bonus');
      expect(result.data.streakBonus).toBe(false);
      expect(result.data.showAnswers).toBe(true);
      expect(result.data.timeBetweenQuestions).toBe(5);
      expect(result.data.isPrivate).toBe(false);
    }
  });
});

describe('ClientMessageSchema', () => {
  it('accepts a valid join_game message', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'join_game',
      gameId: 'ABCD-1234',
      username: 'player1',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid leave_game message', () => {
    const result = ClientMessageSchema.safeParse({ type: 'leave_game' });
    expect(result.success).toBe(true);
  });

  it('accepts a valid start_game message', () => {
    const result = ClientMessageSchema.safeParse({ type: 'start_game' });
    expect(result.success).toBe(true);
  });

  it('accepts a valid submit_answer message', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'submit_answer',
      questionIndex: 0,
      answerIndex: 2,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid claim_host message', () => {
    const result = ClientMessageSchema.safeParse({ type: 'claim_host' });
    expect(result.success).toBe(true);
  });

  it('accepts a valid rematch message', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'rematch',
      newGameId: 'ABCD-1234',
    });
    expect(result.success).toBe(true);
  });

  it('rejects rematch with empty newGameId', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'rematch',
      newGameId: '',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid ping message', () => {
    const result = ClientMessageSchema.safeParse({ type: 'ping' });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown message type', () => {
    const result = ClientMessageSchema.safeParse({ type: 'unknown_type' });
    expect(result.success).toBe(false);
  });

  it('rejects submit_answer with answerIndex -1', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'submit_answer',
      questionIndex: 0,
      answerIndex: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects submit_answer with answerIndex 4', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'submit_answer',
      questionIndex: 0,
      answerIndex: 4,
    });
    expect(result.success).toBe(false);
  });

  it('rejects submit_answer with float answerIndex', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'submit_answer',
      questionIndex: 0,
      answerIndex: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects submit_answer with questionIndex -1', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'submit_answer',
      questionIndex: -1,
      answerIndex: 0,
    });
    expect(result.success).toBe(false);
  });
});
