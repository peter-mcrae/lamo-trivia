import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HuntConfigInput } from '@lamo-trivia/shared';
import { api, ApiError, AUTH_TOKEN_KEY } from '../api';

// --- fetch mocking helpers ---
//
// api.ts talks to `fetch` directly, so every test drives a stubbed global
// `fetch` rather than hitting a network. `fetchJSON` (the shared internal
// helper behind almost every `api.*` call) requires a JSON content-type
// before it will even look at `response.ok`, so every mocked response must
// carry one.

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const ok = init.ok ?? true;
  const status = init.status ?? (ok ? 200 : 400);
  return {
    ok,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: async () => body,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Mirrors the private `HUNT_HOST_SECRETS_KEY` constant in lib/api.ts. */
const HUNT_HOST_SECRETS_KEY = 'lamo-hunt-host-secrets';

const huntConfig: HuntConfigInput = {
  name: 'Test Hunt',
  items: [{ id: 'item-1', description: 'Find the red door', basePoints: 1000, clues: [] }],
  durationMinutes: 30,
  maxRetries: 2,
  basePointsPerItem: 1000,
  hintPointCost: 200,
  minPlayers: 1,
  maxPlayers: 2,
  isPrivate: false,
  savePhotos: false,
};

// =====================================================================
// a) withMembershipRetry (exercised via api.createGroupHunt, which is not
//    exported directly — hunt creation costs no credits, so retrying it
//    carries no double-charge risk, unlike trivia game creation would).
// =====================================================================
describe('withMembershipRetry (via createGroupHunt)', () => {
  it('does not retry when the link response resolves but `linked` is false', async () => {
    // Regression pin: an earlier version bound the whole link response and
    // treated any resolved call as success, even one that linked nothing.
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ error: 'Not a member', code: 'NOT_A_MEMBER' }, { ok: false, status: 403 }),
      )
      .mockResolvedValueOnce(jsonResponse({ memberId: 'm1', username: 'X', linked: false }))
      // If the buggy "any resolved response counts" logic retried anyway,
      // this third call would be hit and would succeed — masking the bug.
      .mockResolvedValueOnce(jsonResponse({ huntId: 'SHOULD-NOT-BE-REACHED' }));

    await expect(api.createGroupHunt('GRP-1', huntConfig)).rejects.toMatchObject({
      code: 'NOT_A_MEMBER',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries once when the link resolves with linked: true', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ error: 'Not a member', code: 'NOT_A_MEMBER' }, { ok: false, status: 403 }),
      )
      .mockResolvedValueOnce(jsonResponse({ memberId: 'm1', username: 'X', linked: true }))
      .mockResolvedValueOnce(jsonResponse({ huntId: 'HUNT-99' }));

    await expect(api.createGroupHunt('GRP-1', huntConfig)).resolves.toEqual({ huntId: 'HUNT-99' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toContain('/groups/GRP-1/members/link');
  });

  it('still retries when the failure carries no machine-readable code, matching on status 403 + message shape', async () => {
    // The late (Durable Object level) rejection is re-wrapped by the backend
    // as `c.json({ error: errorData.error }, status)`, which drops `code`
    // entirely. The client must still recognise this as "not a member".
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ error: 'You are not a member of this group' }, { ok: false, status: 403 }),
      )
      .mockResolvedValueOnce(jsonResponse({ memberId: 'm1', username: 'X', linked: true }))
      .mockResolvedValueOnce(jsonResponse({ huntId: 'HUNT-100' }));

    await expect(api.createGroupHunt('GRP-1', huntConfig)).resolves.toEqual({ huntId: 'HUNT-100' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries at most once — a second failure propagates instead of looping', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ error: 'Not a member', code: 'NOT_A_MEMBER' }, { ok: false, status: 403 }),
      )
      .mockResolvedValueOnce(jsonResponse({ memberId: 'm1', username: 'X', linked: true }))
      .mockResolvedValueOnce(
        jsonResponse({ error: 'Still not a member', code: 'NOT_A_MEMBER' }, { ok: false, status: 403 }),
      );

    await expect(api.createGroupHunt('GRP-1', huntConfig)).rejects.toMatchObject({
      code: 'NOT_A_MEMBER',
      message: expect.stringContaining('Still not a member'),
    });
    // original + one link attempt + one retry — never a second link attempt
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // --- Controls: these pass against both the pre-fix and fixed code, since
  // pre-fix `createGroupHunt` had no retry wrapper at all and so never
  // touched a second endpoint for any error. Kept as safety nets against the
  // retry logic over-matching, not as regression pins. ---

  it('[control] a non-membership 500 error propagates untouched', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'Internal Server Error', code: 'INTERNAL' }, { ok: false, status: 500 }),
    );

    // Asserting on the message only (not status/code): pre-fix errors were
    // plain `Error`s with no status/code at all, so a status/code assertion
    // would fail pre-fix for an unrelated reason and stop being a clean
    // control. The message survives on both.
    await expect(api.createGroupHunt('GRP-1', huntConfig)).rejects.toThrow('Internal Server Error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('[control] a 403 that is not about membership propagates untouched', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'Forbidden: banned from this group', code: 'BANNED' }, { ok: false, status: 403 }),
    );

    await expect(api.createGroupHunt('GRP-1', huntConfig)).rejects.toThrow('Forbidden: banned from this group');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// =====================================================================
// b) fetchJSON header merging — a caller-supplied `headers` object must not
//    wipe out the Content-Type / Authorization defaults. Exercised through
//    getHuntHistoryDetail, the one caller that passes custom headers.
// =====================================================================
describe('fetchJSON header merging', () => {
  it('keeps Content-Type and the bearer token when the caller supplies its own headers', async () => {
    localStorage.setItem(AUTH_TOKEN_KEY, 'token-123');
    localStorage.setItem(HUNT_HOST_SECRETS_KEY, JSON.stringify({ 'HUNT-1': 'secret-abc' }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ hunt: { huntId: 'HUNT-1' } }));

    await api.getHuntHistoryDetail('HUNT-1');

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer token-123',
      'X-Host-Secret': 'secret-abc',
    });
  });
});

