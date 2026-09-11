import { describe, it, expect, vi, beforeEach } from 'vitest';
import { app } from '../app';
import { createMockEnv } from './mocks';
import {
  createCoupon, getCoupon, redeemCoupon, deleteCoupon,
  generateCouponCode, isValidCouponCode, listCoupons,
} from '../coupons';
import {
  adjustUserCredits, verifyMagicCode, withKvLock,
  KvLockBusyError, InsufficientCreditsError,
} from '../auth';
import { createInvite, getInvite, acceptInvite } from '../invites';
import { handleCheckoutCompleted } from '../stripe';
import { AUTH_CONSTANTS, CREDIT_PRICING } from '@lamo-trivia/shared';
import type { Env } from '../env';

describe('Coupon code generation and validation', () => {
  it('generates codes in LAMO-XXXX-XXXX format', () => {
    const code = generateCouponCode();
    expect(code).toMatch(/^LAMO-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('generates unique codes', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateCouponCode()));
    expect(codes.size).toBe(50);
  });

  it('validates proper codes', () => {
    expect(isValidCouponCode('LAMO-ABCD-1234')).toBe(true);
    expect(isValidCouponCode('WELCOME50')).toBe(true);
    expect(isValidCouponCode('AB12')).toBe(true);
  });

  it('rejects invalid codes', () => {
    expect(isValidCouponCode('')).toBe(false);
    expect(isValidCouponCode('AB')).toBe(false);
    expect(isValidCouponCode('has spaces')).toBe(false);
    expect(isValidCouponCode('<script>')).toBe(false);
  });
});

describe('Coupon CRUD operations', () => {
  let env: Env;

  beforeEach(() => {
    vi.restoreAllMocks();
    env = createMockEnv();
  });

  it('creates and retrieves a coupon', async () => {
    const coupon = await createCoupon(env, {
      credits: 25,
      maxUses: 5,
      expiresAt: null,
      note: 'Test coupon',
      createdBy: 'admin@test.com',
    });

    expect(coupon.code).toMatch(/^LAMO-/);
    expect(coupon.credits).toBe(25);
    expect(coupon.maxUses).toBe(5);
    expect(coupon.usedCount).toBe(0);

    const retrieved = await getCoupon(env, coupon.code);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.credits).toBe(25);
  });

  it('creates a coupon with custom code', async () => {
    const coupon = await createCoupon(env, {
      code: 'WELCOME50',
      credits: 50,
      maxUses: 100,
      expiresAt: null,
      note: 'Welcome bonus',
      createdBy: 'admin@test.com',
    });

    expect(coupon.code).toBe('WELCOME50');

    const retrieved = await getCoupon(env, 'welcome50'); // case insensitive
    expect(retrieved).not.toBeNull();
    expect(retrieved!.code).toBe('WELCOME50');
  });

  it('prevents duplicate coupon codes', async () => {
    await createCoupon(env, {
      code: 'UNIQUE',
      credits: 10,
      maxUses: 1,
      expiresAt: null,
      note: '',
      createdBy: 'admin@test.com',
    });

    await expect(
      createCoupon(env, {
        code: 'UNIQUE',
        credits: 20,
        maxUses: 1,
        expiresAt: null,
        note: '',
        createdBy: 'admin@test.com',
      }),
    ).rejects.toThrow('already exists');
  });

  it('lists all coupons', async () => {
    await createCoupon(env, {
      code: 'COUPON1',
      credits: 10,
      maxUses: 1,
      expiresAt: null,
      note: '',
      createdBy: 'admin@test.com',
    });
    await createCoupon(env, {
      code: 'COUPON2',
      credits: 20,
      maxUses: 5,
      expiresAt: null,
      note: '',
      createdBy: 'admin@test.com',
    });

    const result = await listCoupons(env);
    expect(result.coupons).toHaveLength(2);
  });

  it('deletes a coupon', async () => {
    await createCoupon(env, {
      code: 'TODELETE',
      credits: 10,
      maxUses: 1,
      expiresAt: null,
      note: '',
      createdBy: 'admin@test.com',
    });

    const deleted = await deleteCoupon(env, 'TODELETE');
    expect(deleted).toBe(true);

    const retrieved = await getCoupon(env, 'TODELETE');
    expect(retrieved).toBeNull();
  });

  it('returns false when deleting non-existent coupon', async () => {
    const deleted = await deleteCoupon(env, 'NONEXISTENT');
    expect(deleted).toBe(false);
  });
});

