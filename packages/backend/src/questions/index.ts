import type { Question } from '@lamo-trivia/shared';

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

/**
 * Write question sets to KV and update category metadata.
 * Accepts a map of categoryId -> Question[] from the caller.
 */
export async function seedQuestions(
  kv: KVNamespace,
  categories: Record<string, Question[]>,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  for (const [categoryId, questions] of Object.entries(categories)) {
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

/** Normalize topic string for consistent KV keys */
function normalizeTopicKey(topic: string): string {
  return topic.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 80);
}

/**
 * Save AI-generated questions to a persistent bank in KV.
 * Appends new questions (deduped by text) so the bank grows over time.
 */
export async function saveAIQuestionsToBank(
  kv: KVNamespace,
  topic: string,
  questions: Question[],
): Promise<void> {
  const topicKey = normalizeTopicKey(topic);
  const kvKey = `ai-bank:${topicKey}`;

  const existing = await kv.get<Question[]>(kvKey, 'json') ?? [];

  // Deduplicate by normalized question text
  const existingTexts = new Set(existing.map((q) => q.text.toLowerCase().trim()));
  const newQuestions = questions.filter((q) => !existingTexts.has(q.text.toLowerCase().trim()));

  if (newQuestions.length === 0) return;

  // Re-ID to avoid collisions with existing bank entries
  const startId = existing.length + 1;
  const toAdd = newQuestions.map((q, i) => ({
    ...q,
    id: `ai-bank-${startId + i}`,
  }));

  await kv.put(kvKey, JSON.stringify([...existing, ...toAdd]));

  // Update topic index (maps normalized key → display name)
  const topicIndex = await kv.get<Record<string, string>>('ai-bank:_topics', 'json') ?? {};
  if (!topicIndex[topicKey]) {
    topicIndex[topicKey] = topic.trim();
    await kv.put('ai-bank:_topics', JSON.stringify(topicIndex));
  }
}

/** Get the list of banked AI topics with question counts. */
export async function getAIQuestionBankTopics(
  kv: KVNamespace,
): Promise<Array<{ key: string; topic: string; questionCount: number }>> {
  const topicIndex = await kv.get<Record<string, string>>('ai-bank:_topics', 'json') ?? {};
  const entries = Object.entries(topicIndex);

  const results = await Promise.all(
    entries.map(async ([key, topic]) => {
      const questions = await kv.get<Question[]>(`ai-bank:${key}`, 'json');
      return { key, topic, questionCount: questions?.length ?? 0 };
    }),
  );

  return results.sort((a, b) => b.questionCount - a.questionCount);
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
