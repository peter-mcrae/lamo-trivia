import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logError } from '../errors';
import { createMockEnv } from './mocks';

describe('logError', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('writes error to KV with correct key prefix', () => {
    const env = createMockEnv();
    const putSpy = vi.spyOn(env.TRIVIA_KV, 'put');

    logError(env, { route: '/api/test', method: 'GET' }, new Error('test error'));

    expect(putSpy).toHaveBeenCalledTimes(1);
    const [key] = putSpy.mock.calls[0];
    expect(key).toMatch(/^error:\d{4}-\d{2}-\d{2}:[0-9a-f-]{12}$/);
  });

  it('stores error details as JSON value', () => {
    const env = createMockEnv();
    const putSpy = vi.spyOn(env.TRIVIA_KV, 'put');

    logError(env, { route: '/api/games', method: 'POST' }, new Error('DO failure'));

    const [, value] = putSpy.mock.calls[0];
    const parsed = JSON.parse(value as string);
    expect(parsed.route).toBe('/api/games');
    expect(parsed.method).toBe('POST');
    expect(parsed.message).toBe('DO failure');
    expect(parsed.stack).toContain('DO failure');
    expect(parsed.timestamp).toBeTypeOf('number');
  });

  it('includes request metadata when provided', () => {
    const env = createMockEnv();
    const putSpy = vi.spyOn(env.TRIVIA_KV, 'put');

    logError(
      env,
      { route: '/api/hunts', method: 'POST' },
      new Error('timeout'),
      { ip: '1.2.3.4', userId: 'abc' },
    );

    const [, value] = putSpy.mock.calls[0];
    const parsed = JSON.parse(value as string);
    expect(parsed.requestMeta).toEqual({ ip: '1.2.3.4', userId: 'abc' });
  });

  it('sets 30-day TTL', () => {
    const env = createMockEnv();
    const putSpy = vi.spyOn(env.TRIVIA_KV, 'put');

    logError(env, { route: '/api/test', method: 'GET' }, 'some error');

    const [, , opts] = putSpy.mock.calls[0] as [string, string, any];
    expect(opts.expirationTtl).toBe(30 * 24 * 60 * 60);
  });

  it('includes metadata for KV list operations', () => {
    const env = createMockEnv();
    const putSpy = vi.spyOn(env.TRIVIA_KV, 'put');

    logError(env, { route: '/api/games', method: 'GET' }, new Error('test'));

    const [, , opts] = putSpy.mock.calls[0] as [string, string, any];
    expect(opts.metadata.route).toBe('/api/games');
    expect(opts.metadata.method).toBe('GET');
    expect(opts.metadata.ts).toBeTypeOf('number');
    expect(opts.metadata.msg).toBe('test');
  });

  it('handles non-Error objects gracefully', () => {
    const env = createMockEnv();
    const putSpy = vi.spyOn(env.TRIVIA_KV, 'put');

    logError(env, { route: '/api/test', method: 'GET' }, 'string error');

    const [, value] = putSpy.mock.calls[0];
    const parsed = JSON.parse(value as string);
    expect(parsed.message).toBe('string error');
    expect(parsed.stack).toBeUndefined();
  });

  it('never throws even if KV.put fails', () => {
    const env = createMockEnv();
    vi.spyOn(env.TRIVIA_KV, 'put').mockRejectedValue(new Error('KV down'));

    // Should not throw
    expect(() =>
      logError(env, { route: '/api/test', method: 'GET' }, new Error('test')),
    ).not.toThrow();
  });

  it('truncates long error messages in metadata', () => {
    const env = createMockEnv();
    const putSpy = vi.spyOn(env.TRIVIA_KV, 'put');

    const longMessage = 'x'.repeat(500);
    logError(env, { route: '/api/test', method: 'GET' }, new Error(longMessage));

    const [, , opts] = putSpy.mock.calls[0] as [string, string, any];
    expect(opts.metadata.msg.length).toBe(128);
  });

  it('also calls console.error', () => {
    const env = createMockEnv();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logError(env, { route: '/api/test', method: 'GET' }, new Error('test'));

    expect(consoleSpy).toHaveBeenCalledWith('Route error', expect.objectContaining({
      route: '/api/test',
      method: 'GET',
      error: 'test',
    }));
  });
});