describe('Coupon redemption', () => {
  let env: Env;

  beforeEach(async () => {
    vi.restoreAllMocks();
    env = createMockEnv();
  });

  it('redeems a valid coupon', async () => {
    await createCoupon(env, {
      code: 'FREEBIE',
      credits: 25,
      maxUses: 10,
      expiresAt: null,
      note: 'Free credits',
      createdBy: 'admin@test.com',
    });

    const result = await redeemCoupon(env, 'FREEBIE', 'user@test.com');
    expect(result.credits).toBe(25);

    // Check coupon was updated
    const coupon = await getCoupon(env, 'FREEBIE');
    expect(coupon!.usedCount).toBe(1);
    expect(coupon!.usedBy).toContain('user@test.com');
  });

  it('prevents double redemption by same user', async () => {
    await createCoupon(env, {
      code: 'ONCE',
      credits: 10,
      maxUses: 10,
      expiresAt: null,
      note: '',
      createdBy: 'admin@test.com',
    });

    await redeemCoupon(env, 'ONCE', 'user@test.com');

    await expect(
      redeemCoupon(env, 'ONCE', 'user@test.com'),
    ).rejects.toThrow('already used');
  });

  it('prevents redemption when max uses reached', async () => {
    await createCoupon(env, {
      code: 'LIMITED',
      credits: 10,
      maxUses: 1,
      expiresAt: null,
      note: '',
      createdBy: 'admin@test.com',
    });

    await redeemCoupon(env, 'LIMITED', 'user1@test.com');

    await expect(
      redeemCoupon(env, 'LIMITED', 'user2@test.com'),
    ).rejects.toThrow('fully redeemed');
  });

  it('prevents redemption of expired coupon', async () => {
    await createCoupon(env, {
      code: 'EXPIRED',
      credits: 10,
      maxUses: 10,
      expiresAt: Date.now() - 1000, // already expired
      note: '',
      createdBy: 'admin@test.com',
    });

    await expect(
      redeemCoupon(env, 'EXPIRED', 'user@test.com'),
    ).rejects.toThrow('expired');
  });

  it('rejects invalid coupon code', async () => {
    await expect(
      redeemCoupon(env, 'NONEXISTENT', 'user@test.com'),
    ).rejects.toThrow('Invalid coupon');
  });

  it('handles case-insensitive codes', async () => {
    await createCoupon(env, {
      code: 'MYCODE',
      credits: 15,
      maxUses: 5,
      expiresAt: null,
      note: '',
      createdBy: 'admin@test.com',
    });

    const result = await redeemCoupon(env, 'mycode', 'user@test.com');
    expect(result.credits).toBe(15);
  });
});

