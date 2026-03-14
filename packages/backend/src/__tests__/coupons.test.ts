import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRequest } from '../router';
import { createMockEnv } from './mocks';
import {
  createCoupon, getCoupon, redeemCoupon, deleteCoupon,
  generateCouponCode, isValidCouponCode, listCoupons,
} from '../coupons';
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

describe('Coupon API routes (via router)', () => {
  let env: Env;

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
    const response = await handleRequest(request, env);
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
    const response = await handleRequest(request, env);
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
    const response = await handleRequest(request, env);
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
    const response = await handleRequest(request, env);
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
    const response = await handleRequest(request, env);
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
    const response = await handleRequest(request, env);
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
