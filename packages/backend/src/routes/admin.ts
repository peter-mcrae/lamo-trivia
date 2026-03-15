import { Hono } from 'hono';
import type { Env } from '../env';
import type { AdminIdentity } from '../admin-auth';
import type { User, CreditTransaction } from '@lamo-trivia/shared';
import { getUser, updateUser, getCreditTransactions, addCreditTransaction } from '../auth';
import {
  createCoupon, listCoupons, getCoupon, deleteCoupon,
  sendCouponEmail, isValidCouponCode,
} from '../coupons';
import { createInvite, sendInviteEmail } from '../invites';
import { adminAuthMiddleware } from '../middleware/admin-auth';

// --- Input validation helpers ---

function isValidEmailParam(email: string): boolean {
  return /^[a-zA-Z0-9@._+\-]{1,254}$/.test(email);
}

function isValidSearch(search: string): boolean {
  return /^[a-zA-Z0-9@._+\-]{0,200}$/.test(search);
}

function isValidSessionToken(token: string): boolean {
  return /^[0-9a-f]{64}$/.test(token);
}

const VALID_EVENT_TYPES = new Set([
  'game_created', 'game_started', 'game_finished',
  'hunt_created', 'hunt_started', 'hunt_finished',
  'photo_verified', 'vision_comparison',
]);

function isValidDateParam(date: string): boolean {
  return /^\d{4}-\d{2}(-\d{2})?$/.test(date);
}

const MAX_CREDIT_ADJUSTMENT = 1_000_000;
const MAX_KV_PAGES = 20;

const admin = new Hono<{ Bindings: Env; Variables: { adminIdentity: AdminIdentity } }>();

// All admin routes require authentication
admin.use('*', adminAuthMiddleware);

// GET /api/admin/users
admin.get('/users', async (c) => {
  const search = c.req.query('search') || '';
  const cursor = c.req.query('cursor') || undefined;
  const limit = Math.min(Number(c.req.query('limit')) || 50, 100);

  if (search && !isValidSearch(search)) {
    return c.json({ error: 'Invalid search parameter' }, 400);
  }

  const prefix = search ? `user:${search.toLowerCase()}` : 'user:';

  const listResult = await c.env.TRIVIA_KV.list({ prefix, limit, cursor });

  const users: Array<User & { transactionCount: number }> = [];
  for (const key of listResult.keys) {
    const raw = await c.env.TRIVIA_KV.get(key.name);
    if (raw) {
      try {
        const user = JSON.parse(raw) as User;
        const txRaw = await c.env.TRIVIA_KV.get(`transactions:${user.userId}`);
        const txCount = txRaw ? (JSON.parse(txRaw) as unknown[]).length : 0;
        users.push({ ...user, transactionCount: txCount });
      } catch { /* skip malformed */ }
    }
  }

  return c.json({
    users,
    cursor: listResult.list_complete ? null : listResult.cursor,
    complete: listResult.list_complete,
  });
});

// GET /api/admin/users/:email
admin.get('/users/:email', async (c) => {
  const email = decodeURIComponent(c.req.param('email'));
  if (!isValidEmailParam(email)) {
    return c.json({ error: 'Invalid email parameter' }, 400);
  }

  const user = await getUser(email, c.env);
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  const transactions = await getCreditTransactions(user.userId, c.env);
  return c.json({ user, transactions });
});

// POST /api/admin/users/:email/credits
admin.post('/users/:email/credits', async (c) => {
  const email = decodeURIComponent(c.req.param('email'));
  if (!isValidEmailParam(email)) {
    return c.json({ error: 'Invalid email parameter' }, 400);
  }

  const adminIdentity = c.get('adminIdentity');
  const body = (await c.req.json()) as { amount?: number; reason?: string };

  if (typeof body.amount !== 'number' || !Number.isInteger(body.amount) || body.amount === 0) {
    return c.json({ error: 'amount must be a non-zero integer' }, 400);
  }
  if (Math.abs(body.amount) > MAX_CREDIT_ADJUSTMENT) {
    return c.json(
      { error: `amount must be between -${MAX_CREDIT_ADJUSTMENT} and ${MAX_CREDIT_ADJUSTMENT}` },
      400,
    );
  }
  if (!body.reason || typeof body.reason !== 'string' || body.reason.trim().length === 0) {
    return c.json({ error: 'reason is required' }, 400);
  }
  if (body.reason.length > 500) {
    return c.json({ error: 'reason must be 500 characters or fewer' }, 400);
  }

  const user = await getUser(email, c.env);
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  const newBalance = user.credits + body.amount;
  if (newBalance < 0) {
    return c.json(
      { error: `Adjustment would result in negative balance (${newBalance})` },
      400,
    );
  }

  user.credits = newBalance;
  await updateUser(user, c.env);

  const transaction: CreditTransaction = {
    type: body.amount > 0 ? 'admin_credit' : 'admin_debit',
    amount: body.amount,
    timestamp: Date.now(),
    details: `Admin (${adminIdentity.email}): ${body.reason.trim()}`,
  };
  await addCreditTransaction(user.userId, transaction, c.env);

  return c.json({ user, newBalance });
});