describe('Coupon API routes (via app)', () => {
  let env: Env;

  function fetchApp(request: Request, e: Env) {
    return app.fetch(request, e);
  }

  function adminRequest(path: string, opts: RequestInit = {}) {
    return new Request(`http://localhost${path}`, {
      headers: {
        Authorization: 'Bearer admin-secret',
        'Content-Type': 'application/json',
        ...opts.headers,
      },
      ...opts,
    });
  }

  beforeEach(async () => {
    vi.restoreAllMocks();
    env = createMockEnv({ SEED_SECRET: 'admin-secret' } as any);
  });

  it('POST /api/admin/coupons creates a coupon', async () => {
    const request = adminRequest('/api/admin/coupons', {
      method: 'POST',
      body: JSON.stringify({ credits: 25, maxUses: 5, note: 'Test' }),
    });
    const response = await fetchApp(request, env);
    expect(response.status).toBe(200);

    const data = (await response.json()) as any;
    expect(data.coupon.credits).toBe(25);
    expect(data.coupon.code).toBeTruthy();
  });

  it('POST /api/admin/coupons validates credits', async () => {
    const request = adminRequest('/api/admin/coupons', {
      method: 'POST',
      body: JSON.stringify({ credits: 0 }),
    });
    const response = await fetchApp(request, env);
    expect(response.status).toBe(400);
  });

  it('GET /api/admin/coupons lists coupons', async () => {
    // Create a coupon first
    await createCoupon(env, {
      code: 'TEST1',
      credits: 10,
      maxUses: 1,
      expiresAt: null,
      note: '',
      createdBy: 'admin@test.com',
    });

    const request = adminRequest('/api/admin/coupons');
    const response = await fetchApp(request, env);
    const data = (await response.json()) as any;
    expect(data.coupons).toHaveLength(1);
    expect(data.coupons[0].code).toBe('TEST1');
  });

  it('DELETE /api/admin/coupons/:code deletes a coupon', async () => {
    await createCoupon(env, {
      code: 'TODEL',
      credits: 10,
      maxUses: 1,
      expiresAt: null,
      note: '',
      createdBy: 'admin@test.com',
    });

    const request = adminRequest('/api/admin/coupons/TODEL', { method: 'DELETE' });
    const response = await fetchApp(request, env);
    expect(response.status).toBe(200);

    const coupon = await getCoupon(env, 'TODEL');
    expect(coupon).toBeNull();
  });

  it('POST /api/coupons/redeem requires auth', async () => {
    const request = new Request('http://localhost/api/coupons/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'TEST' }),
    });
    const response = await fetchApp(request, env);
    expect(response.status).toBe(401);
  });

  it('POST /api/coupons/redeem redeems a valid coupon', async () => {
    // Create a user and session
    const user = { userId: 'u1', email: 'user@test.com', credits: 0, createdAt: Date.now() };
    await env.TRIVIA_KV.put('user:user@test.com', JSON.stringify(user));
    const session = { userId: 'u1', email: 'user@test.com', expiresAt: Date.now() + 86400000 };
    await env.TRIVIA_KV.put('session:usertoken123', JSON.stringify(session));

    // Create a coupon
    await createCoupon(env, {
      code: 'GIFT25',
      credits: 25,
      maxUses: 10,
      expiresAt: null,
      note: 'Gift',
      createdBy: 'admin@test.com',
    });

    const request = new Request('http://localhost/api/coupons/redeem', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer usertoken123',
      },
      body: JSON.stringify({ code: 'GIFT25' }),
    });
    const response = await fetchApp(request, env);
    expect(response.status).toBe(200);

    const data = (await response.json()) as any;
    expect(data.credits).toBe(25);
    expect(data.newBalance).toBe(25);

    // Check user was updated
    const updated = JSON.parse((await env.TRIVIA_KV.get('user:user@test.com'))!);
    expect(updated.credits).toBe(25);

    // Check transaction recorded
    const txRaw = await env.TRIVIA_KV.get('transactions:u1');
    const txs = JSON.parse(txRaw!);
    expect(txs).toHaveLength(1);
    expect(txs[0].type).toBe('coupon');
    expect(txs[0].amount).toBe(25);
  });
});

