import type { Env } from './env';

export interface StoredError {
  id: string;
  route: string;
  method: string;
  message: string;
  stack?: string;
  timestamp: number;
  requestMeta?: Record<string, unknown>;
}

const TTL_30_DAYS = 30 * 24 * 60 * 60; // seconds

/**
 * Log an error to console AND persist to KV for admin visibility.
 * Fire-and-forget — never throws.
 */
export function logError(
  env: Env,
  context: { route: string; method: string },
  error: unknown,
  requestMeta?: Record<string, unknown>,
): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  // Always console.error for live tail / wrangler tail
  console.error('Route error', {
    route: context.route,
    method: context.method,
    error: message,
  });

  // Fire-and-forget KV write
  try {
    const now = Date.now();
    const dateStr = new Date(now).toISOString().slice(0, 10);
    const id = crypto.randomUUID().slice(0, 12);
    const key = `error:${dateStr}:${id}`;

    const stored: StoredError = {
      id,
      route: context.route,
      method: context.method,
      message,
      stack,
      timestamp: now,
      requestMeta,
    };

    const metadata = {
      route: context.route,
      method: context.method,
      ts: now,
      msg: message.slice(0, 128),
    };

    env.TRIVIA_KV.put(key, JSON.stringify(stored), {
      expirationTtl: TTL_30_DAYS,
      metadata,
    }).catch(() => {});
  } catch {
    // Never throw from error logger
  }
}
