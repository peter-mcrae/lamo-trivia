import { describe, it, expect } from 'vitest';
import { GROUP_WORD_LIST, generateGroupId } from '../wordlist';

describe('GROUP_WORD_LIST', () => {
  it('contains exactly 1024 words', () => {
    expect(GROUP_WORD_LIST).toHaveLength(1024);
  });

  it('has no duplicate words', () => {
    const unique = new Set(GROUP_WORD_LIST);
    expect(unique.size).toBe(GROUP_WORD_LIST.length);
  });

  it('all words are lowercase non-empty strings', () => {
    for (const word of GROUP_WORD_LIST) {
      expect(typeof word).toBe('string');
      expect(word.length).toBeGreaterThan(0);
      expect(word).toBe(word.toLowerCase());
    }
  });

  it('all words are between 2 and 10 characters', () => {
    for (const word of GROUP_WORD_LIST) {
      expect(word.length).toBeGreaterThanOrEqual(2);
      expect(word.length).toBeLessThanOrEqual(10);
    }
  });
});

describe('generateGroupId', () => {
  it('returns a string of 4 words joined by hyphens', () => {
    const id = generateGroupId();
    const parts = id.split('-');
    expect(parts).toHaveLength(4);
    for (const part of parts) {
      expect(part.length).toBeGreaterThan(0);
    }
  });

  it('uses only words from GROUP_WORD_LIST', () => {
    const wordSet = new Set(GROUP_WORD_LIST);
    for (let i = 0; i < 20; i++) {
      const id = generateGroupId();
      const parts = id.split('-');
      for (const part of parts) {
        expect(wordSet.has(part)).toBe(true);
      }
    }
  });

  it('generates different IDs on consecutive calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add(generateGroupId());
    }
    // With 1024^4 combinations, 50 IDs should all be unique
    expect(ids.size).toBe(50);
  });
});