// These cover the KV read-check-write races that let credits be granted more
// than once. The mock KV in ./mocks resolves through the microtask queue, so
// promises started together really do interleave between a get and its put —
// the same interleaving that produced the bug in production.
describe('Concurrency: coupon redemption', () => {
  let env: Env;

  beforeEach(() => {
    vi.restoreAllMocks();
    env = createMockEnv();
  });

  async function settle<T>(promises: Promise<T>[]) {
    const results = await Promise.allSettled(promises);
    return {
      fulfilled: results.filter((r) => r.status === 'fulfilled').length,
      reasons: results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => (r.reason as Error).message),
    };
  }

  it('honours maxUses when redemptions race', async () => {
    await createCoupon(env, {
      code: 'RACECAP',
      credits: 10,
      maxUses: 1,
      expiresAt: null,
      note: '',
      createdBy: 'admin@test.com',
    });

    const { fulfilled } = await settle(
      Array.from({ length: 8 }, (_, i) => redeemCoupon(env, 'RACECAP', `racer${i}@test.com`)),
    );

    expect(fulfilled).toBe(1);

    const coupon = await getCoupon(env, 'RACECAP');
    expect(coupon!.usedCount).toBe(1);
    expect(coupon!.usedBy).toHaveLength(1);
  });

  it('grants a multi-use coupon no more than maxUses times under load', async () => {
    await createCoupon(env, {
      code: 'RACEMULTI',
      credits: 5,
      maxUses: 3,
      expiresAt: null,
      note: '',
      createdBy: 'admin@test.com',
    });

    const { fulfilled } = await settle(
      Array.from({ length: 12 }, (_, i) => redeemCoupon(env, 'RACEMULTI', `m${i}@test.com`)),
    );

    expect(fulfilled).toBeLessThanOrEqual(3);

    const coupon = await getCoupon(env, 'RACEMULTI');
    expect(coupon!.usedCount).toBeLessThanOrEqual(3);
    expect(coupon!.usedCount).toBe(fulfilled);
    expect(new Set(coupon!.usedBy).size).toBe(coupon!.usedBy.length);
  });

  it('lets one user redeem only once even when their requests race', async () => {
    await createCoupon(env, {
      code: 'RACESAME',
      credits: 10,
      maxUses: 50,
      expiresAt: null,
      note: '',
      createdBy: 'admin@test.com',
    });

    const { fulfilled } = await settle(
      Array.from({ length: 6 }, () => redeemCoupon(env, 'RACESAME', 'same@test.com')),
    );

    expect(fulfilled).toBe(1);

    const coupon = await getCoupon(env, 'RACESAME');
    expect(coupon!.usedCount).toBe(1);
  });

  it('marks the coupon consumed before the credits are granted', async () => {
    await createCoupon(env, {
      code: 'ORDERING',
      credits: 10,
      maxUses: 1,
      expiresAt: null,
      note: '',
      createdBy: 'admin@test.com',
    });

    // An isolate that dies partway through a redemption leaves whatever KV
    // holds at that moment. If the coupon is still unconsumed while the
    // credits are going out, that residue is a fully-paid-out coupon the next
    // person can redeem again — so the use has to be burnt first.
    const duringGrant: Array<{ usedCount: number; usedBy: string[] }> = [];
    await redeemCoupon(env, 'ORDERING', 'user@test.com', async () => {
      const live = await getCoupon(env, 'ORDERING');
      duringGrant.push({ usedCount: live!.usedCount, usedBy: live!.usedBy });
    });

    expect(duringGrant).toHaveLength(1);
    expect(duringGrant[0].usedCount).toBe(1);
    expect(duringGrant[0].usedBy).toContain('user@test.com');
  });

  it('leaves the coupon unconsumed when the credit grant fails', async () => {
    await createCoupon(env, {
      code: 'GRANTFAIL',
      credits: 10,
      maxUses: 1,
      expiresAt: null,
      note: '',
      createdBy: 'admin@test.com',
    });

    await expect(
      redeemCoupon(env, 'GRANTFAIL', 'user@test.com', async () => {
        throw new Error('credit ledger unavailable');
      }),
    ).rejects.toThrow('credit ledger unavailable');

    // A throw from the grant means no credits moved, so the use is handed back
    // in full — both halves of it, not just the counter.
    const coupon = await getCoupon(env, 'GRANTFAIL');
    expect(coupon!.usedCount).toBe(0);
    expect(coupon!.usedBy).toEqual([]);

    // ...and the user can still redeem it afterwards
    const retry = await redeemCoupon(env, 'GRANTFAIL', 'user@test.com');
    expect(retry.credits).toBe(10);
  });
});

