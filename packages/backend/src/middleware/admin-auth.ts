import type { Context, Next } from 'hono';
import type { Env } from '../env';
import { verifyAdminAccess, type AdminIdentity } from '../admin-auth';
import { adminLimiter } from './rate-limit';

/**
 * Hono middleware that verifies admin access (CF Access JWT or SEED_SECRET fallback).
 * Sets `adminIdentity` on the context for downstream handlers.
 */
export async function adminAuthMiddleware(
  c: Context<{ Bindings: Env; Variables: { adminIdentity: AdminIdentity } }>,
  next: Next,
) {
  const admin = await verifyAdminAccess(c.req.raw, c.env);
  if (!admin) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Rate limit all admin requests per admin email
  if (!adminLimiter.check(admin.email)) {
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }

  c.set('adminIdentity', admin);
  return next();
}