// GET /api/admin/analytics/overview
admin.get('/analytics/overview', async (c) => {
  let totalUsers = 0;
  let userCursor: string | undefined;
  let userPages = 0;
  do {
    const result = await c.env.TRIVIA_KV.list({ prefix: 'user:', cursor: userCursor });
    totalUsers += result.keys.length;
    userCursor = result.list_complete ? undefined : result.cursor;
    userPages++;
  } while (userCursor && userPages < MAX_KV_PAGES);

  const eventCounts: Record<string, number> = {};
  let evtCursor: string | undefined;
  let evtPages = 0;
  do {
    const result = await c.env.TRIVIA_KV.list({ prefix: 'evt:', cursor: evtCursor });
    for (const k of result.keys) {
      const meta = k.metadata as { type?: string } | null;
      const type = meta?.type || 'unknown';
      eventCounts[type] = (eventCounts[type] || 0) + 1;
    }
    evtCursor = result.list_complete ? undefined : result.cursor;
    evtPages++;
  } while (evtCursor && evtPages < MAX_KV_PAGES);

  let totalErrors = 0;
  let errCursor: string | undefined;
  let errPages = 0;
  do {
    const result = await c.env.TRIVIA_KV.list({ prefix: 'error:', cursor: errCursor });
    totalErrors += result.keys.length;
    errCursor = result.list_complete ? undefined : result.cursor;
    errPages++;
  } while (errCursor && errPages < MAX_KV_PAGES);

  return c.json({ totalUsers, eventCounts, totalErrors });
});

// GET /api/admin/analytics/events
admin.get('/analytics/events', async (c) => {
  const type = c.req.query('type');
  const date = c.req.query('date');
  const cursor = c.req.query('cursor') || undefined;
  const limit = Math.min(Number(c.req.query('limit')) || 50, 100);

  if (type && !VALID_EVENT_TYPES.has(type)) {
    return c.json({ error: 'Invalid event type' }, 400);
  }
  if (date && !isValidDateParam(date)) {
    return c.json({ error: 'Invalid date format (use YYYY-MM or YYYY-MM-DD)' }, 400);
  }

  let prefix = 'evt:';
  if (type) prefix += `${type}:`;
  if (type && date) prefix += date;

  const listResult = await c.env.TRIVIA_KV.list({ prefix, limit, cursor });

  const events: Array<{ key: string; metadata: unknown }> = [];
  for (const k of listResult.keys) {
    events.push({ key: k.name, metadata: k.metadata });
  }

  return c.json({
    events,
    cursor: listResult.list_complete ? null : listResult.cursor,
    complete: listResult.list_complete,
  });
});

// GET /api/admin/games/active
admin.get('/games/active', async (c) => {
  const lobbyId = c.env.GAME_LOBBY.idFromName('global');
  const lobby = c.env.GAME_LOBBY.get(lobbyId);
  const res = await lobby.fetch(new Request('http://internal/admin/games'));
  if (!res.ok) {
    return c.json({ error: 'Failed to fetch games from lobby' }, 502);
  }
  return c.json(await res.json());
});

// GET /api/admin/errors
admin.get('/errors', async (c) => {
  const cursor = c.req.query('cursor') || undefined;
  const limit = Math.min(Number(c.req.query('limit')) || 50, 100);

  const listResult = await c.env.TRIVIA_KV.list({ prefix: 'error:', limit, cursor });

  const errors: Array<{ key: string; metadata: unknown }> = [];
  for (const k of listResult.keys) {
    errors.push({ key: k.name, metadata: k.metadata });
  }

  return c.json({
    errors,
    cursor: listResult.list_complete ? null : listResult.cursor,
    complete: listResult.list_complete,
  });
});

// --- Coupon management ---

// GET /api/admin/coupons
admin.get('/coupons', async (c) => {
  const cursor = c.req.query('cursor') || undefined;
  const limit = Math.min(Number(c.req.query('limit')) || 50, 100);
  const result = await listCoupons(c.env, cursor, limit);
  return c.json(result);
});