describe('Concurrency: credit balance updates', () => {
  let env: Env;

  beforeEach(async () => {
    vi.restoreAllMocks();
    env = createMockEnv();
    await env.TRIVIA_KV.put(
      'user:user@test.com',
      JSON.stringify({ userId: 'u1', email: 'user@test.com', credits: 0, createdAt: Date.now() }),
    );
  });

  async function balance(): Promise<number> {
    return JSON.parse((await env.TRIVIA_KV.get('user:user@test.com'))!).credits;
  }

  it('never applies the same grant twice', async () => {
    const first = await adjustUserCredits(env, 'user@test.com', 25, {
      idempotencyKey: 'coupon:GIFT:u1',
    });
    const second = await adjustUserCredits(env, 'user@test.com', 25, {
      idempotencyKey: 'coupon:GIFT:u1',
    });

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(second.user.credits).toBe(25);
    expect(await balance()).toBe(25);
  });

  it('does not lose an update when grants overlap', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        adjustUserCredits(env, 'user@test.com', 10, { idempotencyKey: `grant-${i}` }),
      ),
    );

    const appliedCount = results.filter(
      (r) => r.status === 'fulfilled' && r.value.applied,
    ).length;

    // Whatever got through must be fully reflected in the stored balance —
    // the old `user.credits += n; updateUser(user)` dropped the overlap.
    expect(await balance()).toBe(appliedCount * 10);
  });

  // Covers only the half where nothing has committed yet: the balance write
  // itself fails. The half that matters more — a failure *after* the balance
  // landed — is the test below it.
  it('rolls the idempotency marker back when the balance write fails', async () => {
    const realPut = env.TRIVIA_KV.put.bind(env.TRIVIA_KV);
    const put = vi
      .spyOn(env.TRIVIA_KV, 'put')
      .mockImplementation((async (key: string, value: string, opts?: unknown) => {
        if (key === 'user:user@test.com') throw new Error('KV down');
        return realPut(key, value, opts as never);
      }) as never);

    await expect(
      adjustUserCredits(env, 'user@test.com', 40, { idempotencyKey: 'retry-me' }),
    ).rejects.toThrow('KV down');

    put.mockRestore();

    // No marker was left behind, so the grant is still retryable and lands once
    const retry = await adjustUserCredits(env, 'user@test.com', 40, {
      idempotencyKey: 'retry-me',
    });
    expect(retry.applied).toBe(true);
    expect(await balance()).toBe(40);
  });

  it('keeps the marker when the ledger append fails after the balance landed', async () => {
    const realPut = env.TRIVIA_KV.put.bind(env.TRIVIA_KV);
    const put = vi
      .spyOn(env.TRIVIA_KV, 'put')
      .mockImplementation((async (key: string, value: string, opts?: unknown) => {
        // `transactions:{userId}` is one hot key, so tripping KV's ~1
        // write/sec/key limit here is ordinary — and it happens *after* the
        // balance has already been written.
        if (key === 'transactions:u1') throw new Error('KV write rate exceeded');
        return realPut(key, value, opts as never);
      }) as never);

    const result = await adjustUserCredits(env, 'user@test.com', 40, {
      idempotencyKey: 'ledger-flaky',
      transaction: { type: 'purchase', amount: 40, timestamp: Date.now(), details: 'test' },
    });

    put.mockRestore();

    // The balance is the source of truth and it moved, so this is a success...
    expect(result.applied).toBe(true);
    expect(await balance()).toBe(40);

    // ...and the marker survives, so a caller that retries can't be paid twice.
    expect(await env.TRIVIA_KV.get('credit-applied:ledger-flaky')).not.toBeNull();

    const retry = await adjustUserCredits(env, 'user@test.com', 40, {
      idempotencyKey: 'ledger-flaky',
    });
    expect(retry.applied).toBe(false);
    expect(await balance()).toBe(40);
  });

  it('refuses a debit larger than the balance instead of flooring it at zero', async () => {
    await adjustUserCredits(env, 'user@test.com', 30, { idempotencyKey: 'seed-30' });

    await expect(
      adjustUserCredits(env, 'user@test.com', -50, {
        idempotencyKey: 'overdraw',
        transaction: { type: 'deduction', amount: 50, timestamp: Date.now(), details: 'too much' },
      }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);

    // A floored debit reported success for a delta it had only partly applied,
    // and the ledger still recorded the amount that was asked for.
    expect(await balance()).toBe(30);
    expect(await env.TRIVIA_KV.get('transactions:u1')).toBeNull();
    expect(await env.TRIVIA_KV.get('credit-applied:overdraw')).toBeNull();
  });

  it('pays a Stripe session once even when the ledger write keeps failing', async () => {
    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_double',
          payment_status: 'paid',
          metadata: { email: 'user@test.com' },
        },
      },
    } as never;

    const realPut = env.TRIVIA_KV.put.bind(env.TRIVIA_KV);
    let ledgerAttempts = 0;
    const put = vi
      .spyOn(env.TRIVIA_KV, 'put')
      .mockImplementation((async (key: string, value: string, opts?: unknown) => {
        if (key === 'transactions:u1') {
          ledgerAttempts++;
          throw new Error('KV write rate exceeded');
        }
        return realPut(key, value, opts as never);
      }) as never);

    // A delivery that throws is a non-2xx to Stripe, and Stripe re-delivers the
    // same session. The webhook drops its own `stripe-fulfilled` gate on the
    // way out so a genuinely lost grant can be retried, which leaves the
    // idempotency marker inside adjustUserCredits as the only thing standing
    // between one payment and two grants.
    await handleCheckoutCompleted(event, env).catch(() => {});
    await handleCheckoutCompleted(event, env).catch(() => {});

    put.mockRestore();

    expect(ledgerAttempts).toBeGreaterThan(0);
    expect(await balance()).toBe(CREDIT_PRICING.creditsPerPurchase);
  });
});

