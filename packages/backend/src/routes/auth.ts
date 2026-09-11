import { Hono } from 'hono';
import type { Env } from '../env';
import {
  SendCodeRequestSchema, VerifyCodeRequestSchema,
} from '@lamo-trivia/shared';
import {
  sendMagicCode, verifyMagicCode, createSession, getSessionUser, deleteSession,
  adjustUserCredits,
} from '../auth';
import { acceptInvite } from '../invites';
import type { User } from '@lamo-trivia/shared';
import { getClientIP } from '../middleware/rate-limit';
import { authCodeLimiter, authVerifyLimiter, authVerifyEmailLimiter, rateLimitedResponse } from '../middleware/rate-limit';

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
  // Also limit per email — IP limiting alone is weak against distributed
  // brute force. Both limiters are per-isolate best-effort (see rate-limit.ts).
  if (!authVerifyEmailLimiter.check(parsed.data.email.trim().toLowerCase())) {
    return new Response(rateLimitedResponse().body, rateLimitedResponse());
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

// POST /api/auth/accept-invite
auth.post('/accept-invite', async (c) => {
  const body = (await c.req.json()) as { token?: string };

  if (!body.token || typeof body.token !== 'string') {
    return c.json({ error: 'Invite token is required' }, 400);
  }

  // Validate token format (64-char hex)
  if (!/^[0-9a-f]{64}$/.test(body.token)) {
    return c.json({ error: 'Invalid invite token' }, 400);
  }

  // acceptInvite claims the invite under a lock and marks it used before the
  // grant runs, so concurrent accepts of one token can't each pay out. The
  // idempotency key is the second line of defence: if a duplicate ever did get
  // through, the credits land exactly once anyway.
  let user: User | undefined;
  let isNewUser = false;

  const outcome = await acceptInvite(c.env, body.token, async (invite) => {
    const result = await adjustUserCredits(c.env, invite.email, invite.credits, {
      idempotencyKey: `invite:${invite.token}`,
      createIfMissing: true,
      transaction: {
        type: 'admin_credit',
        amount: invite.credits,
        timestamp: Date.now(),
        details: `Invite credits from ${invite.invitedBy}`,
      },
    });
    user = result.user;
    isNewUser = result.isNewUser;
  });

  if (!outcome.ok) {
    if (outcome.reason === 'not_found') {
      return c.json({ error: 'Invite not found or expired' }, 404);
    }
    if (outcome.reason === 'busy') {
      return c.json({ error: 'This invite is already being processed' }, 409);
    }
    return c.json({ error: 'This invite has already been used' }, 400);
  }

  // Create a session so they're logged in
  const { token: sessionToken } = await createSession(outcome.invite.email, c.env);

  return c.json({ token: sessionToken, user, isNewUser });
});

export { auth as authRoutes };
