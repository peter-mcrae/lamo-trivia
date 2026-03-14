import type { Env } from './env';
import type { AdminIdentity } from './admin-auth';
import type { User, CreditTransaction } from '@lamo-trivia/shared';
import { getUser, updateUser, getCreditTransactions, addCreditTransaction } from './auth';
import {
  createCoupon, listCoupons, getCoupon, deleteCoupon,
  sendCouponEmail, isValidCouponCode,
} from './coupons';

// --- Input validation helpers ---

/** Validate email-like characters only (prevents KV key injection) */
function isValidEmailParam(email: string): boolean {
  return /^[a-zA-Z0-9@._+\-]{1,254}$/.test(email);
}

/** Validate search term: email-like characters, max 200 chars */
function isValidSearch(search: string): boolean {
  return /^[a-zA-Z0-9@._+\-]{0,200}$/.test(search);
}

/** Validate session token format: 64-char hex string */
function isValidSessionToken(token: string): boolean {
  return /^[0-9a-f]{64}$/.test(token);
}

/** Allowlist of known analytics event types */
const VALID_EVENT_TYPES = new Set([
  'game_created', 'game_started', 'game_finished',
  'hunt_created', 'hunt_started', 'hunt_finished',
  'photo_verified', 'vision_comparison',
]);

/** Validate date param: YYYY-MM or YYYY-MM-DD */
function isValidDateParam(date: string): boolean {
  return /^\d{4}-\d{2}(-\d{2})?$/.test(date);
}

/** Max credit adjustment amount (prevents fat-finger errors) */
const MAX_CREDIT_ADJUSTMENT = 1_000_000;

/** Max pages for unbounded KV pagination loops */
const MAX_KV_PAGES = 20;

// --- Rate limiter for admin routes ---

const adminRateLimiter = new Map<string, { count: number; start: number }>();
const ADMIN_RATE_LIMIT = 120; // requests per minute
const ADMIN_RATE_WINDOW = 60_000; // 1 minute

function checkAdminRateLimit(admin: AdminIdentity): boolean {
  const now = Date.now();
  const key = admin.email;
  const entry = adminRateLimiter.get(key);

  if (!entry || now - entry.start > ADMIN_RATE_WINDOW) {
    // Evict stale entries if map grows large
    if (adminRateLimiter.size > 1000) {
      for (const [k, v] of adminRateLimiter) {
        if (now - v.start > ADMIN_RATE_WINDOW) adminRateLimiter.delete(k);
      }
    }
    adminRateLimiter.set(key, { count: 1, start: now });
    return true;
  }

  entry.count++;
  return entry.count <= ADMIN_RATE_LIMIT;
}

/**
 * Handle all /api/admin/* requests. Called after admin auth verification.
 */
