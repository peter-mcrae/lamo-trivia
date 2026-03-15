import { Hono } from 'hono';
import type { Env } from '../env';
import {
  SendCodeRequestSchema, VerifyCodeRequestSchema,
} from '@lamo-trivia/shared';
import {
  sendMagicCode, verifyMagicCode, createSession, getSessionUser, deleteSession,
  getUser, updateUser, addCreditTransaction,
} from '../auth';
import { getInvite, markInviteAccepted } from '../invites';
import type { User, CreditTransaction } from '@lamo-trivia/shared';
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

  const invite = await getInvite(c.env, body.token);
  if (!invite) {
    return c.json({ error: 'Invite not found or expired' }, 404);
  }

  if (invite.acceptedAt) {
    return c.json({ error: 'This invite has already been used' }, 400);
  }

  // Check if user already exists
  let user = await getUser(invite.email, c.env);
  const isNewUser = !user;

  if (!user) {
    // Create the user with invite credits
    user = {
      userId: crypto.randomUUID(),
      email: invite.email,
      credits: invite.credits,
      createdAt: Date.now(),
    };
    await c.env.TRIVIA_KV.put(`user:${invite.email}`, JSON.stringify(user));
  } else {
    // Existing user — still give them the credits
    user.credits += invite.credits;
    await updateUser(user, c.env);
  }

  // Record the credit transaction
  const transaction: CreditTransaction = {
    type: 'admin_credit',
    amount: invite.credits,
    timestamp: Date.now(),
    details: `Invite credits from ${invite.invitedBy}`,
  };
  await addCreditTransaction(user.userId, transaction, c.env);

  // Mark invite as used
  await markInviteAccepted(c.env, invite);

  // Create a session so they're logged in
  const { token: sessionToken } = await createSession(invite.email, c.env);

  return c.json({ token: sessionToken, user, isNewUser });
});

export { auth as authRoutes };
