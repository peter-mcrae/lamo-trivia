import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../env';
import {
  GameConfigSchema, HuntConfigSchema, GroupNameSchema, GroupMemberLinkSchema,
  generateGroupId, HUNT_LIMITS,
} from '@lamo-trivia/shared';
import type { GroupGame } from '@lamo-trivia/shared';
import { getSessionUser } from '../auth';
import { recordHuntHost, listHuntHistorySummaries } from './hunts';
import { logEvent } from '../analytics';
import {
  ipRateLimit, groupCreateLimiter, groupGameLimiter, huntHistoryLimiter, getClientIP,
} from '../middleware/rate-limit';

const groups = new Hono<{ Bindings: Env }>();

interface GroupStateResponse {
  id: string;
  name: string;
  createdAt: number;
  ownerEmail?: string;
  memberCount: number;
}

/**
 * Read a group's state from its DO. ownerEmail is only returned when asked
 * for, so a handler has to opt in before it can leak one.
 */
async function fetchGroupState(
  c: Context<{ Bindings: Env }>,
  groupId: string,
  includeOwner = false,
): Promise<GroupStateResponse | null> {
  const doId = c.env.PRIVATE_GROUP.idFromName(groupId);
  const group = c.env.PRIVATE_GROUP.get(doId);
  const res = await group.fetch(
    new Request(`http://internal/state${includeOwner ? '?includeOwner=1' : ''}`),
  );
  if (!res.ok) return null;
  return (await res.json()) as GroupStateResponse;
}

/**
 * Does `email` belong to this group — as its owner, or as a member whose
 * record has been linked to that account?
 *
 * The group DO owns the member list, so it is the only thing that can answer
 * the second half. Anything short of an explicit `isMember: true` is a no: a
 * DO that errored, or one not yet redeployed with /membership, must not be
 * read as "sure, come in".
 */
