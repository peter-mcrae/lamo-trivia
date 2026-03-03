import type { Question } from '@lamo-trivia/shared';

interface OpenAIChatResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

/** Strip characters that could be used for prompt injection */
function sanitizeTopic(raw: string): string {
  return raw
    .replace(/[\n\r\t`]/g, ' ')         // Remove newlines, tabs, backticks
    .replace(/[^\x20-\x7E\u00A0-\uFFFF]/g, '') // Strip control characters
    .replace(/\s+/g, ' ')               // Collapse whitespace
    .trim();
}

export async function generateAIQuestions(
  apiKey: string,
  topic: string,
  count: number,
): Promise<Question[]> {
  const safeTopic = sanitizeTopic(topic);
  const prompt = `Generate exactly ${count} multiple-choice trivia questions about "${safeTopic}".

Return a JSON array where each object has:
- "id": a unique string like "ai-1", "ai-2", etc.
- "text": the question text
- "options": an array of exactly 4 answer strings
- "correctIndex": the index (0-3) of the correct answer
- "categoryId": "ai"

Rules:
- Questions should be suitable for a family audience (ages 8+)
- Questions should range from easy to hard
- All 4 options must be plausible
- Only one option should be correct
- Randomize the position of the correct answer
- Do not repeat questions
- Return ONLY valid JSON, no markdown, no explanation`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a trivia question generator. You always respond with valid JSON arrays only. No markdown, no code fences, no explanation.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.8,
      max_tokens: 4096,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    // Log full error server-side (visible in Workers logs) but never expose to client
    console.error(`OpenAI API error (${response.status}): ${errorText}`);
    throw new Error('AI question generation failed — please try again');
  }

  const data = (await response.json()) as OpenAIChatResponse;
  const content = data.choices[0]?.message?.content?.trim();

  if (!content) {
    throw new Error('OpenAI returned empty response');
  }

  // Strip markdown code fences if present
  const cleaned = content.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
  let questions: Question[];
  try {
    questions = JSON.parse(cleaned);
  } catch {
    console.error('OpenAI returned invalid JSON', { topic, response: cleaned.slice(0, 500) });
    throw new Error('AI returned malformed JSON — please try again');
  }

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('OpenAI returned invalid question format');
  }

  // Validate each question
  for (const q of questions) {
    if (
      typeof q.id !== 'string' ||
      typeof q.text !== 'string' ||
      !Array.isArray(q.options) ||
      q.options.length !== 4 ||
      typeof q.correctIndex !== 'number' ||
      q.correctIndex < 0 ||
      q.correctIndex > 3
    ) {
      console.error('Invalid AI question structure', { topic: safeTopic, question: q });
      throw new Error('AI returned invalid question format — please try again');
    }
    q.categoryId = 'ai';
  }

  return questions;
}
