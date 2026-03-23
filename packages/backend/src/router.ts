import { Env } from './env';
import {
  GameConfigSchema, HuntConfigSchema, UsernameSchema, GroupNameSchema,
  SendCodeRequestSchema, VerifyCodeRequestSchema,
  TRIVIA_CATEGORIES, generateGroupId, HUNT_LIMITS,
} from '@lamo-trivia/shared';
import type { GroupGame, HuntConfig, HuntHistoryEntry, HuntHistorySummary } from '@lamo-trivia/shared';
import { seedQuestions, getCategoryCounts, getAIQuestionBankTopics } from './questions';
import {
  sendMagicCode, verifyMagicCode, createSession, getSessionUser,
  deleteSession, getCreditTransactions, addCreditTransaction,
  updateUser, timingSafeEqual,
} from './auth';
import { redeemCoupon } from './coupons';
import { createCheckoutSession, verifyWebhookSignature, handleCheckoutCompleted } from './stripe';
import { logEvent } from './analytics';
import { sendToGA } from './ga';
import { logError } from './errors';
import { verifyAdminAccess } from './admin-auth';
import { handleAdminRequest } from './admin-routes';

// --- In-memory rate limiter (per Worker isolate) ---

const MAX_RATE_LIMITER_ENTRIES = 10_000;

