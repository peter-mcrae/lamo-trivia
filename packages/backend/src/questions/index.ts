import type { Question } from '@lamo-trivia/shared';
import { HARRY_POTTER_QUESTIONS } from './harry-potter';

/**
 * All question sets keyed by category ID.
 * Add new categories here as they are created.
 */
const QUESTION_SETS: Record<string, Question[]> = {
  'harry-potter': HARRY_POTTER_QUESTIONS,
};

/** Fetch questions from KV for the given categories, shuffled. */
export async function getQuestions(
  kv: KVNamespace,
  categoryIds: string[],
  count: number,
): Promise<Question[]> {
  const reads = categoryIds.map((id) => kv.get<Question[]>(`questions:${id}`, 'json'));
  const results = await Promise.all(reads);
  const pool = results.flatMap((questions) => questions ?? []);
  return shuffle(pool).slice(0, count);
}

/** Write all question sets and category metadata to KV. */
export async function seedQuestions(kv: KVNamespace): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  for (const [categoryId, questions] of Object.entries(QUESTION_SETS)) {
    await kv.put(`questions:${categoryId}`, JSON.stringify(questions));
    counts[categoryId] = questions.length;
  }

  await kv.put('meta:categories', JSON.stringify(counts));
  return counts;
}

/** Get the question count map from KV metadata. */
export async function getCategoryCounts(
  kv: KVNamespace,
): Promise<Record<string, number>> {
  const counts = await kv.get<Record<string, number>>('meta:categories', 'json');
  return counts ?? {};
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
