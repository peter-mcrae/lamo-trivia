import { Hono } from 'hono';
import type { Env } from '../env';
import {
  HuntConfigSchema, HuntHistoryClaimSchema, HUNT_LIMITS, GAME_ID_REGEX,
} from '@lamo-trivia/shared';
import type { HuntHistoryEntry, HuntHistorySummary, User } from '@lamo-trivia/shared';
import { getSessionUser, timingSafeEqual } from '../auth';
import { logEvent } from '../analytics';
import {
  ipRateLimit, gameCreateLimiter, photoUploadLimiter, huntHistoryLimiter, getClientIP,
} from '../middleware/rate-limit';

/** Validate photo filename format to prevent path traversal */
function isValidPhotoFilename(name: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/.test(name);
}

/** Detect image type from file magic bytes when Content-Type is missing/wrong */
function detectImageType(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
  // WebP: RIFF....WEBP
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

/** Hunt IDs are allocated by the lobby, so they always match the game-ID format */
function isValidHuntId(huntId: string): boolean {
  return GAME_ID_REGEX.test(huntId);
}

/** KV key recording which account created a hunt */
function huntHostKey(huntId: string): string {
  return `hunt-host:${huntId}`;
}

/** KV key listing the hunts an account created */
function hostHuntsKey(email: string): string {
  return `host-hunts:${email}`;
}

/** Hunt history entries live for 90 days — keep the host index in step */
const HUNT_HOST_TTL = 90 * 24 * 60 * 60;

/** Cap on the per-host hunt list; the per-hunt key stays authoritative */
const MAX_TRACKED_HUNTS = 200;

/**
 * Record who created a hunt. Nothing else links a hunt to an account: the
 * history entry only carries usernames, so without this index the history
 * routes have no way to tell whose hunt they are handing out.
 */
export async function recordHuntHost(env: Env, huntId: string, email: string): Promise<void> {
  await env.TRIVIA_KV.put(huntHostKey(huntId), email, { expirationTtl: HUNT_HOST_TTL });

  const existing = (await env.TRIVIA_KV.get<string[]>(hostHuntsKey(email), 'json')) ?? [];
  const updated = [huntId, ...existing.filter((id) => id !== huntId)].slice(0, MAX_TRACKED_HUNTS);
  await env.TRIVIA_KV.put(hostHuntsKey(email), JSON.stringify(updated));
}

/**
 * Every hunt ever played sits under the one `hunt-history:` prefix, and a
 * single KV `list()` returns at most 1000 keys. Filtering a single page down to
 * the caller's own hunts would therefore start silently dropping their history
 * the moment strangers' hunts push it off page one — so walk the cursor to the
 * end first, and filter afterwards.
 */
export async function listHuntHistorySummaries(env: Env): Promise<HuntHistorySummary[]> {
  const summaries: HuntHistorySummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.TRIVIA_KV.list<HuntHistorySummary>({
      prefix: 'hunt-history:',
      ...(cursor ? { cursor } : {}),
    });
    for (const key of page.keys) {
      if (key.metadata) summaries.push(key.metadata);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return summaries;
}

/** Groups this account owns — an owner may see hunts played inside them */
async function ownedGroupIds(env: Env, email: string): Promise<Set<string>> {
  const ids = (await env.TRIVIA_KV.get<string[]>(`owner-groups:${email}`, 'json')) ?? [];
  return new Set(ids);
}

/**
 * A hunt's history is visible to the account that created it and to the owner
 * of the group it was played in. Players are recorded by username only, so
 * there is no way to recognise a non-hosting participant here.
 */
async function canViewHunt(
  env: Env,
  email: string,
  huntId: string,
  groupId?: string,
): Promise<boolean> {
  const hostEmail = await env.TRIVIA_KV.get(huntHostKey(huntId));
  if (hostEmail && hostEmail === email) return true;
  if (groupId && (await ownedGroupIds(env, email)).has(groupId)) return true;
  return false;
}

const hunts = new Hono<{ Bindings: Env }>();

// POST /api/hunts — create a scavenger hunt
hunts.post('/', ipRateLimit(gameCreateLimiter), async (c) => {
  const user = await getSessionUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Sign in to create a scavenger hunt' }, 401);

  const body = await c.req.json();
  // `groupId` belongs to the group route, which forces it from the path (see
  // routes/groups.ts). Honouring a client-supplied one here would let anyone
  // staple their hunt onto a victim's group: it shows up in that group's
  // history, and canViewHunt hands the group's owner the hunt's player records
  // and photo keys.
  const { groupId: _clientGroupId, ...huntConfig } = (body ?? {}) as Record<string, unknown>;
  const parsed = HuntConfigSchema.safeParse(huntConfig);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  // Validate minimum credits
  const minCredits = parsed.data.items.length * parsed.data.maxRetries * parsed.data.maxPlayers;
  if (user.credits < minCredits) {
    return c.json({
      error: 'Not enough credits to create this hunt',
      creditsNeeded: minCredits,
    }, 402);
  }

  // Create lobby listing
  const lobbyId = c.env.GAME_LOBBY.idFromName('global');
  const lobby = c.env.GAME_LOBBY.get(lobbyId);
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
  const roomId = c.env.SCAVENGER_HUNT_ROOM.idFromName(huntId);
  const room = c.env.SCAVENGER_HUNT_ROOM.get(roomId);
  await room.fetch(
    new Request('http://internal/config', {
      method: 'POST',
      body: JSON.stringify({ ...parsed.data, huntId, hostEmail: user.email }),
    }),
  );

  await recordHuntHost(c.env, huntId, user.email);

  logEvent(c.env, 'hunt_created', {
    huntId,
    name: parsed.data.name,
    itemCount: parsed.data.items.length,
    maxPlayers: parsed.data.maxPlayers,
    durationMinutes: parsed.data.durationMinutes,
    maxRetries: parsed.data.maxRetries,
    isPrivate: parsed.data.isPrivate,
    isGroupGame: false,
  }).catch(() => {});

  return c.json({ huntId });
});

// POST /api/hunts/:huntId/photos — upload a photo for verification
hunts.post('/:huntId/photos', ipRateLimit(photoUploadLimiter), async (c) => {
  const huntId = c.req.param('huntId')!;

  // Refuse a 5MB write into an arbitrary R2 prefix — the hunt has to exist
  if (!isValidHuntId(huntId) || !(await c.env.TRIVIA_KV.get(huntHostKey(huntId)))) {
    return c.json({ error: 'Hunt not found' }, 404);
  }

  // Photos are only ever submitted mid-play, so once a hunt has written its
  // history there is nothing left to upload for. Without this the hunt stays a
  // writable R2 prefix for as long as its host key lives — another 90 days.
  if (await c.env.TRIVIA_KV.get(`hunt-history:${huntId}`)) {
    return c.json({ error: 'This hunt has already finished' }, 409);
  }

  // Parse multipart form data
  const formData = await c.req.raw.formData();
  const file = formData.get('file') as File | null;
  const itemId = formData.get('itemId') as string | null;

  if (!file || !itemId) {
    return c.json({ error: 'Missing file or itemId' }, 400);
  }

  if (file.size > HUNT_LIMITS.maxPhotoSizeBytes) {
    return c.json({ error: 'Photo too large (max 5MB)' }, 400);
  }

  // Read file bytes once for both validation and storage
  const buffer = await file.arrayBuffer();

  // Always determine the content type from the magic bytes. The declared
  // type is attacker-controlled, and some mobile browsers send Blobs from
  // canvas.toBlob() with an empty or incorrect Content-Type header anyway.
  const contentType = detectImageType(new Uint8Array(buffer));
  if (!contentType) {
    return c.json({ error: 'Invalid file type. Use JPEG, PNG, or WebP.' }, 400);
  }

  const uploadId = crypto.randomUUID();
  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const key = `${huntId}/${uploadId}.${ext}`;

  await c.env.R2_HUNT_PHOTOS.put(key, buffer, {
    httpMetadata: { contentType },
  });

  return c.json({ uploadId: `${uploadId}.${ext}` });
});

/**
 * How many host secrets one request may offer for verification. Each one that
 * names a real hunt costs a KV read, so this is kept well under the Worker
 * subrequest budget — the account index is the normal path, and this is only
 * the recovery route for hunts that predate it.
 */
const MAX_CLAIMED_HUNTS = 50;

/**
 * The hunts a caller proved they host by presenting the hostSecret the hunt
 * handed them when it finished.
 *
 * Nothing here tells "no such hunt" apart from "wrong secret": either way the
 * id is simply absent from the result. There is no per-id status, no count of
 * what was rejected and no error, so offering an id you hold no secret for
 * teaches you nothing about it. The comparison is timingSafeEqual, and a hunt
 * that is not there is still compared — against a fresh random secret of the
 * same shape — so the two rejections cost the same.
 */
async function huntsProvenBySecret(
  env: Env,
  hostSecrets: Record<string, string>,
  known: Map<string, HuntHistorySummary>,
): Promise<HuntHistorySummary[]> {
  const claims = Object.entries(hostSecrets)
    .filter(([huntId]) => isValidHuntId(huntId))
    .slice(0, MAX_CLAIMED_HUNTS);

  const proven = await Promise.all(
    claims.map(async ([huntId, offered]) => {
      const raw = known.has(huntId) ? await env.TRIVIA_KV.get(`hunt-history:${huntId}`) : null;
      const stored = raw ? (JSON.parse(raw) as HuntHistoryEntry).hostSecret : null;
      const matches = await timingSafeEqual(stored ?? crypto.randomUUID(), offered);
      return matches ? known.get(huntId)! : null;
    }),
  );

  return proven.filter((s): s is HuntHistorySummary => s !== null);
}

/**
 * A caller's hunt list: the hunts their account is indexed against, plus any
 * they can still prove with a hostSecret.
 *
 * The account index (`host-hunts:{email}`) is empty for every hunt created
 * before it existed, so on its own it hides those hunts from the very host who
 * made them — who can nonetheless open each one directly, because the detail
 * route takes the same secret as a fallback. The list has to accept it too.
 */
async function collectHistory(
  env: Env,
  user: User | null,
  hostSecrets: Record<string, string>,
): Promise<HuntHistorySummary[]> {
  const all = await listHuntHistorySummaries(env);
  const known = new Map(all.map((s) => [s.huntId, s]));
  const mine = new Map<string, HuntHistorySummary>();

  if (user) {
    const [hostedIds, groupIds] = await Promise.all([
      env.TRIVIA_KV.get<string[]>(hostHuntsKey(user.email), 'json'),
      ownedGroupIds(env, user.email),
    ]);
    const hosted = new Set(hostedIds ?? []);
    for (const s of all) {
      if (hosted.has(s.huntId) || (s.groupId != null && groupIds.has(s.groupId))) {
        mine.set(s.huntId, s);
      }
    }
  }

  for (const s of await huntsProvenBySecret(env, hostSecrets, known)) {
    mine.set(s.huntId, s);
  }

  return Array.from(mine.values()).sort((a, b) => b.finishedAt - a.finishedAt);
}

// GET /api/hunts/history — list the hunts indexed against the caller's account
hunts.get('/history', async (c) => {
  if (!huntHistoryLimiter.check(getClientIP(c.req.raw))) {
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }

  const user = await getSessionUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Sign in to view your hunt history' }, 401);

  return c.json({ hunts: await collectHistory(c.env, user, {}) });
});

// POST /api/hunts/history — the same list, plus the hunts the caller proves by
// sending the hostSecrets it still holds in local storage. A POST because the
// proof has to travel in a body: host secrets must never end up in a URL.
hunts.post('/history', async (c) => {
  if (!huntHistoryLimiter.check(getClientIP(c.req.raw))) {
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }

  const parsed = HuntHistoryClaimSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const { hostSecrets } = parsed.data;

  // A secret is proof in its own right — the detail route already treats it
  // that way — so a signed-out host may still ask about hunts they can prove.
  // With neither a session nor a single secret there is nothing to answer.
  const user = await getSessionUser(c.req.raw, c.env);
  if (!user && Object.keys(hostSecrets).length === 0) {
    return c.json({ error: 'Sign in to view your hunt history' }, 401);
  }

  return c.json({ hunts: await collectHistory(c.env, user, hostSecrets) });
});

// GET /api/hunts/:huntId/photos/:fileName — serve R2 photo
hunts.get('/:huntId/photos/:fileName', async (c) => {
  if (!huntHistoryLimiter.check(getClientIP(c.req.raw))) {
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }

  const huntId = c.req.param('huntId');
  const photoFileName = c.req.param('fileName');

  if (!huntId || !photoFileName) {
    return c.json({ error: 'Invalid photo path' }, 400);
  }

  if (!isValidHuntId(huntId)) {
    return c.json({ error: 'Invalid hunt ID' }, 400);
  }

  if (!isValidPhotoFilename(photoFileName)) {
    return c.json({ error: 'Invalid photo filename' }, 400);
  }

  const r2Key = `${huntId}/${photoFileName}`;
  const object = await c.env.R2_HUNT_PHOTOS.get(r2Key);

  if (!object) {
    return new Response('Photo not found', { status: 404 });
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=86400');
  headers.set('Content-Length', String(object.size));

  return new Response(object.body, { status: 200, headers });
});

// GET /api/hunts/:huntId/history — get historical hunt details
hunts.get('/:huntId/history', async (c) => {
  if (!huntHistoryLimiter.check(getClientIP(c.req.raw))) {
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }

  const huntId = c.req.param('huntId');
  const raw = await c.env.TRIVIA_KV.get(`hunt-history:${huntId}`);
  if (!raw) {
    return c.json({ error: 'Hunt not found' }, 404);
  }

  const entry = JSON.parse(raw) as HuntHistoryEntry;

  // The host index (hunt-host:{huntId}) only exists for hunts created after it
  // was introduced, so account-based access alone would make every older hunt
  // unreadable by anyone. The host still holds hostSecret in localStorage, and
  // DELETE below already trusts it for a strictly stronger operation — so
  // accept it here as a fallback rather than stranding existing history.
  const providedSecret = c.req.header('X-Host-Secret');
  const isHostBySecret = providedSecret
    ? await timingSafeEqual(entry.hostSecret, providedSecret)
    : false;

  if (!isHostBySecret) {
    const user = await getSessionUser(c.req.raw, c.env);
    if (!user) return c.json({ error: 'Sign in to view hunt history' }, 401);

    // Player records and photo keys — only for the host or the group's owner
    if (!(await canViewHunt(c.env, user.email, huntId, entry.groupId))) {
      return c.json({ error: 'You do not have access to this hunt' }, 403);
    }
  }

  const { hostSecret: _, ...safeEntry } = entry;

  return c.json({ hunt: safeEntry });
});

// DELETE /api/hunts/:huntId/history — delete historical hunt (host-only)
hunts.delete('/:huntId/history', async (c) => {
  if (!huntHistoryLimiter.check(getClientIP(c.req.raw))) {
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }

  const huntId = c.req.param('huntId');
  const providedSecret = c.req.header('X-Host-Secret');
  if (!providedSecret) {
    return c.json({ error: 'Missing host secret' }, 401);
  }

  const raw = await c.env.TRIVIA_KV.get(`hunt-history:${huntId}`);
  if (!raw) {
    return c.json({ error: 'Hunt not found' }, 404);
  }

  const entry = JSON.parse(raw) as HuntHistoryEntry;
  if (!(await timingSafeEqual(entry.hostSecret, providedSecret))) {
    return c.json({ error: 'Unauthorized' }, 403);
  }

  // Delete R2 photos for this hunt
  let cursor: string | undefined;
  do {
    const r2List = await c.env.R2_HUNT_PHOTOS.list({
      prefix: `${huntId}/`,
      ...(cursor ? { cursor } : {}),
    });
    for (const obj of r2List.objects) {
      await c.env.R2_HUNT_PHOTOS.delete(obj.key);
    }
    cursor = r2List.truncated ? r2List.cursor : undefined;
  } while (cursor);

  await c.env.TRIVIA_KV.delete(`hunt-history:${huntId}`);

  return c.json({ ok: true });
});

export { hunts as huntRoutes };