export async function handleAdminRequest(
  request: Request,
  url: URL,
  method: string,
  env: Env,
  admin: AdminIdentity,
): Promise<Response> {
  // Rate limit all admin requests
  if (!checkAdminRateLimit(admin)) {
    return Response.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 },
    );
  }

  const path = url.pathname.replace('/api/admin', '');

  // GET /api/admin/users — list users with optional search
  if (method === 'GET' && path === '/users') {
    return handleListUsers(url, env);
  }

  // GET /api/admin/users/:email — user detail
  if (method === 'GET' && path.startsWith('/users/') && !path.includes('/credits')) {
    const email = decodeURIComponent(path.replace('/users/', ''));
    if (!isValidEmailParam(email)) {
      return Response.json({ error: 'Invalid email parameter' }, { status: 400 });
    }
    return handleGetUser(email, env);
  }

  // POST /api/admin/users/:email/credits — adjust credits
  if (method === 'POST' && path.match(/^\/users\/[^/]+\/credits$/)) {
    const email = decodeURIComponent(path.replace('/users/', '').replace('/credits', ''));
    if (!isValidEmailParam(email)) {
      return Response.json({ error: 'Invalid email parameter' }, { status: 400 });
    }
    return handleAdjustCredits(email, request, env, admin);
  }

  // GET /api/admin/analytics/overview — aggregate counts
  if (method === 'GET' && path === '/analytics/overview') {
    return handleAnalyticsOverview(env);
  }

  // GET /api/admin/analytics/events — browse events
  if (method === 'GET' && path === '/analytics/events') {
    return handleAnalyticsEvents(url, env);
  }

  // GET /api/admin/games/active — all games from lobby
  if (method === 'GET' && path === '/games/active') {
    return handleActiveGames(env);
  }

  // GET /api/admin/errors — list recent errors
  if (method === 'GET' && path === '/errors') {
    return handleListErrors(url, env);
  }

  // --- Coupon management ---

  // GET /api/admin/coupons — list all coupons
  if (method === 'GET' && path === '/coupons') {
    return handleListCoupons(url, env);
  }

  // POST /api/admin/coupons — create a coupon
  if (method === 'POST' && path === '/coupons') {
    return handleCreateCoupon(request, env, admin);
  }

  // POST /api/admin/coupons/:code/send — email a coupon
  if (method === 'POST' && path.match(/^\/coupons\/[^/]+\/send$/)) {
    const code = decodeURIComponent(path.replace('/coupons/', '').replace('/send', ''));
    return handleSendCoupon(code, request, env, admin);
  }

  // DELETE /api/admin/coupons/:code — delete a coupon
  if (method === 'DELETE' && path.startsWith('/coupons/')) {
    const code = decodeURIComponent(path.replace('/coupons/', ''));
    return handleDeleteCoupon(code, env);
  }

  // DELETE /api/admin/sessions/:token — force logout
  if (method === 'DELETE' && path.startsWith('/sessions/')) {
    const token = path.replace('/sessions/', '');
    return handleForceLogout(token, env);
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}

// --- Handlers ---

async function handleListUsers(url: URL, env: Env): Promise<Response> {
  const search = url.searchParams.get('search') || '';
  const cursor = url.searchParams.get('cursor') || undefined;
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);

  if (search && !isValidSearch(search)) {
    return Response.json({ error: 'Invalid search parameter' }, { status: 400 });
  }

  const prefix = search ? `user:${search.toLowerCase()}` : 'user:';

  const listResult = await env.TRIVIA_KV.list({
    prefix,
    limit,
    cursor,
  });

  const users: User[] = [];
  for (const key of listResult.keys) {
    const raw = await env.TRIVIA_KV.get(key.name);
    if (raw) {
      try {
        users.push(JSON.parse(raw) as User);
      } catch {
        // Skip malformed entries
      }
    }
  }

  return Response.json({
    users,
    cursor: listResult.list_complete ? null : listResult.cursor,
    complete: listResult.list_complete,
  });
}

async function handleGetUser(email: string, env: Env): Promise<Response> {
  const user = await getUser(email, env);
  if (!user) {
    return Response.json({ error: 'User not found' }, { status: 404 });
  }

  const transactions = await getCreditTransactions(user.userId, env);

  return Response.json({ user, transactions });
}

async function handleAdjustCredits(
  email: string,
  request: Request,
  env: Env,
  admin: AdminIdentity,
): Promise<Response> {
  const body = (await request.json()) as { amount?: number; reason?: string };

  if (typeof body.amount !== 'number' || !Number.isInteger(body.amount) || body.amount === 0) {
    return Response.json({ error: 'amount must be a non-zero integer' }, { status: 400 });
  }
  if (Math.abs(body.amount) > MAX_CREDIT_ADJUSTMENT) {
    return Response.json(
      { error: `amount must be between -${MAX_CREDIT_ADJUSTMENT} and ${MAX_CREDIT_ADJUSTMENT}` },
      { status: 400 },
    );
  }
  if (!body.reason || typeof body.reason !== 'string' || body.reason.trim().length === 0) {
    return Response.json({ error: 'reason is required' }, { status: 400 });
  }
  if (body.reason.length > 500) {
    return Response.json({ error: 'reason must be 500 characters or fewer' }, { status: 400 });
  }

  const user = await getUser(email, env);
  if (!user) {
    return Response.json({ error: 'User not found' }, { status: 404 });
  }

  const newBalance = user.credits + body.amount;
  if (newBalance < 0) {
    return Response.json(
      { error: `Adjustment would result in negative balance (${newBalance})` },
      { status: 400 },
    );
  }

  user.credits = newBalance;
  await updateUser(user, env);

  const transaction: CreditTransaction = {
    type: body.amount > 0 ? 'admin_credit' : 'admin_debit',
    amount: body.amount,
    timestamp: Date.now(),
    details: `Admin (${admin.email}): ${body.reason.trim()}`,
  };
  await addCreditTransaction(user.userId, transaction, env);

  return Response.json({ user, newBalance });
}