// POST /api/admin/coupons
admin.post('/coupons', async (c) => {
  const adminIdentity = c.get('adminIdentity');
  const body = (await c.req.json()) as {
    code?: string;
    credits?: number;
    maxUses?: number;
    expiresInDays?: number;
    note?: string;
  };

  if (typeof body.credits !== 'number' || !Number.isInteger(body.credits) || body.credits < 1 || body.credits > 10_000) {
    return c.json({ error: 'credits must be an integer between 1 and 10,000' }, 400);
  }

  const maxUses = body.maxUses ?? 1;
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10_000) {
    return c.json({ error: 'maxUses must be between 1 and 10,000' }, 400);
  }

  if (body.code && !isValidCouponCode(body.code)) {
    return c.json({ error: 'Invalid coupon code format' }, 400);
  }

  const note = (body.note || '').trim();
  if (note.length > 500) {
    return c.json({ error: 'note must be 500 characters or fewer' }, 400);
  }

  let expiresAt: number | null = null;
  if (body.expiresInDays && body.expiresInDays > 0) {
    expiresAt = Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000;
  }

  try {
    const coupon = await createCoupon(c.env, {
      code: body.code,
      credits: body.credits,
      maxUses,
      expiresAt,
      note,
      createdBy: adminIdentity.email,
    });
    return c.json({ coupon });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : 'Failed to create coupon' },
      400,
    );
  }
});

// POST /api/admin/coupons/:code/send
admin.post('/coupons/:code/send', async (c) => {
  const code = decodeURIComponent(c.req.param('code'));
  const body = (await c.req.json()) as {
    to?: string;
    senderName?: string;
    message?: string;
  };

  if (!body.to || typeof body.to !== 'string' || !body.to.includes('@')) {
    return c.json({ error: 'Valid recipient email (to) is required' }, 400);
  }

  const senderName = (body.senderName || 'LAMO Trivia').trim();
  if (senderName.length > 100) {
    return c.json({ error: 'senderName too long' }, 400);
  }

  const message = body.message?.trim();
  if (message && message.length > 500) {
    return c.json({ error: 'message must be 500 characters or fewer' }, 400);
  }

  const coupon = await getCoupon(c.env, code);
  if (!coupon) {
    return c.json({ error: 'Coupon not found' }, 404);
  }

  try {
    await sendCouponEmail(c.env, {
      to: body.to.trim(),
      couponCode: coupon.code,
      credits: coupon.credits,
      senderName,
      personalMessage: message,
    });
    return c.json({ ok: true, sentTo: body.to.trim() });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : 'Failed to send email' },
      500,
    );
  }
});

// DELETE /api/admin/coupons/:code
admin.delete('/coupons/:code', async (c) => {
  const code = decodeURIComponent(c.req.param('code'));
  if (!isValidCouponCode(code)) {
    return c.json({ error: 'Invalid coupon code' }, 400);
  }

  const deleted = await deleteCoupon(c.env, code);
  if (!deleted) {
    return c.json({ error: 'Coupon not found' }, 404);
  }

  return c.json({ ok: true });
});

// POST /api/admin/invite
admin.post('/invite', async (c) => {
  const adminIdentity = c.get('adminIdentity');
  const body = (await c.req.json()) as { email?: string };

  if (!body.email || typeof body.email !== 'string' || !body.email.includes('@')) {
    return c.json({ error: 'Valid email is required' }, 400);
  }

  const email = body.email.trim().toLowerCase();

  // Check if user already exists
  const existingUser = await getUser(email, c.env);
  if (existingUser) {
    return c.json({ error: 'User already has an account' }, 400);
  }

  try {
    const invite = await createInvite(c.env, email, adminIdentity.email);
    await sendInviteEmail(c.env, {
      to: email,
      inviteToken: invite.token,
      credits: invite.credits,
      senderName: 'LAMO Trivia',
    });
    return c.json({ ok: true, email, credits: invite.credits });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : 'Failed to send invite' },
      500,
    );
  }
});

// DELETE /api/admin/sessions/:token
admin.delete('/sessions/:token', async (c) => {
  const token = c.req.param('token');
  if (!isValidSessionToken(token)) {
    return c.json({ error: 'Invalid session token format' }, 400);
  }

  await c.env.TRIVIA_KV.delete(`session:${token}`);
  return c.json({ ok: true });
});

export { admin as adminRoutes };