class RateLimiter {
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

const gameCreateLimiter = new RateLimiter(10);       // 10/min per IP
const groupCreateLimiter = new RateLimiter(5);       // 5/min per IP
const usernameCheckLimiter = new RateLimiter(20);    // 20/min per IP
const groupGameLimiter = new RateLimiter(10);        // 10/min per IP
const photoUploadLimiter = new RateLimiter(20);      // 20/min per IP
const huntHistoryLimiter = new RateLimiter(30);      // 30/min per IP
const authCodeLimiter = new RateLimiter(5, 3600_000); // 5/hr per email
const authVerifyLimiter = new RateLimiter(20);       // 20/min per IP
const trackingLimiter = new RateLimiter(60);          // 60/min per IP

function getClientIP(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

function rateLimitedResponse(): Response {
  return Response.json(
    { error: 'Too many requests. Please try again later.' },
    { status: 429 },
  );
}

/** Validate photo filename format to prevent path traversal */
function isValidPhotoFilename(name: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/.test(name);
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;

  try {
    // --- Admin Routes (early intercept) ---
    if (url.pathname.startsWith('/api/admin/')) {
      const admin = await verifyAdminAccess(request, env);
      if (!admin) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
      return handleAdminRequest(request, url, method, env, admin);
    }

    // --- Analytics beacon ---

    // POST /api/t — lightweight page view tracking
    if (method === 'POST' && url.pathname === '/api/t') {
      if (!trackingLimiter.check(getClientIP(request))) {
        return new Response(null, { status: 204 });
      }
      try {
        const { p, t, cid } = await request.json() as { p?: string; t?: string; cid?: string };
        if (p && cid) {
          sendToGA(env, cid, [{
            name: 'page_view',
            params: {
              page_location: `https://lamotrivia.app${p}`,
              page_title: t || '',
            },
          }]).catch(() => {});
        }
      } catch { /* ignore malformed body */ }
      return new Response(null, { status: 204 });
    }

    // --- Auth Routes ---

    // POST /api/auth/send-code
    if (method === 'POST' && url.pathname === '/api/auth/send-code') {
      const body = await request.json();
      const parsed = SendCodeRequestSchema.safeParse(body);
      if (!parsed.success) {
        return Response.json({ error: parsed.error.flatten() }, { status: 400 });
      }
      if (!authCodeLimiter.check(parsed.data.email)) return rateLimitedResponse();
      try {
        await sendMagicCode(parsed.data.email, env);
      } catch (err) {
        console.error('send-code error:', err instanceof Error ? err.message : err);
        return Response.json({ error: 'Failed to send login code. Please try again later.' }, { status: 500 });
      }
      return Response.json({ ok: true });
    }

    // POST /api/auth/verify-code
    if (method === 'POST' && url.pathname === '/api/auth/verify-code') {
      if (!authVerifyLimiter.check(getClientIP(request))) return rateLimitedResponse();
      const body = await request.json();
      const parsed = VerifyCodeRequestSchema.safeParse(body);
      if (!parsed.success) {
        return Response.json({ error: parsed.error.flatten() }, { status: 400 });
      }
      const valid = await verifyMagicCode(parsed.data.email, parsed.data.code, env);
      if (!valid) {
        return Response.json({ error: 'Invalid or expired code' }, { status: 401 });
      }
      const { token, user } = await createSession(parsed.data.email, env);
      return Response.json({ token, user });
    }

    // GET /api/auth/me
    if (method === 'GET' && url.pathname === '/api/auth/me') {
      const user = await getSessionUser(request, env);
      return Response.json({ user: user ?? null });
    }

    // POST /api/auth/logout
    if (method === 'POST' && url.pathname === '/api/auth/logout') {
      await deleteSession(request, env);
      return Response.json({ ok: true });
    }

    // --- Stripe / Credits Routes ---

    // POST /api/checkout — create Stripe Checkout session
    if (method === 'POST' && url.pathname === '/api/checkout') {
      const user = await getSessionUser(request, env);
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      const checkoutUrl = await createCheckoutSession(user, env);
      return Response.json({ url: checkoutUrl });
    }

    // POST /api/webhooks/stripe — Stripe webhook
    if (method === 'POST' && url.pathname === '/api/webhooks/stripe') {
      const sig = request.headers.get('stripe-signature');
      if (!sig || !env.STRIPE_WEBHOOK_SECRET) {
        return Response.json({ error: 'Missing signature' }, { status: 400 });
      }
      const payload = await request.text();
      const valid = await verifyWebhookSignature(payload, sig, env.STRIPE_WEBHOOK_SECRET);
      if (!valid) {
        return Response.json({ error: 'Invalid signature' }, { status: 400 });
      }
      const event = JSON.parse(payload);
      if (event.type === 'checkout.session.completed') {
        await handleCheckoutCompleted(event, env);
      }
      return Response.json({ received: true });
    }

    // GET /api/credits/balance
    if (method === 'GET' && url.pathname === '/api/credits/balance') {
      const user = await getSessionUser(request, env);
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      return Response.json({ credits: user.credits });
    }

    // GET /api/credits/transactions
    if (method === 'GET' && url.pathname === '/api/credits/transactions') {
      const user = await getSessionUser(request, env);
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      const transactions = await getCreditTransactions(user.userId, env);
      return Response.json({ transactions });
    }

    // POST /api/coupons/redeem — redeem a coupon code (requires auth)
    if (method === 'POST' && url.pathname === '/api/coupons/redeem') {
      if (!authVerifyLimiter.check(getClientIP(request))) return rateLimitedResponse();
      const user = await getSessionUser(request, env);
      if (!user) return Response.json({ error: 'Sign in to redeem a coupon' }, { status: 401 });

      const body = (await request.json()) as { code?: string };
      if (!body.code || typeof body.code !== 'string' || body.code.trim().length === 0) {
        return Response.json({ error: 'Coupon code is required' }, { status: 400 });
      }

      try {
        const { credits, coupon } = await redeemCoupon(env, body.code.trim(), user.email);

        // Add credits to user
        user.credits += credits;
        await updateUser(user, env);

        // Record transaction
        await addCreditTransaction(user.userId, {
          type: 'coupon',
          amount: credits,
          timestamp: Date.now(),
          details: `Coupon ${coupon.code}: ${coupon.note || 'Free credits'}`,
        }, env);

        return Response.json({ credits, newBalance: user.credits });
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : 'Failed to redeem coupon' },
          { status: 400 },
        );
      }
    }

    // GET /api/games — list public games
    if (method === 'GET' && url.pathname === '/api/games') {
      const lobbyId = env.GAME_LOBBY.idFromName('global');
      const lobby = env.GAME_LOBBY.get(lobbyId);
      return lobby.fetch(new Request('http://internal/games'));
    }

    // POST /api/games — create a new game
    if (method === 'POST' && url.pathname === '/api/games') {
      if (!gameCreateLimiter.check(getClientIP(request))) return rateLimitedResponse();
      const body = await request.json();
      const parsed = GameConfigSchema.safeParse(body);
      if (!parsed.success) {
        return Response.json({ error: parsed.error.flatten() }, { status: 400 });
      }
      const lobbyId = env.GAME_LOBBY.idFromName('global');
      const lobby = env.GAME_LOBBY.get(lobbyId);
      const lobbyRes = await lobby.fetch(
        new Request('http://internal/games', {
          method: 'POST',
          body: JSON.stringify({ ...parsed.data, gameMode: 'trivia' }),
        }),
      );
      const lobbyData = (await lobbyRes.json()) as { gameId: string };

      // Forward config to the GameRoom DO so it's ready when players connect
      const roomId = env.GAME_ROOM.idFromName(lobbyData.gameId);
      const room = env.GAME_ROOM.get(roomId);
      await room.fetch(
        new Request('http://internal/config', {
          method: 'POST',
          body: JSON.stringify({ ...parsed.data, gameId: lobbyData.gameId }),
        }),
      );

      logEvent(env, 'game_created', {
        gameId: lobbyData.gameId,
        gameMode: 'trivia',
        name: parsed.data.name,
        categoryIds: parsed.data.categoryIds,
        questionCount: parsed.data.questionCount,
        maxPlayers: parsed.data.maxPlayers,
        aiTopic: parsed.data.aiTopic ?? null,
        isPrivate: parsed.data.isPrivate,
        isGroupGame: false,
      }).catch(() => {});

      return Response.json(lobbyData);
    }

    // POST /api/username/check — check availability
    if (method === 'POST' && url.pathname === '/api/username/check') {
      if (!usernameCheckLimiter.check(getClientIP(request))) return rateLimitedResponse();
      const { username } = (await request.json()) as { username: string };
      const parsed = UsernameSchema.safeParse(username);
      if (!parsed.success) {
        return Response.json({ available: false, error: parsed.error.flatten() }, { status: 400 });
      }
      const existing = await env.TRIVIA_KV.get(`username:${parsed.data.toLowerCase()}`);
      return Response.json({ available: !existing });
    }

    // GET /api/categories — list trivia categories with live question counts
    if (method === 'GET' && url.pathname === '/api/categories') {
      const counts = await getCategoryCounts(env.TRIVIA_KV);
      const categories = TRIVIA_CATEGORIES.map((cat) => ({
        ...cat,
        questionCount: counts[cat.id] ?? 0,
      }));
      return Response.json({ categories });
    }

    // POST /api/seed — populate KV with questions (expects { categoryId: Question[] } body)
    // Protected: requires Authorization: Bearer <SEED_SECRET>
    if (method === 'POST' && url.pathname === '/api/seed') {
      const authHeader = request.headers.get('Authorization');
      const expectedSecret = env.SEED_SECRET;
      if (!expectedSecret || !authHeader) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const expectedValue = `Bearer ${expectedSecret}`;
      if (authHeader.length !== expectedValue.length || !(await timingSafeEqual(authHeader, expectedValue))) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const categories = (await request.json()) as Record<string, unknown[]>;
      const counts = await seedQuestions(env.TRIVIA_KV, categories as Record<string, import('@lamo-trivia/shared').Question[]>);
      return Response.json({ seeded: true, counts });
    }

    // POST /api/groups — create a new private group (requires auth)
    if (method === 'POST' && url.pathname === '/api/groups') {
      if (!groupCreateLimiter.check(getClientIP(request))) return rateLimitedResponse();
      const user = await getSessionUser(request, env);
      if (!user) return Response.json({ error: 'Sign in to create a group' }, { status: 401 });
      const body = (await request.json()) as { name: string };
      const parsed = GroupNameSchema.safeParse(body.name);
      if (!parsed.success) {
        return Response.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      const groupId = generateGroupId();
      const doId = env.PRIVATE_GROUP.idFromName(groupId);
      const group = env.PRIVATE_GROUP.get(doId);
      const res = await group.fetch(
        new Request('http://internal/init', {
          method: 'POST',
          body: JSON.stringify({ id: groupId, name: parsed.data, ownerEmail: user.email }),
        }),
      );

      if (!res.ok) {
        // Extremely unlikely collision — retry once with new ID
        const retryId = generateGroupId();
        const retryDoId = env.PRIVATE_GROUP.idFromName(retryId);
        const retryGroup = env.PRIVATE_GROUP.get(retryDoId);
        await retryGroup.fetch(
          new Request('http://internal/init', {
            method: 'POST',
            body: JSON.stringify({ id: retryId, name: parsed.data, ownerEmail: user.email }),
          }),
        );
        return Response.json({ groupId: retryId, name: parsed.data });
      }

      // Index group by owner email for recovery
      const ownerKey = `owner-groups:${user.email}`;
      const existing = await env.TRIVIA_KV.get<string[]>(ownerKey, 'json') ?? [];
      existing.push(groupId);
      await env.TRIVIA_KV.put(ownerKey, JSON.stringify(existing));

      return Response.json({ groupId, name: parsed.data });
    }

    // GET /api/groups/my — list groups owned by the authenticated user
    if (method === 'GET' && url.pathname === '/api/groups/my') {
      const user = await getSessionUser(request, env);
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      const ownerKey = `owner-groups:${user.email}`;
      const groupIds = await env.TRIVIA_KV.get<string[]>(ownerKey, 'json') ?? [];

      const groups: { groupId: string; name: string }[] = [];
      for (const gid of groupIds) {
        const doId = env.PRIVATE_GROUP.idFromName(gid);
        const group = env.PRIVATE_GROUP.get(doId);
        const res = await group.fetch(new Request('http://internal/state'));
        if (res.ok) {
          const data = (await res.json()) as { id: string; name: string };
          groups.push({ groupId: data.id, name: data.name });
        }
      }
      return Response.json({ groups });
    }

    // GET /api/groups/:groupId — validate group exists
    if (method === 'GET' && url.pathname.startsWith('/api/groups/') && !url.pathname.includes('/games')) {
      const groupId = url.pathname.split('/api/groups/')[1];
      if (!groupId) return Response.json({ error: 'Missing group ID' }, { status: 400 });

      const doId = env.PRIVATE_GROUP.idFromName(groupId);
      const group = env.PRIVATE_GROUP.get(doId);
      const res = await group.fetch(new Request('http://internal/state'));
      if (!res.ok) return Response.json({ error: 'Group not found' }, { status: 404 });

      return Response.json(await res.json());
    }

    // POST /api/groups/:groupId/games — create a game within a group
    if (method === 'POST' && url.pathname.match(/^\/api\/groups\/[^/]+\/games$/)) {
      if (!groupGameLimiter.check(getClientIP(request))) return rateLimitedResponse();
      const groupId = url.pathname.split('/api/groups/')[1].split('/games')[0];

      // Validate group exists
      const doId = env.PRIVATE_GROUP.idFromName(groupId);
      const group = env.PRIVATE_GROUP.get(doId);
      const checkRes = await group.fetch(new Request('http://internal/state'));
      if (!checkRes.ok) return Response.json({ error: 'Group not found' }, { status: 404 });

      // Parse game config — force isPrivate=true and set groupId
      const body = await request.json();
      const parsed = GameConfigSchema.safeParse({ ...(body as object), isPrivate: true, groupId });
      if (!parsed.success) {
        return Response.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      // Create game in lobby (existing flow)
      const lobbyId = env.GAME_LOBBY.idFromName('global');
      const lobby = env.GAME_LOBBY.get(lobbyId);
      const lobbyRes = await lobby.fetch(
        new Request('http://internal/games', {
          method: 'POST',
          body: JSON.stringify(parsed.data),
        }),
      );
      const lobbyData = (await lobbyRes.json()) as { gameId: string };

      // Configure the GameRoom (existing flow)
      const roomId = env.GAME_ROOM.idFromName(lobbyData.gameId);
      const room = env.GAME_ROOM.get(roomId);
      await room.fetch(
        new Request('http://internal/config', {
          method: 'POST',
          body: JSON.stringify({ ...parsed.data, gameId: lobbyData.gameId }),
        }),
      );

      // Register game in the PrivateGroup DO
      const groupGame: GroupGame = {
        gameId: lobbyData.gameId,
        name: parsed.data.name,
        hostUsername: '',
        playerCount: 0,
        maxPlayers: parsed.data.maxPlayers,
        phase: 'waiting',
        createdAt: Date.now(),
        categoryIds: parsed.data.categoryIds,
        aiTopic: parsed.data.aiTopic,
        gameMode: 'trivia',
      };
      const groupRes = await group.fetch(
        new Request('http://internal/games', {
          method: 'POST',
          body: JSON.stringify(groupGame),
        }),
      );

      // Propagate limit errors from group
      if (!groupRes.ok) {
        const errorData = (await groupRes.json()) as { error: string };
        return Response.json({ error: errorData.error }, { status: groupRes.status });
      }

      logEvent(env, 'game_created', {
        gameId: lobbyData.gameId,
        gameMode: 'trivia',
        name: parsed.data.name,
        categoryIds: parsed.data.categoryIds,
        questionCount: parsed.data.questionCount,
        maxPlayers: parsed.data.maxPlayers,
        aiTopic: parsed.data.aiTopic ?? null,
        isPrivate: true,
        isGroupGame: true,
        groupId,
      }).catch(() => {});

      return Response.json({ gameId: lobbyData.gameId });
    }

    // GET /api/ai-question-bank — list banked AI topics and counts
    if (method === 'GET' && url.pathname === '/api/ai-question-bank') {
      const topics = await getAIQuestionBankTopics(env.TRIVIA_KV);
      return Response.json({ topics });
    }

    // --- Scavenger Hunt Endpoints ---

    // POST /api/hunts — create a scavenger hunt (requires auth + credits)
    if (method === 'POST' && url.pathname === '/api/hunts') {
      if (!gameCreateLimiter.check(getClientIP(request))) return rateLimitedResponse();

      const user = await getSessionUser(request, env);
      if (!user) return Response.json({ error: 'Sign in to create a scavenger hunt' }, { status: 401 });

      const body = await request.json();
      const parsed = HuntConfigSchema.safeParse(body);
      if (!parsed.success) {
        return Response.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      // Validate minimum credits (items x retries x maxPlayers)
      const minCredits = parsed.data.items.length * parsed.data.maxRetries * parsed.data.maxPlayers;
      if (user.credits < minCredits) {
        return Response.json({
          error: 'Not enough credits to create this hunt',
          creditsNeeded: minCredits,
        }, { status: 402 });
      }

      // Create lobby listing
      const lobbyId = env.GAME_LOBBY.idFromName('global');
      const lobby = env.GAME_LOBBY.get(lobbyId);
      const lobbyRes = await lobby.fetch(
        new Request('http://internal/games', {
          method: 'POST',
          body: JSON.stringify({
            ...parsed.data,
            gameMode: 'scavenger-hunt',
          }),
        }),
      );
      const lobbyData = (await lobbyRes.json()) as { gameId: string };
      const huntId = lobbyData.gameId;

      // Configure the ScavengerHuntRoom DO
      const roomId = env.SCAVENGER_HUNT_ROOM.idFromName(huntId);
      const room = env.SCAVENGER_HUNT_ROOM.get(roomId);
      await room.fetch(
        new Request('http://internal/config', {
          method: 'POST',
          body: JSON.stringify({ ...parsed.data, huntId, hostEmail: user.email }),
        }),
      );

      logEvent(env, 'hunt_created', {
        huntId,
        name: parsed.data.name,
        itemCount: parsed.data.items.length,
        maxPlayers: parsed.data.maxPlayers,
        durationMinutes: parsed.data.durationMinutes,
        maxRetries: parsed.data.maxRetries,
        isPrivate: parsed.data.isPrivate,
        isGroupGame: false,
      }).catch(() => {});

      return Response.json({ huntId });
    }

    // POST /api/hunts/:huntId/photos — upload a photo for verification
    // No auth required — knowing the huntId (private link) is sufficient for players
    if (method === 'POST' && url.pathname.match(/^\/api\/hunts\/[^/]+\/photos$/)) {
      if (!photoUploadLimiter.check(getClientIP(request))) return rateLimitedResponse();
      const huntId = url.pathname.split('/api/hunts/')[1].split('/photos')[0];

      // Parse multipart form data
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      const itemId = formData.get('itemId') as string | null;

      if (!file || !itemId) {
        return Response.json({ error: 'Missing file or itemId' }, { status: 400 });
      }

      // Validate file size
      if (file.size > HUNT_LIMITS.maxPhotoSizeBytes) {
        return Response.json({ error: 'Photo too large (max 5MB)' }, { status: 400 });
      }

      // Read file bytes once for both validation and storage
      const buffer = await file.arrayBuffer();

      // Determine content type: trust declared type if valid, otherwise
      // detect from magic bytes (some mobile browsers send wrong Content-Type)
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      let contentType = file.type;
      if (!allowedTypes.includes(contentType)) {
        const bytes = new Uint8Array(buffer);
        if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
          contentType = 'image/jpeg';
        } else if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
          contentType = 'image/png';
        } else if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
          && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
          contentType = 'image/webp';
        } else {
          return Response.json({ error: 'Invalid file type. Use JPEG, PNG, or WebP.' }, { status: 400 });
        }
      }

      const uploadId = crypto.randomUUID();
      const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
      const key = `${huntId}/${uploadId}.${ext}`;

      // Store in R2
      await env.R2_HUNT_PHOTOS.put(key, buffer, {
        httpMetadata: { contentType },
      });

      return Response.json({ uploadId: `${uploadId}.${ext}` });
    }

    // POST /api/groups/:groupId/hunts — create a hunt within a group (requires auth + credits)
    if (method === 'POST' && url.pathname.match(/^\/api\/groups\/[^/]+\/hunts$/)) {
      if (!groupGameLimiter.check(getClientIP(request))) return rateLimitedResponse();

      const user = await getSessionUser(request, env);
      if (!user) return Response.json({ error: 'Sign in to create a scavenger hunt' }, { status: 401 });

      const groupId = url.pathname.split('/api/groups/')[1].split('/hunts')[0];

      // Validate group exists
      const doId = env.PRIVATE_GROUP.idFromName(groupId);
      const group = env.PRIVATE_GROUP.get(doId);
      const checkRes = await group.fetch(new Request('http://internal/state'));
      if (!checkRes.ok) return Response.json({ error: 'Group not found' }, { status: 404 });

      const body = await request.json();
      const parsed = HuntConfigSchema.safeParse({ ...(body as object), isPrivate: true, groupId });
      if (!parsed.success) {
        return Response.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      // Validate minimum credits
      const minCredits = parsed.data.items.length * parsed.data.maxRetries * parsed.data.maxPlayers;
      if (user.credits < minCredits) {
        return Response.json({
          error: 'Not enough credits to create this hunt',
          creditsNeeded: minCredits,
        }, { status: 402 });
      }

      // Create lobby listing
      const lobbyId = env.GAME_LOBBY.idFromName('global');
      const lobby = env.GAME_LOBBY.get(lobbyId);
      const lobbyRes = await lobby.fetch(
        new Request('http://internal/games', {
          method: 'POST',
          body: JSON.stringify({
            ...parsed.data,
            gameMode: 'scavenger-hunt',
          }),
        }),
      );
      const lobbyData = (await lobbyRes.json()) as { gameId: string };
      const huntId = lobbyData.gameId;

      // Configure the ScavengerHuntRoom DO
      const roomId = env.SCAVENGER_HUNT_ROOM.idFromName(huntId);
      const room = env.SCAVENGER_HUNT_ROOM.get(roomId);
      await room.fetch(
        new Request('http://internal/config', {
          method: 'POST',
          body: JSON.stringify({ ...parsed.data, huntId, hostEmail: user.email }),
        }),
      );

      // Register in group
      const groupGame: GroupGame = {
        gameId: huntId,
        name: parsed.data.name,
        hostUsername: '',
        playerCount: 0,
        maxPlayers: parsed.data.maxPlayers,
        phase: 'waiting',
        createdAt: Date.now(),
        categoryIds: [],
        gameMode: 'scavenger-hunt',
      };
      const groupRes = await group.fetch(
        new Request('http://internal/games', {
          method: 'POST',
          body: JSON.stringify(groupGame),
        }),
      );

      if (!groupRes.ok) {
        const errorData = (await groupRes.json()) as { error: string };
        return Response.json({ error: errorData.error }, { status: groupRes.status });
      }

      logEvent(env, 'hunt_created', {
        huntId,
        name: parsed.data.name,
        itemCount: parsed.data.items.length,
        maxPlayers: parsed.data.maxPlayers,
        durationMinutes: parsed.data.durationMinutes,
        maxRetries: parsed.data.maxRetries,
        isPrivate: true,
        isGroupGame: true,
        groupId,
      }).catch(() => {});

      return Response.json({ huntId });
    }

    // GET /api/hunts/history — list historical hunts
    if (method === 'GET' && url.pathname === '/api/hunts/history') {
      if (!huntHistoryLimiter.check(getClientIP(request))) return rateLimitedResponse();

      const listResult = await env.TRIVIA_KV.list<HuntHistorySummary>({
        prefix: 'hunt-history:',
      });

      const summaries: HuntHistorySummary[] = listResult.keys
        .filter((k) => k.metadata)
        .map((k) => k.metadata!);

      summaries.sort((a, b) => b.finishedAt - a.finishedAt);

      return Response.json({ hunts: summaries });
    }

    // GET /api/groups/:groupId/hunts/history — list hunt history for a specific group
    if (method === 'GET' && url.pathname.match(/^\/api\/groups\/[^/]+\/hunts\/history$/)) {
      if (!huntHistoryLimiter.check(getClientIP(request))) return rateLimitedResponse();
      const groupId = url.pathname.split('/api/groups/')[1].split('/hunts/history')[0];

      const listResult = await env.TRIVIA_KV.list<HuntHistorySummary>({
        prefix: 'hunt-history:',
      });

      const summaries: HuntHistorySummary[] = listResult.keys
        .filter((k) => k.metadata && k.metadata.groupId === groupId)
        .map((k) => k.metadata!);

      summaries.sort((a, b) => b.finishedAt - a.finishedAt);

      return Response.json({ hunts: summaries });
    }

    // GET /api/hunts/:huntId/photos/:fileName — serve R2 photo
    if (method === 'GET' && url.pathname.match(/^\/api\/hunts\/[^/]+\/photos\/.+$/)) {
      if (!huntHistoryLimiter.check(getClientIP(request))) return rateLimitedResponse();

      const parts = url.pathname.replace('/api/hunts/', '').split('/photos/');
      const huntId = parts[0];
      const photoFileName = parts[1];

      if (!huntId || !photoFileName) {
        return Response.json({ error: 'Invalid photo path' }, { status: 400 });
      }

      // Validate filename format to prevent path traversal
      if (!isValidPhotoFilename(photoFileName)) {
        return Response.json({ error: 'Invalid photo filename' }, { status: 400 });
      }

      const r2Key = `${huntId}/${photoFileName}`;
      const object = await env.R2_HUNT_PHOTOS.get(r2Key);

      if (!object) {
        return new Response('Photo not found', { status: 404 });
      }

      const headers = new Headers();
      headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
      headers.set('Cache-Control', 'public, max-age=86400');
      headers.set('Content-Length', String(object.size));

      return new Response(object.body, { status: 200, headers });
    }

    // GET /api/hunts/:huntId/history — get historical hunt details
    if (method === 'GET' && url.pathname.match(/^\/api\/hunts\/[^/]+\/history$/)) {
      if (!huntHistoryLimiter.check(getClientIP(request))) return rateLimitedResponse();
      const huntId = url.pathname.split('/api/hunts/')[1].split('/history')[0];

      const raw = await env.TRIVIA_KV.get(`hunt-history:${huntId}`);
      if (!raw) {
        return Response.json({ error: 'Hunt not found' }, { status: 404 });
      }

      const entry = JSON.parse(raw) as HuntHistoryEntry;
      const { hostSecret: _, ...safeEntry } = entry;

      return Response.json({ hunt: safeEntry });
    }

    // DELETE /api/hunts/:huntId/history — delete historical hunt (host-only)
    if (method === 'DELETE' && url.pathname.match(/^\/api\/hunts\/[^/]+\/history$/)) {
      if (!huntHistoryLimiter.check(getClientIP(request))) return rateLimitedResponse();
      const huntId = url.pathname.split('/api/hunts/')[1].split('/history')[0];

      const providedSecret = request.headers.get('X-Host-Secret');
      if (!providedSecret) {
        return Response.json({ error: 'Missing host secret' }, { status: 401 });
      }

      const raw = await env.TRIVIA_KV.get(`hunt-history:${huntId}`);
      if (!raw) {
        return Response.json({ error: 'Hunt not found' }, { status: 404 });
      }

      const entry = JSON.parse(raw) as HuntHistoryEntry;
      // Constant-time comparison to prevent timing attacks
      if (!(await timingSafeEqual(entry.hostSecret, providedSecret))) {
        return Response.json({ error: 'Unauthorized' }, { status: 403 });
      }

      // Delete R2 photos for this hunt
      let cursor: string | undefined;
      do {
        const r2List = await env.R2_HUNT_PHOTOS.list({
          prefix: `${huntId}/`,
          ...(cursor ? { cursor } : {}),
        });
        for (const obj of r2List.objects) {
          await env.R2_HUNT_PHOTOS.delete(obj.key);
        }
        cursor = r2List.truncated ? r2List.cursor : undefined;
      } while (cursor);

      await env.TRIVIA_KV.delete(`hunt-history:${huntId}`);

      return Response.json({ ok: true });
    }

    // GET /api/analytics/summary — aggregated analytics (admin-only, gated by SEED_SECRET)
    if (method === 'GET' && url.pathname === '/api/analytics/summary') {
      const authHeader = request.headers.get('Authorization');
      const expectedSecret = env.SEED_SECRET;
      if (!expectedSecret || !authHeader) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const expectedValue = `Bearer ${expectedSecret}`;
      if (authHeader.length !== expectedValue.length || !(await timingSafeEqual(authHeader, expectedValue))) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // Optional query params for filtering
      const eventType = url.searchParams.get('type');   // e.g. 'game_finished'
      const datePrefix = url.searchParams.get('date');  // e.g. '2026-03' or '2026-03-14'

      let prefix = 'evt:';
      if (eventType) prefix += `${eventType}:`;
      if (eventType && datePrefix) prefix += `${datePrefix}`;

      // List matching keys (paginated, up to 10 pages = 10k events max)
      const events: Array<{ key: string; metadata: unknown }> = [];
      let cursor: string | undefined;
      const maxPages = 10;
      let page = 0;

      do {
        const listResult = await env.TRIVIA_KV.list({
          prefix,
          ...(cursor ? { cursor } : {}),
        });

        for (const k of listResult.keys) {
          if (k.metadata) {
            events.push({ key: k.name, metadata: k.metadata });
          }
        }

        cursor = listResult.list_complete ? undefined : listResult.cursor;
        page++;
      } while (cursor && page < maxPages);

      // Build summary counts by event type
      const counts: Record<string, number> = {};
      for (const evt of events) {
        const meta = evt.metadata as { type?: string };
        const t = meta.type || 'unknown';
        counts[t] = (counts[t] || 0) + 1;
      }

      return Response.json({
        totalEvents: events.length,
        counts,
        events: events.slice(0, 200),
        truncated: events.length > 200,
      });
    }

    // GET /api/health
    if (method === 'GET' && url.pathname === '/api/health') {
      return Response.json({ status: 'ok', timestamp: Date.now() });
    }

    return new Response('Not found', { status: 404 });
  } catch (err) {
    // Invalid JSON in request body
    if (err instanceof SyntaxError) {
      return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }
    // Unexpected error (DO failures, network issues, etc.)
    logError(env, { route: url.pathname, method }, err, {
      ip: getClientIP(request),
    });
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