async function handleAnalyticsOverview(env: Env): Promise<Response> {
  // Count users (bounded pagination)
  let totalUsers = 0;
  let userCursor: string | undefined;
  let userPages = 0;
  do {
    const result = await env.TRIVIA_KV.list({
      prefix: 'user:',
      cursor: userCursor,
    });
    totalUsers += result.keys.length;
    userCursor = result.list_complete ? undefined : result.cursor;
    userPages++;
  } while (userCursor && userPages < MAX_KV_PAGES);

  // Count events by type (bounded pagination)
  const eventCounts: Record<string, number> = {};
  let evtCursor: string | undefined;
  let evtPages = 0;
  do {
    const result = await env.TRIVIA_KV.list({
      prefix: 'evt:',
      cursor: evtCursor,
    });
    for (const k of result.keys) {
      const meta = k.metadata as { type?: string } | null;
      const type = meta?.type || 'unknown';
      eventCounts[type] = (eventCounts[type] || 0) + 1;
    }
    evtCursor = result.list_complete ? undefined : result.cursor;
    evtPages++;
  } while (evtCursor && evtPages < MAX_KV_PAGES);

  // Count errors (bounded pagination)
  let totalErrors = 0;
  let errCursor: string | undefined;
  let errPages = 0;
  do {
    const result = await env.TRIVIA_KV.list({
      prefix: 'error:',
      cursor: errCursor,
    });
    totalErrors += result.keys.length;
    errCursor = result.list_complete ? undefined : result.cursor;
    errPages++;
  } while (errCursor && errPages < MAX_KV_PAGES);

  return Response.json({
    totalUsers,
    eventCounts,
    totalErrors,
  });
}

async function handleAnalyticsEvents(url: URL, env: Env): Promise<Response> {
  const type = url.searchParams.get('type');
  const date = url.searchParams.get('date');
  const cursor = url.searchParams.get('cursor') || undefined;
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);

  // Validate event type against allowlist
  if (type && !VALID_EVENT_TYPES.has(type)) {
    return Response.json({ error: 'Invalid event type' }, { status: 400 });
  }
  // Validate date format
  if (date && !isValidDateParam(date)) {
    return Response.json({ error: 'Invalid date format (use YYYY-MM or YYYY-MM-DD)' }, { status: 400 });
  }

  let prefix = 'evt:';
  if (type) prefix += `${type}:`;
  if (type && date) prefix += date;

  const listResult = await env.TRIVIA_KV.list({ prefix, limit, cursor });

  const events: Array<{ key: string; metadata: unknown }> = [];
  for (const k of listResult.keys) {
    events.push({ key: k.name, metadata: k.metadata });
  }

  return Response.json({
    events,
    cursor: listResult.list_complete ? null : listResult.cursor,
    complete: listResult.list_complete,
  });
}

async function handleActiveGames(env: Env): Promise<Response> {
  const lobbyId = env.GAME_LOBBY.idFromName('global');
  const lobby = env.GAME_LOBBY.get(lobbyId);
  const res = await lobby.fetch(new Request('http://internal/admin/games'));
  if (!res.ok) {
    return Response.json({ error: 'Failed to fetch games from lobby' }, { status: 502 });
  }
  return Response.json(await res.json());
}

