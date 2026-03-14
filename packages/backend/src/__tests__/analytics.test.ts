import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logEvent } from '../analytics';
import { createMockEnv } from './mocks';

describe('logEvent', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('writes event to KV with correct key prefix', async () => {
    const env = createMockEnv();
    const putSpy = vi.spyOn(env.TRIVIA_KV, 'put');

    await logEvent(env, 'game_started', { gameId: 'test-123', playerCount: 4 });

    expect(putSpy).toHaveBeenCalledTimes(1);
    const [key] = putSpy.mock.calls[0];
    expect(key).toMatch(/^evt:game_started:\d{4}-\d{2}-\d{2}:[0-9a-f]{8}$/);
  });

  it('stores event data as JSON value', async () => {
    const env = createMockEnv();
    const putSpy = vi.spyOn(env.TRIVIA_KV, 'put');

    await logEvent(env, 'hunt_finished', { huntId: 'hunt-abc', playerCount: 3 });

    const [, value] = putSpy.mock.calls[0];
    const parsed = JSON.parse(value as string);
    expect(parsed.type).toBe('hunt_finished');
    expect(parsed.data.huntId).toBe('hunt-abc');
    expect(parsed.data.playerCount).toBe(3);
    expect(parsed.timestamp).toBeTypeOf('number');
  });

  it('includes metadata summary for game events', async () => {
    const env = createMockEnv();
    const putSpy = vi.spyOn(env.TRIVIA_KV, 'put');

    await logEvent(env, 'game_finished', {
      gameId: 'game-456',
      gameMode: 'trivia',
      playerCount: 5,
    });

    const [, , opts] = putSpy.mock.calls[0] as [string, string, any];
    expect(opts.metadata).toBeDefined();
    expect(opts.metadata.type).toBe('game_finished');
    expect(opts.metadata.gameId).toBe('game-456');
    expect(opts.metadata.mode).toBe('trivia');
    expect(opts.metadata.players).toBe(5);
    expect(opts.metadata.ts).toBeTypeOf('number');
  });

  it('includes metadata summary for photo_verified events', async () => {
    const env = createMockEnv();
    const putSpy = vi.spyOn(env.TRIVIA_KV, 'put');

    await logEvent(env, 'photo_verified', {
      model: 'claude-sonnet-4-20250514',
      accepted: true,
      latencyMs: 1200,
    });

    const [, , opts] = putSpy.mock.calls[0] as [string, string, any];
    expect(opts.metadata.type).toBe('photo_verified');
    expect(opts.metadata.model).toBe('claude-sonnet-4-20250514');
    expect(opts.metadata.accepted).toBe(true);
    expect(opts.metadata.ms).toBe(1200);
  });

  it('includes metadata summary for vision_comparison events', async () => {
    const env = createMockEnv();
    const putSpy = vi.spyOn(env.TRIVIA_KV, 'put');

    await logEvent(env, 'vision_comparison', {
      agreement: false,
      sonnetLatencyMs: 1500,
      haikuLatencyMs: 800,
    });

    const [, , opts] = putSpy.mock.calls[0] as [string, string, any];
    expect(opts.metadata.type).toBe('vision_comparison');
    expect(opts.metadata.agree).toBe(false);
    expect(opts.metadata.sMs).toBe(1500);
    expect(opts.metadata.hMs).toBe(800);
  });

  it('sets 180-day TTL', async () => {
    const env = createMockEnv();
    const putSpy = vi.spyOn(env.TRIVIA_KV, 'put');

    await logEvent(env, 'game_created', { gameId: 'test' });

    const [, , opts] = putSpy.mock.calls[0] as [string, string, any];
    expect(opts.expirationTtl).toBe(180 * 24 * 60 * 60);
  });

  it('never throws even if KV.put fails', async () => {
    const env = createMockEnv();
    vi.spyOn(env.TRIVIA_KV, 'put').mockRejectedValue(new Error('KV down'));

    // Should not throw
    await expect(
      logEvent(env, 'game_finished', { gameId: 'test-456' }),
    ).resolves.toBeUndefined();
  });

  it('never throws even if crypto.randomUUID fails', async () => {
    const env = createMockEnv();
    const original = crypto.randomUUID;
    vi.stubGlobal('crypto', {
      ...crypto,
      randomUUID: () => { throw new Error('crypto broke'); },
    });

    await expect(
      logEvent(env, 'game_created', { gameId: 'test' }),
    ).resolves.toBeUndefined();

    vi.stubGlobal('crypto', { ...crypto, randomUUID: original });
  });
});