async function callerBelongsToGroup(
  c: Context<{ Bindings: Env }>,
  groupId: string,
  state: GroupStateResponse,
  email: string,
): Promise<boolean> {
  if (state.ownerEmail && state.ownerEmail.toLowerCase() === email.toLowerCase()) {
    return true;
  }

  const doId = c.env.PRIVATE_GROUP.idFromName(groupId);
  const group = c.env.PRIVATE_GROUP.get(doId);
  try {
    const res = await group.fetch(
      new Request('http://internal/membership', { headers: { 'X-Caller-Email': email } }),
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { isMember?: boolean };
    return data.isMember === true;
  } catch {
    return false;
  }
}

// POST /api/groups — create a new private group (requires auth)
groups.post('/', ipRateLimit(groupCreateLimiter), async (c) => {
  const user = await getSessionUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Sign in to create a group' }, 401);

  const body = (await c.req.json()) as { name: string };
  const parsed = GroupNameSchema.safeParse(body.name);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  let groupId = generateGroupId();
  const doId = c.env.PRIVATE_GROUP.idFromName(groupId);
  const group = c.env.PRIVATE_GROUP.get(doId);
  const res = await group.fetch(
    new Request('http://internal/init', {
      method: 'POST',
      body: JSON.stringify({ id: groupId, name: parsed.data, ownerEmail: user.email }),
    }),
  );

  if (!res.ok) {
    // Extremely unlikely collision — retry once with new ID
    const retryId = generateGroupId();
    const retryDoId = c.env.PRIVATE_GROUP.idFromName(retryId);
    const retryGroup = c.env.PRIVATE_GROUP.get(retryDoId);
    await retryGroup.fetch(
      new Request('http://internal/init', {
        method: 'POST',
        body: JSON.stringify({ id: retryId, name: parsed.data, ownerEmail: user.email }),
      }),
    );
    groupId = retryId;
  }

  // Index group by owner email for recovery
  const ownerKey = `owner-groups:${user.email}`;
  const existing = await c.env.TRIVIA_KV.get<string[]>(ownerKey, 'json') ?? [];
  existing.push(groupId);
  await c.env.TRIVIA_KV.put(ownerKey, JSON.stringify(existing));

  return c.json({ groupId, name: parsed.data });
});

// GET /api/groups/my — list groups owned by the authenticated user
groups.get('/my', async (c) => {
  const user = await getSessionUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const ownerKey = `owner-groups:${user.email}`;
  const groupIds = await c.env.TRIVIA_KV.get<string[]>(ownerKey, 'json') ?? [];

  const result: { groupId: string; name: string }[] = [];
  for (const gid of groupIds) {
    const doId = c.env.PRIVATE_GROUP.idFromName(gid);
    const group = c.env.PRIVATE_GROUP.get(doId);
    const res = await group.fetch(new Request('http://internal/state'));
    if (res.ok) {
      const data = (await res.json()) as { id: string; name: string };
      result.push({ groupId: data.id, name: data.name });
    }
  }
  return c.json({ groups: result });
});

// GET /api/groups/:groupId — validate group exists
groups.get('/:groupId', async (c) => {
  const groupId = c.req.param('groupId');
  const state = await fetchGroupState(c, groupId, true);
  if (!state) return c.json({ error: 'Group not found' }, 404);

  // ownerEmail is a real person's address. The owner's own client needs it to
  // unlock owner-only controls; nobody else gets to see it.
  const user = await getSessionUser(c.req.raw, c.env);
  const { ownerEmail, ...publicState } = state;
  const isOwner = !!user && !!ownerEmail && ownerEmail === user.email;

  return c.json(isOwner ? { ...publicState, ownerEmail } : publicState);
});

// DELETE /api/groups/:groupId — delete a group (owner only)
groups.delete('/:groupId', async (c) => {
  const user = await getSessionUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Sign in to delete a group' }, 401);

  const groupId = c.req.param('groupId')!;
  const doId = c.env.PRIVATE_GROUP.idFromName(groupId);
  const group = c.env.PRIVATE_GROUP.get(doId);

  // Check group exists and verify ownership
  const state = await fetchGroupState(c, groupId, true);
  if (!state) return c.json({ error: 'Group not found' }, 404);
  if (state.ownerEmail !== user.email) {
    return c.json({ error: 'Only the group owner can delete it' }, 403);
  }

  // Delete the group
  await group.fetch(new Request('http://internal/delete', { method: 'POST' }));

  // Remove from owner's group list in KV
  const ownerKey = `owner-groups:${user.email}`;
  const existing = await c.env.TRIVIA_KV.get<string[]>(ownerKey, 'json') ?? [];
  const updated = existing.filter((id) => id !== groupId);
  await c.env.TRIVIA_KV.put(ownerKey, JSON.stringify(updated));

  return c.json({ ok: true });
});

/**
 * POST /api/groups/:groupId/members/link — tie a member record to the caller's
 * account so their membership can actually be verified later.
 *
 * The client proves the record is theirs with the `memberId` the group DO
 * issued it on join. Sending no memberId asks the opposite question — "which
 * member record does my account already own?" — which is how someone who lost
 * their local memberId gets back in without username-based recovery.
 */
groups.post('/:groupId/members/link', async (c) => {
  const user = await getSessionUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Sign in to link your group membership' }, 401);

  const groupId = c.req.param('groupId')!;
  const body = await c.req.json().catch(() => ({}));
  const parsed = GroupMemberLinkSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const doId = c.env.PRIVATE_GROUP.idFromName(groupId);
  const group = c.env.PRIVATE_GROUP.get(doId);
  const res = await group.fetch(
    new Request('http://internal/members/link', {
      method: 'POST',
      headers: { 'X-Caller-Email': user.email },
      body: JSON.stringify(parsed.data),
    }),
  );

  const data = (await res.json()) as Record<string, unknown>;
  return c.json(data, res.status as 200);
});

// POST /api/groups/:groupId/games — create a game within a group
groups.post('/:groupId/games', ipRateLimit(groupGameLimiter), async (c) => {
  const user = await getSessionUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Sign in to create a game in this group' }, 401);

  const groupId = c.req.param('groupId')!;
  const doId = c.env.PRIVATE_GROUP.idFromName(groupId);
  const group = c.env.PRIVATE_GROUP.get(doId);

  // Validate the group exists and that the caller belongs to it. Anyone else
  // holding the group ID could otherwise fill the group's active-game cap and
  // spam every member with invites.
  const state = await fetchGroupState(c, groupId, true);
  if (!state) return c.json({ error: 'Group not found' }, 404);
  if (!(await callerBelongsToGroup(c, groupId, state, user.email))) {
    return c.json(
      { error: 'Only members of this group can create games in it', code: 'NOT_A_MEMBER' },
      403,
    );
  }

  // Parse game config — force isPrivate=true and set groupId
  const body = await c.req.json();
  const parsed = GameConfigSchema.safeParse({ ...(body as object), isPrivate: true, groupId });
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  // Create game in lobby
  const lobbyId = c.env.GAME_LOBBY.idFromName('global');
  const lobby = c.env.GAME_LOBBY.get(lobbyId);
  const lobbyRes = await lobby.fetch(
    new Request('http://internal/games', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
    }),
  );
  const lobbyData = (await lobbyRes.json()) as { gameId: string };

  // Configure the GameRoom
  const roomId = c.env.GAME_ROOM.idFromName(lobbyData.gameId);
  const room = c.env.GAME_ROOM.get(roomId);
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
      headers: { 'X-Caller-Email': user.email },
      body: JSON.stringify(groupGame),
    }),
  );

  if (!groupRes.ok) {
    // Pass the DO's machine-readable `code` through. The client relies on
    // NOT_A_MEMBER to self-heal a pre-existing membership that has no account
    // link yet; stripping it leaves the client matching on prose instead.
    const errorData = (await groupRes.json()) as { error: string; code?: string };
    return c.json(
      { error: errorData.error, ...(errorData.code ? { code: errorData.code } : {}) },
      groupRes.status as 400,
    );
  }

  logEvent(c.env, 'game_created', {
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

  return c.json({ gameId: lobbyData.gameId });
});