async function handleListErrors(url: URL, env: Env): Promise<Response> {
  const cursor = url.searchParams.get('cursor') || undefined;
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);

  const listResult = await env.TRIVIA_KV.list({
    prefix: 'error:',
    limit,
    cursor,
  });

  const errors: Array<{ key: string; metadata: unknown }> = [];
  for (const k of listResult.keys) {
    errors.push({ key: k.name, metadata: k.metadata });
  }

  return Response.json({
    errors,
    cursor: listResult.list_complete ? null : listResult.cursor,
    complete: listResult.list_complete,
  });
}

async function handleForceLogout(token: string, env: Env): Promise<Response> {
  if (!isValidSessionToken(token)) {
    return Response.json({ error: 'Invalid session token format' }, { status: 400 });
  }

  await env.TRIVIA_KV.delete(`session:${token}`);
  return Response.json({ ok: true });
}

// --- Coupon handlers ---

async function handleListCoupons(url: URL, env: Env): Promise<Response> {
  const cursor = url.searchParams.get('cursor') || undefined;
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);
  const result = await listCoupons(env, cursor, limit);
  return Response.json(result);
}

async function handleCreateCoupon(
  request: Request,
  env: Env,
  admin: AdminIdentity,
): Promise<Response> {
  const body = (await request.json()) as {
    code?: string;
    credits?: number;
    maxUses?: number;
    expiresInDays?: number;
    note?: string;
  };

  // Validate credits
  if (typeof body.credits !== 'number' || !Number.isInteger(body.credits) || body.credits < 1 || body.credits > 10_000) {
    return Response.json({ error: 'credits must be an integer between 1 and 10,000' }, { status: 400 });
  }

  // Validate maxUses
  const maxUses = body.maxUses ?? 1;
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10_000) {
    return Response.json({ error: 'maxUses must be between 1 and 10,000' }, { status: 400 });
  }

  // Validate custom code if provided
  if (body.code && !isValidCouponCode(body.code)) {
    return Response.json({ error: 'Invalid coupon code format' }, { status: 400 });
  }

  // Validate note
  const note = (body.note || '').trim();
  if (note.length > 500) {
    return Response.json({ error: 'note must be 500 characters or fewer' }, { status: 400 });
  }

  // Calculate expiry
  let expiresAt: number | null = null;
  if (body.expiresInDays && body.expiresInDays > 0) {
    expiresAt = Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000;
  }

  try {
    const coupon = await createCoupon(env, {
      code: body.code,
      credits: body.credits,
      maxUses,
      expiresAt,
      note,
      createdBy: admin.email,
    });
    return Response.json({ coupon });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Failed to create coupon' },
      { status: 400 },
    );
  }
}

async function handleSendCoupon(
  code: string,
  request: Request,
  env: Env,
  admin: AdminIdentity,
): Promise<Response> {
  const body = (await request.json()) as {
    to?: string;
    senderName?: string;
    message?: string;
  };

  if (!body.to || typeof body.to !== 'string' || !body.to.includes('@')) {
    return Response.json({ error: 'Valid recipient email (to) is required' }, { status: 400 });
  }

  const senderName = (body.senderName || 'LAMO Trivia').trim();
  if (senderName.length > 100) {
    return Response.json({ error: 'senderName too long' }, { status: 400 });
  }

  const message = body.message?.trim();
  if (message && message.length > 500) {
    return Response.json({ error: 'message must be 500 characters or fewer' }, { status: 400 });
  }

  const coupon = await getCoupon(env, code);
  if (!coupon) {
    return Response.json({ error: 'Coupon not found' }, { status: 404 });
  }

  try {
    await sendCouponEmail(env, {
      to: body.to.trim(),
      couponCode: coupon.code,
      credits: coupon.credits,
      senderName,
      personalMessage: message,
    });
    return Response.json({ ok: true, sentTo: body.to.trim() });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Failed to send email' },
      { status: 500 },
    );
  }
}

async function handleDeleteCoupon(code: string, env: Env): Promise<Response> {
  if (!isValidCouponCode(code)) {
    return Response.json({ error: 'Invalid coupon code' }, { status: 400 });
  }

  const deleted = await deleteCoupon(env, code);
  if (!deleted) {
    return Response.json({ error: 'Coupon not found' }, { status: 404 });
  }

  return Response.json({ ok: true });
}