// =====================================================================
// c) getHuntHistory — POSTs { hostSecrets } built from the
//    lamo-hunt-host-secrets localStorage map.
// =====================================================================
describe('getHuntHistory', () => {
  it('sends a POST, not a GET', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ hunts: [] }));

    await api.getHuntHistory();

    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe('POST');
  });

  it('builds hostSecrets from the lamo-hunt-host-secrets localStorage map', async () => {
    localStorage.setItem(
      HUNT_HOST_SECRETS_KEY,
      JSON.stringify({ 'hunt-1': 'secret-1', 'hunt-2': 'secret-2' }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ hunts: [] }));

    await api.getHuntHistory();

    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({
      hostSecrets: { 'hunt-1': 'secret-1', 'hunt-2': 'secret-2' },
    });
  });

  it('caps at 50 entries, keeping the most recently saved', async () => {
    const all = Object.fromEntries(Array.from({ length: 55 }, (_, i) => [`hunt-${i}`, `secret-${i}`]));
    localStorage.setItem(HUNT_HOST_SECRETS_KEY, JSON.stringify(all));
    fetchMock.mockResolvedValueOnce(jsonResponse({ hunts: [] }));

    await api.getHuntHistory();

    const [, options] = fetchMock.mock.calls[0];
    const sent = JSON.parse(options.body).hostSecrets as Record<string, string>;
    expect(Object.keys(sent)).toHaveLength(50);
    // saveHostSecret appends, so the map's insertion order is oldest-first —
    // capping must keep the tail (hunt-5..hunt-54), not the head.
    expect(sent).toEqual(
      Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`hunt-${i + 5}`, `secret-${i + 5}`])),
    );
  });

  it('drops malformed entries instead of failing the whole request', async () => {
    localStorage.setItem(
      HUNT_HOST_SECRETS_KEY,
      JSON.stringify({
        'hunt-1': 'good-secret',
        'hunt-2': '', // empty string
        'hunt-3': 12345, // not a string
        'hunt-4': null, // not a string
        'hunt-5': 'x'.repeat(201), // too long
        'hunt-6': 'another-good-secret',
      }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ hunts: [] }));

    await api.getHuntHistory();

    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({
      hostSecrets: { 'hunt-1': 'good-secret', 'hunt-6': 'another-good-secret' },
    });
  });

  it('still sends the request with an empty hostSecrets map when storage holds nothing usable', async () => {
    // No lamo-hunt-host-secrets key at all — the signed-in account path (if
    // any) still answers, so the request must go out regardless.
    fetchMock.mockResolvedValueOnce(jsonResponse({ hunts: [] }));

    await api.getHuntHistory();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ hostSecrets: {} });
  });

  it('treats corrupted JSON in storage as no secrets rather than throwing', async () => {
    localStorage.setItem(HUNT_HOST_SECRETS_KEY, 'not valid json{{{');
    fetchMock.mockResolvedValueOnce(jsonResponse({ hunts: [] }));

    await expect(api.getHuntHistory()).resolves.toEqual({ hunts: [] });
    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ hostSecrets: {} });
  });
});

// =====================================================================
// d) getHuntHistoryDetail — sends X-Host-Secret when localStorage holds one
//    for that hunt, omits it cleanly otherwise.
// =====================================================================
describe('getHuntHistoryDetail', () => {
  it('sends X-Host-Secret when a secret is stored for that hunt', async () => {
    localStorage.setItem(HUNT_HOST_SECRETS_KEY, JSON.stringify({ 'HUNT-1': 'secret-abc' }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ hunt: { huntId: 'HUNT-1' } }));

    await api.getHuntHistoryDetail('HUNT-1');

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/hunts/HUNT-1/history');
    expect(options.headers['X-Host-Secret']).toBe('secret-abc');
  });

  it('[control] omits X-Host-Secret cleanly when no secret is stored for that hunt', async () => {
    localStorage.setItem(HUNT_HOST_SECRETS_KEY, JSON.stringify({ 'HUNT-OTHER': 'unrelated-secret' }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ hunt: { huntId: 'HUNT-1' } }));

    await api.getHuntHistoryDetail('HUNT-1');

    const [, options] = fetchMock.mock.calls[0];
    expect(options?.headers ?? {}).not.toHaveProperty('X-Host-Secret');
  });
});

// Sanity: ApiError carries status/code through, which every test above relies on.
describe('ApiError', () => {
  it('exposes status and code alongside the message', () => {
    const err = new ApiError('boom', 403, 'NOT_A_MEMBER');
    expect(err.message).toBe('boom');
    expect(err.status).toBe(403);
    expect(err.code).toBe('NOT_A_MEMBER');
    expect(err).toBeInstanceOf(Error);
  });
});