describe('KV lock release', () => {
  let env: Env;
  const key = 'credit-lock:user:locked@test.com';

  beforeEach(() => {
    vi.restoreAllMocks();
    env = createMockEnv();
  });

  it('releases its own nonce when it loses arbitration', async () => {
    const realGet = env.TRIVIA_KV.get.bind(env.TRIVIA_KV);
    let servedRacer = false;
    const get = vi
      .spyOn(env.TRIVIA_KV, 'get')
      .mockImplementation((async (k: string, opts?: unknown) => {
        const value = await realGet(k, opts as never);
        // Serve the arbitration read-back somebody else's nonce, once: the
        // shape of two callers overwriting each other on an eventually
        // consistent read. Both used to throw before taking the `try`, so
        // neither released and the key sat unowned for its whole 60s TTL —
        // a minute in which this user can't redeem, start a hunt, or be
        // credited for a purchase.
        if (k === key && value && !servedRacer) {
          servedRacer = true;
          return 'a-racers-nonce';
        }
        return value;
      }) as never);

    await expect(withKvLock(env, key, async () => 'ran')).rejects.toBeInstanceOf(
      KvLockBusyError,
    );
    expect(servedRacer).toBe(true);

    get.mockRestore();

    // Our own write is gone, so the lock is free for whoever comes next.
    expect(await env.TRIVIA_KV.get(key)).toBeNull();
    await expect(withKvLock(env, key, async () => 'ran')).resolves.toBe('ran');
  });
});

