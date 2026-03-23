import { Hono } from 'hono';
import type { Env } from '../env';
import { HuntConfigSchema, HUNT_LIMITS } from '@lamo-trivia/shared';
import type { HuntHistoryEntry, HuntHistorySummary } from '@lamo-trivia/shared';
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

const hunts = new Hono<{ Bindings: Env }>();

// POST /api/hunts — create a scavenger hunt
hunts.post('/', ipRateLimit(gameCreateLimiter), async (c) => {
  const user = await getSessionUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Sign in to create a scavenger hunt' }, 401);

  const body = await c.req.json();
  const parsed = HuntConfigSchema.safeParse(body);
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
  const huntId = c.req.param('huntId');

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

  // Determine content type: trust the declared type if valid, otherwise
  // detect from magic bytes. Some mobile browsers send Blobs from
  // canvas.toBlob() with an empty or incorrect Content-Type header.
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  let contentType: string = file.type;
  if (!allowedTypes.includes(contentType)) {
    const detected = detectImageType(new Uint8Array(buffer));
    if (!detected) {
      return c.json({ error: 'Invalid file type. Use JPEG, PNG, or WebP.' }, 400);
    }
    contentType = detected;
  }

  const uploadId = crypto.randomUUID();
  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const key = `${huntId}/${uploadId}.${ext}`;

  await c.env.R2_HUNT_PHOTOS.put(key, buffer, {
    httpMetadata: { contentType },
  });

  return c.json({ uploadId: `${uploadId}.${ext}` });
});

// GET /api/hunts/history — list historical hunts
hunts.get('/history', async (c) => {
  if (!huntHistoryLimiter.check(getClientIP(c.req.raw))) {
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }

  const listResult = await c.env.TRIVIA_KV.list<HuntHistorySummary>({
    prefix: 'hunt-history:',
  });

  const summaries: HuntHistorySummary[] = listResult.keys
    .filter((k) => k.metadata)
    .map((k) => k.metadata!);

  summaries.sort((a, b) => b.finishedAt - a.finishedAt);

  return c.json({ hunts: summaries });
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
