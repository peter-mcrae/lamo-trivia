import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getQuestions, seedQuestions, getCategoryCounts } from '../questions';
import { createMockKV } from './mocks';

import type { Question } from '@lamo-trivia/shared';

function makeQuestion(id: string, categoryId: string): Question {
  return {
    id,
    text: `Question ${id}`,
    options: ['A', 'B', 'C', 'D'],
    correctIndex: 0,
    categoryId,
  };
}

describe('getQuestions', () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it('returns questions from a single category', async () => {
    const questions = [makeQuestion('q1', 'science'), makeQuestion('q2', 'science')];
    await kv.put('questions:science', JSON.stringify(questions));

    const result = await getQuestions(kv, ['science'], 10);

    expect(result).toHaveLength(2);
    expect(result.map((q) => q.id).sort()).toEqual(['q1', 'q2']);
  });

  it('merges questions from multiple categories', async () => {
    const scienceQs = [makeQuestion('s1', 'science')];
    const historyQs = [makeQuestion('h1', 'history'), makeQuestion('h2', 'history')];
    await kv.put('questions:science', JSON.stringify(scienceQs));
    await kv.put('questions:history', JSON.stringify(historyQs));

    const result = await getQuestions(kv, ['science', 'history'], 10);

    expect(result).toHaveLength(3);
    const ids = result.map((q) => q.id).sort();
    expect(ids).toEqual(['h1', 'h2', 's1']);
  });

  it('returns empty array for a missing category', async () => {
    const result = await getQuestions(kv, ['nonexistent'], 10);

    expect(result).toEqual([]);
  });

  it('limits results to the requested count', async () => {
    const questions = Array.from({ length: 20 }, (_, i) => makeQuestion(`q${i}`, 'general'));
    await kv.put('questions:general', JSON.stringify(questions));

    const result = await getQuestions(kv, ['general'], 5);

    expect(result).toHaveLength(5);
  });
});

describe('seedQuestions', () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it('writes questions to KV and returns counts', async () => {
    const categories = {
      science: [makeQuestion('s1', 'science'), makeQuestion('s2', 'science')],
      history: [makeQuestion('h1', 'history')],
    };

    const counts = await seedQuestions(kv, categories);

    expect(counts).toEqual({ science: 2, history: 1 });

    // Verify data was written to KV
    const storedScience = await kv.get<Question[]>('questions:science', 'json');
    expect(storedScience).toHaveLength(2);

    const storedHistory = await kv.get<Question[]>('questions:history', 'json');
    expect(storedHistory).toHaveLength(1);
  });

  it('writes meta:categories metadata to KV', async () => {
    const categories = {
      science: [makeQuestion('s1', 'science')],
      history: [makeQuestion('h1', 'history'), makeQuestion('h2', 'history')],
    };

    await seedQuestions(kv, categories);

    const meta = await kv.get<Record<string, number>>('meta:categories', 'json');
    expect(meta).toEqual({ science: 1, history: 2 });
  });
});

describe('getCategoryCounts', () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it('returns stored metadata', async () => {
    await kv.put('meta:categories', JSON.stringify({ science: 10, history: 5 }));

    const counts = await getCategoryCounts(kv);

    expect(counts).toEqual({ science: 10, history: 5 });
  });

  it('returns empty object when no metadata exists', async () => {
    const counts = await getCategoryCounts(kv);

    expect(counts).toEqual({});
  });
});
