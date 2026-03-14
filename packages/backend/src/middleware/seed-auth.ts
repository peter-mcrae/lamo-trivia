import type { Context, Next } from 'hono';
import type { Env } from '../env';
import { timingSafeEqual } from '../auth';

/**
 * Hono middleware that verifies Bearer SEED_SECRET for protected endpoints
 * (seed, analytics summary).
 */
export async function seedAuthMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next,
) {
  const authHeader = c.req.header('Authorization');
  const expectedSecret = c.env.SEED_SECRET;

  if (!expectedSecret || !authHeader) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const expectedValue = `Bearer ${expectedSecret}`;
  if (authHeader.length !== expectedValue.length || !(await timingSafeEqual(authHeader, expectedValue))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return next();
}
