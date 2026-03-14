import type { Context, Next } from 'hono';
import type { Env } from '../env';

const MAX_RATE_LIMITER_ENTRIES = 10_000;

export class RateLimiter {
  private windows = new Map<string, { count: number; start: number }>();

  constructor(
    private maxRequests: number,
    private windowMs: number = 60_000,
  ) {}

  check(key: string): boolean {
    const now = Date.now();
    const entry = this.windows.get(key);

    if (!entry || now - entry.start > this.windowMs) {
      // Evict stale entries if map is too large
      if (this.windows.size >= MAX_RATE_LIMITER_ENTRIES) {
        for (const [k, v] of this.windows) {
          if (now - v.start > this.windowMs) this.windows.delete(k);
        }
        // If still too large after eviction, clear all
        if (this.windows.size >= MAX_RATE_LIMITER_ENTRIES) this.windows.clear();
      }
      this.windows.set(key, { count: 1, start: now });
      return true;
    }

    entry.count++;
    if (entry.count > this.maxRequests) return false;
    return true;
  }
}

export function getClientIP(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

// Shared rate limiter instances
export const gameCreateLimiter = new RateLimiter(10);       // 10/min per IP
export const groupCreateLimiter = new RateLimiter(5);       // 5/min per IP
export const usernameCheckLimiter = new RateLimiter(20);    // 20/min per IP
export const groupGameLimiter = new RateLimiter(10);        // 10/min per IP
export const photoUploadLimiter = new RateLimiter(20);      // 20/min per IP
export const huntHistoryLimiter = new RateLimiter(30);      // 30/min per IP
export const authCodeLimiter = new RateLimiter(5, 3600_000); // 5/hr per email
export const authVerifyLimiter = new RateLimiter(20);       // 20/min per IP
export const trackingLimiter = new RateLimiter(60);         // 60/min per IP
export const adminLimiter = new RateLimiter(120);           // 120/min per admin email

export function rateLimitedResponse(): Response {
  return Response.json(
    { error: 'Too many requests. Please try again later.' },
    { status: 429 },
  );
}

/** Hono middleware factory for IP-based rate limiting */
export function ipRateLimit(limiter: RateLimiter) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    if (!limiter.check(getClientIP(c.req.raw))) {
      return c.json({ error: 'Too many requests. Please try again later.' }, 429);
    }
    return next();
  };
}
