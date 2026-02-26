import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateAIQuestions } from '../questions/ai';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeQuestion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'q1',
    text: 'What is 2+2?',
    options: ['1', '2', '3', '4'],
    correctIndex: 3,
    categoryId: 'math',
    ...overrides,
  };
}

function mockOKResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
  };
}

function mockErrorResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    text: async () => body,
  };
}

describe('generateAIQuestions', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns parsed questions with correct structure from a valid response', async () => {
    const questions = [makeQuestion({ id: 'q1' }), makeQuestion({ id: 'q2' })];
    mockFetch.mockResolvedValue(mockOKResponse(JSON.stringify(questions)));

    const result = await generateAIQuestions('sk-test-key', 'math', 2);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: 'q1',
      text: 'What is 2+2?',
      options: ['1', '2', '3', '4'],
      correctIndex: 3,
    });
  });

  it('strips markdown code fences from the response', async () => {
    const questions = [makeQuestion()];
    const content = '```json\n' + JSON.stringify(questions) + '\n```';
    mockFetch.mockResolvedValue(mockOKResponse(content));

    const result = await generateAIQuestions('sk-test-key', 'trivia', 1);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('What is 2+2?');
  });

  it('throws when OpenAI returns empty content', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '' } }],
      }),
    });

    await expect(generateAIQuestions('sk-test-key', 'trivia', 1)).rejects.toThrow(
      'OpenAI returned empty response',
    );
  });

  it('throws a parse error for invalid JSON content', async () => {
    mockFetch.mockResolvedValue(mockOKResponse('this is not json at all'));

    await expect(generateAIQuestions('sk-test-key', 'trivia', 1)).rejects.toThrow();
  });

  it('throws validation error when required fields are missing', async () => {
    const badQuestion = [{ id: 'q1' }]; // missing text, options, correctIndex
    mockFetch.mockResolvedValue(mockOKResponse(JSON.stringify(badQuestion)));

    await expect(generateAIQuestions('sk-test-key', 'trivia', 1)).rejects.toThrow(
      'Invalid question structure',
    );
  });

  it('throws validation error when correctIndex is out of range', async () => {
    const badQuestion = [makeQuestion({ correctIndex: 5 })];
    mockFetch.mockResolvedValue(mockOKResponse(JSON.stringify(badQuestion)));

    await expect(generateAIQuestions('sk-test-key', 'trivia', 1)).rejects.toThrow(
      'Invalid question structure',
    );
  });

  it('throws validation error when options length is not 4', async () => {
    const badQuestion = [makeQuestion({ options: ['a', 'b'] })];
    mockFetch.mockResolvedValue(mockOKResponse(JSON.stringify(badQuestion)));

    await expect(generateAIQuestions('sk-test-key', 'trivia', 1)).rejects.toThrow(
      'Invalid question structure',
    );
  });

  it('throws a sanitized error on non-200 API response (no raw response text)', async () => {
    mockFetch.mockResolvedValue(
      mockErrorResponse(429, 'Rate limit exceeded: your key sk-abc123 is throttled'),
    );

    await expect(generateAIQuestions('sk-test-key', 'trivia', 1)).rejects.toThrow(
      'AI question generation failed (status 429)',
    );

    // The thrown error message should NOT contain the raw response body
    try {
      await generateAIQuestions('sk-test-key', 'trivia', 1);
    } catch (e: any) {
      expect(e.message).not.toContain('Rate limit exceeded');
      expect(e.message).not.toContain('throttled');
    }
  });

  it('error messages never contain API key prefixes (sk-)', async () => {
    mockFetch.mockResolvedValue(
      mockErrorResponse(401, 'Invalid API key: sk-proj-abc123def456'),
    );

    try {
      await generateAIQuestions('sk-my-secret-key', 'trivia', 1);
    } catch (e: any) {
      expect(e.message).not.toContain('sk-');
    }
  });

  it('sets categoryId to "ai" on all returned questions', async () => {
    const questions = [
      makeQuestion({ id: 'q1', categoryId: 'math' }),
      makeQuestion({ id: 'q2', categoryId: 'science' }),
      makeQuestion({ id: 'q3', categoryId: 'history' }),
    ];
    mockFetch.mockResolvedValue(mockOKResponse(JSON.stringify(questions)));

    const result = await generateAIQuestions('sk-test-key', 'trivia', 3);

    for (const q of result) {
      expect(q.categoryId).toBe('ai');
    }
  });
});
