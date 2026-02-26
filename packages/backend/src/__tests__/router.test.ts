import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRequest } from '../router';
import { createMockEnv } from './mocks';

describe('Router - Seed endpoint auth', () => {
  it('POST /api/seed without Authorization header returns 401', async () => {
    const env = createMockEnv({ SEED_SECRET: 'my-secret' } as any);
    const request = new Request('http://localhost/api/seed', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const response = await handleRequest(request, env);

    expect(response.status).toBe(401);
    const data = (await response.json()) as any;
    expect(data.error).toBe('Unauthorized');
  });

  it('POST /api/seed with wrong token returns 401', async () => {
    const env = createMockEnv({ SEED_SECRET: 'my-secret' } as any);
    const request = new Request('http://localhost/api/seed', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-token' },
      body: JSON.stringify({}),
    });

    const response = await handleRequest(request, env);

    expect(response.status).toBe(401);
    const data = (await response.json()) as any;
    expect(data.error).toBe('Unauthorized');
  });

  it('POST /api/seed with correct Bearer token returns 200', async () => {
    const env = createMockEnv({ SEED_SECRET: 'my-secret' } as any);
    const seedData = {
      general: [
        {
          id: 'q1',
          text: 'Test question?',
          options: ['A', 'B', 'C', 'D'],
          correctIndex: 0,
          categoryId: 'general',
        },
      ],
    };
    const request = new Request('http://localhost/api/seed', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer my-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(seedData),
    });

    const response = await handleRequest(request, env);

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.seeded).toBe(true);
    expect(data.counts).toEqual({ general: 1 });
  });

  it('POST /api/seed with empty SEED_SECRET env returns 401', async () => {
    const env = createMockEnv({ SEED_SECRET: '' } as any);
    const request = new Request('http://localhost/api/seed', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' },
      body: JSON.stringify({}),
    });

    const response = await handleRequest(request, env);

    expect(response.status).toBe(401);
  });

  it('GET /api/health returns 200 with status ok', async () => {
    const env = createMockEnv();
    const request = new Request('http://localhost/api/health', { method: 'GET' });

    const response = await handleRequest(request, env);

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.status).toBe('ok');
    expect(data.timestamp).toBeDefined();
  });

  it('unknown route returns 404', async () => {
    const env = createMockEnv();
    const request = new Request('http://localhost/api/nonexistent', { method: 'GET' });

    const response = await handleRequest(request, env);

    expect(response.status).toBe(404);
  });
});
