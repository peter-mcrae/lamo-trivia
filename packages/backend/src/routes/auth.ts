import { Hono } from 'hono';
import type { Env } from '../env';
import {
  SendCodeRequestSchema, VerifyCodeRequestSchema,
} from '@lamo-trivia/shared';
import {
  sendMagicCode, verifyMagicCode, createSession, getSessionUser, deleteSession,
} from '../auth';
import { getClientIP } from '../middleware/rate-limit';
import { authCodeLimiter, authVerifyLimiter, rateLimitedResponse } from '../middleware/rate-limit';

const auth = new Hono<{ Bindings: Env }>();

// POST /api/auth/send-code
auth.post('/send-code', async (c) => {
  const body = await c.req.json();
  const parsed = SendCodeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  if (!authCodeLimiter.check(parsed.data.email)) {
    return new Response(rateLimitedResponse().body, rateLimitedResponse());
  }
  try {
    await sendMagicCode(parsed.data.email, c.env);
  } catch (err) {
    console.error('send-code error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to send login code. Please try again later.' }, 500);
  }
  return c.json({ ok: true });
});

// POST /api/auth/verify-code
auth.post('/verify-code', async (c) => {
  if (!authVerifyLimiter.check(getClientIP(c.req.raw))) {
    return new Response(rateLimitedResponse().body, rateLimitedResponse());
  }
  const body = await c.req.json();
  const parsed = VerifyCodeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const valid = await verifyMagicCode(parsed.data.email, parsed.data.code, c.env);
  if (!valid) {
    return c.json({ error: 'Invalid or expired code' }, 401);
  }
  const { token, user } = await createSession(parsed.data.email, c.env);
  return c.json({ token, user });
});

// GET /api/auth/me
auth.get('/me', async (c) => {
  const user = await getSessionUser(c.req.raw, c.env);
  return c.json({ user: user ?? null });
});

// POST /api/auth/logout
auth.post('/logout', async (c) => {
  await deleteSession(c.req.raw, c.env);
  return c.json({ ok: true });
});

export { auth as authRoutes };
