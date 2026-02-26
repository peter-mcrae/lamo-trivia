import { describe, it, expect } from 'vitest';
import { TRIVIA_CATEGORIES, AVATARS, GAME_EXPIRY_MS } from '../constants';

describe('TRIVIA_CATEGORIES', () => {
  it('all categories have required fields', () => {
    for (const category of TRIVIA_CATEGORIES) {
      expect(category).toHaveProperty('id');
      expect(category).toHaveProperty('name');
      expect(category).toHaveProperty('icon');
      expect(category).toHaveProperty('questionCount');
      expect(typeof category.id).toBe('string');
      expect(typeof category.name).toBe('string');
      expect(typeof category.icon).toBe('string');
      expect(typeof category.questionCount).toBe('number');
    }
  });

  it('has no duplicate category IDs', () => {
    const ids = TRIVIA_CATEGORIES.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

describe('AVATARS', () => {
  it('all avatars have emoji and name', () => {
    for (const avatar of AVATARS) {
      expect(avatar).toHaveProperty('emoji');
      expect(avatar).toHaveProperty('name');
      expect(typeof avatar.emoji).toBe('string');
      expect(typeof avatar.name).toBe('string');
    }
  });

  it('has no duplicate avatar names', () => {
    const names = AVATARS.map((a) => a.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});

describe('GAME_EXPIRY_MS', () => {
  it('equals 1200000 (20 minutes)', () => {
    expect(GAME_EXPIRY_MS).toBe(1200000);
  });
});