describe('Concurrency: invite acceptance', () => {
  let env: Env;

  beforeEach(() => {
    vi.restoreAllMocks();
    env = createMockEnv();
  });

  function acceptRequest(token: string, ip: string) {
    return new Request('http://localhost/api/auth/accept-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
      body: JSON.stringify({ token }),
    });
  }

  it('grants invite credits once when accepts race', async () => {
    const invite = await createInvite(env, 'invitee@test.com', 'host@test.com', 1000);

    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        app.fetch(acceptRequest(invite.token, `10.0.0.${i}`), env),
      ),
    );

    const ok = responses.filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);

    // The credits landed exactly once, not once per concurrent request
    const user = JSON.parse((await env.TRIVIA_KV.get('user:invitee@test.com'))!);
    expect(user.credits).toBe(1000);

    const stored = await getInvite(env, invite.token);
    expect(stored!.acceptedAt).toBeTruthy();
  });

  it('records exactly one credit transaction for a raced invite', async () => {
    const invite = await createInvite(env, 'tx@test.com', 'host@test.com', 250);

    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        app.fetch(acceptRequest(invite.token, `10.0.1.${i}`), env),
      ),
    );

    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);

    const user = JSON.parse((await env.TRIVIA_KV.get('user:tx@test.com'))!);
    expect(user.credits).toBe(250);

    const txs = JSON.parse((await env.TRIVIA_KV.get(`transactions:${user.userId}`))!);
    expect(txs).toHaveLength(1);
    expect(txs[0].amount).toBe(250);
  });

  it('gives a rolled-back invite only the life it had left', async () => {
    const invite = await createInvite(env, 'ttl@test.com', 'host@test.com', 100);

    // Six days old: one day of the advertised seven remains.
    await env.TRIVIA_KV.put(
      `invite:${invite.token}`,
      JSON.stringify({ ...invite, createdAt: Date.now() - 6 * 24 * 60 * 60 * 1000 }),
    );

    const ttls: number[] = [];
    const realPut = env.TRIVIA_KV.put.bind(env.TRIVIA_KV);
    const put = vi
      .spyOn(env.TRIVIA_KV, 'put')
      .mockImplementation((async (key: string, value: string, opts?: { expirationTtl?: number }) => {
        if (key === `invite:${invite.token}` && typeof opts?.expirationTtl === 'number') {
          ttls.push(opts.expirationTtl);
        }
        return realPut(key, value, opts as never);
      }) as never);

    await expect(
      acceptInvite(env, invite.token, async () => {
        throw new Error('grant unavailable');
      }),
    ).rejects.toThrow('grant unavailable');

    put.mockRestore();

    // The invite is usable again...
    const restored = await getInvite(env, invite.token);
    expect(restored!.acceptedAt).toBeUndefined();

    // ...but the rollback must not hand it another seven days. A grant that
    // keeps failing would otherwise keep the invite alive forever.
    expect(Math.max(...ttls)).toBeLessThanOrEqual(24 * 60 * 60 + 60);
  });

  it('still rejects a sequential re-use of an accepted invite', async () => {
    const invite = await createInvite(env, 'reuse@test.com', 'host@test.com', 100);

    const first = await app.fetch(acceptRequest(invite.token, '10.0.2.1'), env);
    expect(first.status).toBe(200);

    const second = await app.fetch(acceptRequest(invite.token, '10.0.2.2'), env);
    expect(second.status).toBe(400);
    expect(((await second.json()) as any).error).toMatch(/already been used/);

    const user = JSON.parse((await env.TRIVIA_KV.get('user:reuse@test.com'))!);
    expect(user.credits).toBe(100);
  });
});