// POST /api/groups/:groupId/hunts — create a hunt within a group
groups.post('/:groupId/hunts', ipRateLimit(groupGameLimiter), async (c) => {
  const user = await getSessionUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Sign in to create a scavenger hunt' }, 401);

  const groupId = c.req.param('groupId')!;

  // Validate the group exists and the caller belongs to it — checked up front
  // so a stranger never gets as far as spending credits or creating a room.
  const doId = c.env.PRIVATE_GROUP.idFromName(groupId);
  const group = c.env.PRIVATE_GROUP.get(doId);
  const state = await fetchGroupState(c, groupId, true);
  if (!state) return c.json({ error: 'Group not found' }, 404);
  if (!(await callerBelongsToGroup(c, groupId, state, user.email))) {
    return c.json(
      { error: 'Only members of this group can create games in it', code: 'NOT_A_MEMBER' },
      403,
    );
  }

  const body = await c.req.json();
  const parsed = HuntConfigSchema.safeParse({ ...(body as object), isPrivate: true, groupId });
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
      headers: { 'X-Caller-Email': user.email },
      body: JSON.stringify(groupGame),
    }),
  );

  if (!groupRes.ok) {
    // Pass the DO's machine-readable `code` through. The client relies on
    // NOT_A_MEMBER to self-heal a pre-existing membership that has no account
    // link yet; stripping it leaves the client matching on prose instead.
    const errorData = (await groupRes.json()) as { error: string; code?: string };
    return c.json(
      { error: errorData.error, ...(errorData.code ? { code: errorData.code } : {}) },
      groupRes.status as 400,
    );
  }

  await recordHuntHost(c.env, huntId, user.email);

  logEvent(c.env, 'hunt_created', {
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

  return c.json({ huntId });
});

// GET /api/groups/:groupId/hunts/history — hunt history for a group
groups.get('/:groupId/hunts/history', async (c) => {
  if (!huntHistoryLimiter.check(getClientIP(c.req.raw))) {
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }

  const groupId = c.req.param('groupId')!;

  // Every hunt this group ever played — who hosted it, who won, what they
  // scored. Knowing the group ID is not a claim on any of that, so this is
  // scoped the same way creating a game in the group is.
  const user = await getSessionUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Sign in to view this group\'s hunt history' }, 401);

  const state = await fetchGroupState(c, groupId, true);
  if (!state) return c.json({ error: 'Group not found' }, 404);
  if (!(await callerBelongsToGroup(c, groupId, state, user.email))) {
    return c.json(
      { error: 'Only members of this group can view its hunt history', code: 'NOT_A_MEMBER' },
      403,
    );
  }

  const summaries = (await listHuntHistorySummaries(c.env))
    .filter((s) => s.groupId === groupId)
    .sort((a, b) => b.finishedAt - a.finishedAt);

  return c.json({ hunts: summaries });
});

export { groups as groupRoutes };