describe('Concurrency: magic code attempt cap', () => {
  let env: Env;
  const email = 'login@test.com';

  beforeEach(() => {
    vi.restoreAllMocks();
    env = createMockEnv();
  });

  async function seedCode(code: string, attempts = 0) {
    await env.TRIVIA_KV.put(
      `magic:${email}`,
      JSON.stringify({ code, expiresAt: Date.now() + 600_000, attempts }),
    );
  }

  async function storedAttempts(): Promise<number | null> {
    const raw = await env.TRIVIA_KV.get(`magic:${email}`);
    return raw ? JSON.parse(raw).attempts : null;
  }

  it('lets a single-use code verify only once when requests race', async () => {
    await seedCode('123456');

    const results = await Promise.all(
      Array.from({ length: 8 }, () => verifyMagicCode(email, '123456', env)),
    );

    // Every parallel request used to read the code before any of them deleted
    // it, so all 8 verified and all 8 could mint a session.
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await env.TRIVIA_KV.get(`magic:${email}`)).toBeNull();
  });

  /**
   * Stand in for the Workers runtime's constant-time comparison, so the test
   * can count how many guesses were actually *evaluated*.
   *
   * auth.ts prefers `crypto.subtle.timingSafeEqual` when it exists and only
   * falls back to an HMAC compare in Node, so defining it here both counts the
   * comparisons and exercises the branch production takes.
   */
  function countComparisons() {
    const subtle = crypto.subtle as unknown as Record<string, unknown>;
    const had = 'timingSafeEqual' in subtle;
    const original = subtle.timingSafeEqual;
    const fn = vi.fn((a: ArrayBufferView, b: ArrayBufferView) => {
      const av = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      const bv = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
      if (av.length !== bv.length) return false;
      let diff = 0;
      for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i];
      return diff === 0;
    });
    Object.defineProperty(subtle, 'timingSafeEqual', {
      value: fn,
      configurable: true,
      writable: true,
    });
    return {
      get count() {
        return fn.mock.calls.length;
      },
      restore() {
        if (had) {
          Object.defineProperty(subtle, 'timingSafeEqual', {
            value: original,
            configurable: true,
            writable: true,
          });
        } else {
          delete subtle.timingSafeEqual;
        }
      },
    };
  }

  it('counts every evaluated guess against the cap under concurrency', async () => {
    await seedCode('123456');

    // The stored counter cannot tell the two implementations apart: the old
    // lost-update race and the serialised version both leave `attempts` at 1,
    // so any bound in [1, cap] passes against the code this was written to
    // catch. What differs is how many guesses were *evaluated* to get there —
    // the old one compared all ten, which is the whole point of a cap.
    const compare = countComparisons();
    try {
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          verifyMagicCode(email, String(200000 + i), env),
        ),
      );
    } finally {
      compare.restore();
    }

    expect(compare.count).toBeGreaterThan(0);
    expect(compare.count).toBeLessThanOrEqual(AUTH_CONSTANTS.maxCodeAttempts);
    // ...and every guess that was evaluated was paid for out of that counter.
    expect(await storedAttempts()).toBe(compare.count);
  });

  it('burns the code once the attempt cap is spent', async () => {
    await seedCode('123456');

    for (let i = 0; i < AUTH_CONSTANTS.maxCodeAttempts; i++) {
      expect(await verifyMagicCode(email, '999999', env)).toBe(false);
    }
    expect(await storedAttempts()).toBe(AUTH_CONSTANTS.maxCodeAttempts);

    // The correct code no longer helps
    expect(await verifyMagicCode(email, '123456', env)).toBe(false);
    expect(await env.TRIVIA_KV.get(`magic:${email}`)).toBeNull();
  });

  it('spends the attempt before comparing, so an abandoned guess still counts', async () => {
    await seedCode('123456', AUTH_CONSTANTS.maxCodeAttempts - 1);

    expect(await verifyMagicCode(email, '000000', env)).toBe(false);
    expect(await storedAttempts()).toBe(AUTH_CONSTANTS.maxCodeAttempts);
  });
});
