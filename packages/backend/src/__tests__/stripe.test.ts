import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { app } from '../app';
import { createMockEnv } from './mocks';
import { createCheckoutSession, verifyWebhookSignature, handleCheckoutCompleted } from '../stripe';
import { CREDIT_PRICING } from '@lamo-trivia/shared';
import type { Env } from '../env';
import type { User, CreditTransaction } from '@lamo-trivia/shared';

/**
 * stripe.ts is the only path in the app that turns a real payment into
 * credits, and both of its failure directions are silent: a customer who paid
 * and was never credited complains, a customer credited twice never does. The
 * suite has to be the thing that notices, so these tests assert on what
 * reached KV rather than on what the handler returned.
 */

const EMAIL = 'buyer@test.com';
const USER_ID = 'u-buyer';
const WEBHOOK_SECRET = 'whsec_test_secret';

function seedUser(env: Env, overrides: Partial<User> = {}) {
  const user: User = {
    userId: USER_ID,
    email: EMAIL,
    credits: 0,
    createdAt: Date.now(),
    ...overrides,
  };
  return env.TRIVIA_KV.put(`user:${EMAIL}`, JSON.stringify(user));
}

async function storedUser(env: Env): Promise<User | null> {
  const raw = await env.TRIVIA_KV.get(`user:${EMAIL}`);
  return raw ? (JSON.parse(raw) as User) : null;
}

async function balance(env: Env): Promise<number | null> {
  return (await storedUser(env))?.credits ?? null;
}

async function ledger(env: Env, userId = USER_ID): Promise<CreditTransaction[]> {
  const raw = await env.TRIVIA_KV.get(`transactions:${userId}`);
  return raw ? (JSON.parse(raw) as CreditTransaction[]) : [];
}

/** A `checkout.session.completed` event, paid unless told otherwise. */
function checkoutEvent(
  sessionId: string,
  overrides: Record<string, unknown> = {},
): never {
  return {
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        payment_status: 'paid',
        metadata: { userId: USER_ID, email: EMAIL },
        ...overrides,
      },
    },
  } as never;
}

// --- Signature helpers -------------------------------------------------

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Compute the v1 signature Stripe would send for this payload. */
async function signPayload(payload: string, secret: string, timestamp: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  return toHex(sig);
}

/** A complete `Stripe-Signature` header for this payload. */
async function signatureHeader(
  payload: string,
  secret = WEBHOOK_SECRET,
  timestamp = Math.floor(Date.now() / 1000),
): Promise<string> {
  return `t=${timestamp},v1=${await signPayload(payload, secret, timestamp)}`;
}

describe('verifyWebhookSignature', () => {
  // Control block: this code is byte-identical before and after the fix wave.
  // It had no tests at all, and it is the only thing standing between an
  // anonymous POST and the credit grant below.
  const payload = JSON.stringify({ type: 'checkout.session.completed', id: 'evt_1' });

  it('accepts a correctly computed signature', async () => {
    const header = await signatureHeader(payload);
    expect(await verifyWebhookSignature(payload, header, WEBHOOK_SECRET)).toBe(true);
  });

  it('rejects a signature computed with a different secret', async () => {
    const header = await signatureHeader(payload, 'whsec_someone_elses');
    expect(await verifyWebhookSignature(payload, header, WEBHOOK_SECRET)).toBe(false);
  });

  it('rejects a valid signature replayed over a tampered payload', async () => {
    const header = await signatureHeader(payload);
    const tampered = payload.replace('evt_1', 'evt_2');
    expect(await verifyWebhookSignature(tampered, header, WEBHOOK_SECRET)).toBe(false);
  });

  it('rejects an empty or structureless header', async () => {
    for (const header of ['', 'garbage', 'v1=', 't=,v1=']) {
      expect(await verifyWebhookSignature(payload, header, WEBHOOK_SECRET)).toBe(false);
    }
  });

  it('rejects a header carrying a timestamp but no v1 signature', async () => {
    const t = Math.floor(Date.now() / 1000);
    expect(await verifyWebhookSignature(payload, `t=${t}`, WEBHOOK_SECRET)).toBe(false);
    expect(await verifyWebhookSignature(payload, `t=${t},v0=abcd`, WEBHOOK_SECRET)).toBe(false);
  });

  it('rejects a v1 signature that is not valid hex, without throwing', async () => {
    const t = Math.floor(Date.now() / 1000);
    // Odd length, non-hex characters, and the right length made of the wrong
    // alphabet: hexToBytes must refuse all three rather than produce NaN bytes
    // that could coincidentally compare equal.
    const real = await signPayload(payload, WEBHOOK_SECRET, t);
    for (const bad of ['abc', 'zz'.repeat(32), 'g'.repeat(real.length), real.slice(0, -1)]) {
      expect(await verifyWebhookSignature(payload, `t=${t},v1=${bad}`, WEBHOOK_SECRET)).toBe(false);
    }
  });

  it('rejects a well-formed signature of the right length but wrong bytes', async () => {
    const t = Math.floor(Date.now() / 1000);
    const real = await signPayload(payload, WEBHOOK_SECRET, t);
    // Flip one nibble — same length, same alphabet, different value
    const flipped = (real[0] === '0' ? '1' : '0') + real.slice(1);
    expect(await verifyWebhookSignature(payload, `t=${t},v1=${flipped}`, WEBHOOK_SECRET)).toBe(false);
  });

  it('rejects a correctly signed payload that is older than the replay window', async () => {
    const stale = Math.floor(Date.now() / 1000) - 301;
    const header = await signatureHeader(payload, WEBHOOK_SECRET, stale);
    expect(await verifyWebhookSignature(payload, header, WEBHOOK_SECRET)).toBe(false);

    const fresh = Math.floor(Date.now() / 1000) - 299;
    const ok = await signatureHeader(payload, WEBHOOK_SECRET, fresh);
    expect(await verifyWebhookSignature(payload, ok, WEBHOOK_SECRET)).toBe(true);
  });

  it('accepts when any one of several v1 candidates matches', async () => {
    // Stripe sends one v1 per active secret while an endpoint secret rotates.
    const t = Math.floor(Date.now() / 1000);
    const good = await signPayload(payload, WEBHOOK_SECRET, t);
    const other = await signPayload(payload, 'whsec_rotated_out', t);
    expect(
      await verifyWebhookSignature(payload, `t=${t},v1=${other},v1=${good}`, WEBHOOK_SECRET),
    ).toBe(true);
  });
});

describe('POST /api/webhooks/stripe — signature gate grants nothing on failure', () => {
  let env: Env;

  beforeEach(async () => {
    vi.restoreAllMocks();
    env = createMockEnv({ STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET });
    await seedUser(env);
  });

  function webhookRequest(payload: string, headers: Record<string, string>) {
    return new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      body: payload,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  }

  it('credits a correctly signed delivery', async () => {
    const payload = JSON.stringify(checkoutEvent('cs_signed_ok'));
    const res = await app.fetch(
      webhookRequest(payload, { 'stripe-signature': await signatureHeader(payload) }),
      env,
    );

    expect(res.status).toBe(200);
    expect(await balance(env)).toBe(CREDIT_PRICING.creditsPerPurchase);
  });

  it('rejects a forged, absent or malformed signature and grants nothing', async () => {
    const payload = JSON.stringify(checkoutEvent('cs_signed_bad'));
    const wrongSecret = await signatureHeader(payload, 'whsec_attacker');

    const headers: Array<Record<string, string>> = [
      {}, // absent
      { 'stripe-signature': wrongSecret },
      { 'stripe-signature': 'not-a-signature' },
      { 'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=deadbeef` },
    ];

    for (const h of headers) {
      const res = await app.fetch(webhookRequest(payload, h), env);
      expect(res.status).toBe(400);
    }

    // The important half: no side effect at all reached KV.
    expect(await balance(env)).toBe(0);
    expect(await ledger(env)).toEqual([]);
    expect(await env.TRIVIA_KV.get('stripe-fulfilled:cs_signed_bad')).toBeNull();
    expect(await env.TRIVIA_KV.get('credit-applied:stripe-purchase:cs_signed_bad')).toBeNull();
  });
});

describe('handleCheckoutCompleted — happy path', () => {
  let env: Env;

  beforeEach(async () => {
    vi.restoreAllMocks();
    env = createMockEnv({ STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET });
    await seedUser(env);
  });

  it('grants the credits once, writes the ledger row, and persists the customer id', async () => {
    await handleCheckoutCompleted(checkoutEvent('cs_happy', { customer: 'cus_happy' }), env);

    const user = await storedUser(env);
    expect(user!.credits).toBe(CREDIT_PRICING.creditsPerPurchase);
    expect(user!.stripeCustomerId).toBe('cus_happy');

    const rows = await ledger(env);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'purchase',
      amount: CREDIT_PRICING.creditsPerPurchase,
      stripeSessionId: 'cs_happy',
    });

    expect(await env.TRIVIA_KV.get('stripe-fulfilled:cs_happy')).toBe('fulfilled');
  });

  it('adds to an existing balance rather than replacing it', async () => {
    await seedUser(env, { credits: 17 });
    await handleCheckoutCompleted(checkoutEvent('cs_topup'), env);
    expect(await balance(env)).toBe(17 + CREDIT_PRICING.creditsPerPurchase);
  });

  it('falls back to customer_email when the session carries no metadata', async () => {
    await handleCheckoutCompleted(
      checkoutEvent('cs_no_meta', { metadata: undefined, customer_email: EMAIL }),
      env,
    );
    expect(await balance(env)).toBe(CREDIT_PRICING.creditsPerPurchase);
  });

  it('grants nothing for a session that is not paid, and leaves it fulfillable later', async () => {
    const unpaid = checkoutEvent('cs_unpaid', { payment_status: 'unpaid' });
    await handleCheckoutCompleted(unpaid, env);

    expect(await balance(env)).toBe(0);
    expect(await ledger(env)).toEqual([]);
    // No gate was written, so the `checkout.session.async_payment_succeeded`
    // delivery that follows an unpaid session is not swallowed as a duplicate.
    expect(await env.TRIVIA_KV.get('stripe-fulfilled:cs_unpaid')).toBeNull();

    await handleCheckoutCompleted(checkoutEvent('cs_unpaid'), env);
    expect(await balance(env)).toBe(CREDIT_PRICING.creditsPerPurchase);
  });

  it('grants nothing when the session identifies no email', async () => {
    await handleCheckoutCompleted(
      checkoutEvent('cs_no_email', { metadata: {}, customer_email: undefined }),
      env,
    );
    expect(await balance(env)).toBe(0);
    expect(await env.TRIVIA_KV.get('stripe-fulfilled:cs_no_email')).toBeNull();
  });
});

describe('handleCheckoutCompleted — Stripe redelivery', () => {
  let env: Env;

  beforeEach(async () => {
    vi.restoreAllMocks();
    env = createMockEnv();
    await seedUser(env);
  });

  it('does not double-credit a redelivery of the same session id', async () => {
    const event = checkoutEvent('cs_retry');
    await handleCheckoutCompleted(event, env);
    await handleCheckoutCompleted(event, env);
    await handleCheckoutCompleted(event, env);

    expect(await balance(env)).toBe(CREDIT_PRICING.creditsPerPurchase);
    expect(await ledger(env)).toHaveLength(1);
  });

  it('does not double-credit two deliveries of the same session racing', async () => {
    const event = checkoutEvent('cs_race');
    await Promise.all([
      handleCheckoutCompleted(event, env).catch(() => {}),
      handleCheckoutCompleted(event, env).catch(() => {}),
      handleCheckoutCompleted(event, env).catch(() => {}),
    ]);

    expect(await balance(env)).toBe(CREDIT_PRICING.creditsPerPurchase);
  });

  it('still credits a genuine second purchase by the same user', async () => {
    // The idempotency key is scoped to the Checkout Session, not the user —
    // a coarser key would silently swallow somebody's second purchase.
    await handleCheckoutCompleted(checkoutEvent('cs_first'), env);
    await handleCheckoutCompleted(checkoutEvent('cs_second'), env);

    expect(await balance(env)).toBe(2 * CREDIT_PRICING.creditsPerPurchase);
    expect(await ledger(env)).toHaveLength(2);
  });
});

describe('handleCheckoutCompleted — failure handling', () => {
  let env: Env;

  beforeEach(async () => {
    vi.restoreAllMocks();
    env = createMockEnv();
    await seedUser(env);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the grant guarded when the ledger append fails after the balance committed', async () => {
    // THE critical case. `transactions:{userId}` is a single hot KV key, so a
    // failing append here is ordinary. The balance has already moved by then,
    // so whatever unwinds must NOT unwind the marker that proves it moved —
    // otherwise Stripe's redelivery pays the same session twice.
    const realPut = env.TRIVIA_KV.put.bind(env.TRIVIA_KV);
    const put = vi
      .spyOn(env.TRIVIA_KV, 'put')
      .mockImplementation((async (key: string, value: string, opts?: unknown) => {
        if (key === `transactions:${USER_ID}`) throw new Error('KV write rate exceeded');
        return realPut(key, value, opts as never);
      }) as never);

    // A lost ledger row is recoverable and a double grant is not, so the
    // handler must swallow it and report success to Stripe.
    await expect(handleCheckoutCompleted(checkoutEvent('cs_ledger'), env)).resolves.toBeUndefined();

    put.mockRestore();

    expect(await balance(env)).toBe(CREDIT_PRICING.creditsPerPurchase);
    // The marker survived the ledger failure — this is the guard.
    expect(await env.TRIVIA_KV.get('credit-applied:stripe-purchase:cs_ledger')).not.toBeNull();

    // Now take away the outer gate, which is exactly what the webhook's own
    // catch does on a failed delivery (and what a 30-day TTL does eventually).
    // The inner marker has to hold the line by itself.
    await env.TRIVIA_KV.delete('stripe-fulfilled:cs_ledger');
    await handleCheckoutCompleted(checkoutEvent('cs_ledger'), env);

    expect(await balance(env)).toBe(CREDIT_PRICING.creditsPerPurchase);
  });

  it('leaves the purchase retryable when the balance write fails before committing', async () => {
    const realPut = env.TRIVIA_KV.put.bind(env.TRIVIA_KV);
    let failUserWrite = true;
    const put = vi
      .spyOn(env.TRIVIA_KV, 'put')
      .mockImplementation((async (key: string, value: string, opts?: unknown) => {
        if (key === `user:${EMAIL}` && failUserWrite) throw new Error('KV unavailable');
        return realPut(key, value, opts as never);
      }) as never);

    await expect(handleCheckoutCompleted(checkoutEvent('cs_wedge'), env)).rejects.toThrow(
      'KV unavailable',
    );

    // Nothing landed...
    expect(await balance(env)).toBe(0);
    // ...and nothing is left claiming it did. Wedging the session gate at
    // 'processing' would make every redelivery return early and the customer
    // would have paid for credits they never receive.
    expect(await env.TRIVIA_KV.get('stripe-fulfilled:cs_wedge')).toBeNull();
    expect(await env.TRIVIA_KV.get('credit-applied:stripe-purchase:cs_wedge')).toBeNull();

    failUserWrite = false;
    await handleCheckoutCompleted(checkoutEvent('cs_wedge'), env);
    put.mockRestore();

    expect(await balance(env)).toBe(CREDIT_PRICING.creditsPerPurchase);
    expect(await ledger(env)).toHaveLength(1);
  });

  it('grants nothing for an unknown user and leaves the session retryable', async () => {
    await env.TRIVIA_KV.delete(`user:${EMAIL}`);

    await expect(handleCheckoutCompleted(checkoutEvent('cs_ghost'), env)).resolves.toBeUndefined();

    expect(await storedUser(env)).toBeNull();
    expect(await ledger(env)).toEqual([]);
    // The gate is dropped, so the same session fulfils once the account exists
    // (a webhook that outran account creation must not lose the money).
    expect(await env.TRIVIA_KV.get('stripe-fulfilled:cs_ghost')).toBeNull();

    await seedUser(env);
    await handleCheckoutCompleted(checkoutEvent('cs_ghost'), env);
    expect(await balance(env)).toBe(CREDIT_PRICING.creditsPerPurchase);
  });
});

describe('handleCheckoutCompleted — concurrent balance changes', () => {
  let env: Env;

  beforeEach(async () => {
    vi.restoreAllMocks();
    env = createMockEnv();
    await seedUser(env);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not lose a credit change that lands after its existence check', async () => {
    // The handler reads the user once just to prove they exist. If the grant
    // is then computed from that snapshot, any redemption or refund that
    // landed in between is silently reverted.
    const realGet = env.TRIVIA_KV.get.bind(env.TRIVIA_KV);
    const realPut = env.TRIVIA_KV.put.bind(env.TRIVIA_KV);
    let userReads = 0;

    const get = vi
      .spyOn(env.TRIVIA_KV, 'get')
      .mockImplementation((async (key: string, opts?: unknown) => {
        const value = await realGet(key, opts as never);
        if (key === `user:${EMAIL}` && ++userReads === 1) {
          // A coupon redemption commits in the gap
          const current = JSON.parse((await realGet(key)) as string) as User;
          current.credits += 25;
          await realPut(key, JSON.stringify(current));
        }
        return value;
      }) as never);

    await handleCheckoutCompleted(checkoutEvent('cs_lost_update'), env);
    get.mockRestore();

    expect(await balance(env)).toBe(25 + CREDIT_PRICING.creditsPerPurchase);
  });

  it('writes the customer id under the per-user lock, re-reading instead of replaying its snapshot', async () => {
    const realGet = env.TRIVIA_KV.get.bind(env.TRIVIA_KV);
    const realPut = env.TRIVIA_KV.put.bind(env.TRIVIA_KV);
    const lockHeldAtWrite: boolean[] = [];
    let injected = false;

    const put = vi
      .spyOn(env.TRIVIA_KV, 'put')
      .mockImplementation((async (key: string, value: string, opts?: unknown) => {
        if (key === `user:${EMAIL}`) {
          lockHeldAtWrite.push(Boolean(await realGet(`credit-lock:user:${EMAIL}`)));
        }
        await realPut(key, value, opts as never);
        if (key === `user:${EMAIL}` && !injected) {
          injected = true;
          // A hunt refund that read the record before our write lands on top
          // of it — so the customer-id write has to re-read, not replay.
          const current = JSON.parse((await realGet(key)) as string) as User;
          await realPut(
            key,
            JSON.stringify({ ...current, credits: current.credits + 25, stripeCustomerId: undefined }),
          );
        }
      }) as never);

    await handleCheckoutCompleted(checkoutEvent('cs_cust', { customer: 'cus_late' }), env);
    put.mockRestore();

    const user = await storedUser(env);
    expect(user!.credits).toBe(25 + CREDIT_PRICING.creditsPerPurchase);
    expect(user!.stripeCustomerId).toBe('cus_late');
    // Every write of the user record happened while the per-user credit lock
    // was held — a second, unlocked write is how the grant gets clobbered.
    expect(lockHeldAtWrite.length).toBeGreaterThan(0);
    expect(lockHeldAtWrite.every(Boolean)).toBe(true);
  });

  it('leaves an existing customer id alone', async () => {
    await seedUser(env, { stripeCustomerId: 'cus_original' });
    await handleCheckoutCompleted(checkoutEvent('cs_keep', { customer: 'cus_new' }), env);

    const user = await storedUser(env);
    expect(user!.stripeCustomerId).toBe('cus_original');
    expect(user!.credits).toBe(CREDIT_PRICING.creditsPerPurchase);
  });

  it('still fulfils the purchase when the customer-id write cannot take the lock', async () => {
    const realGet = env.TRIVIA_KV.get.bind(env.TRIVIA_KV);
    const realPut = env.TRIVIA_KV.put.bind(env.TRIVIA_KV);
    let grantDone = false;

    // Once the grant's own marker has been written, make the per-user lock
    // look like somebody else holds it, so the bookkeeping write that follows
    // loses it. A paid-for grant must not fail on a bookkeeping field.
    const get = vi
      .spyOn(env.TRIVIA_KV, 'get')
      .mockImplementation((async (key: string, opts?: unknown) => {
        if (key === `credit-lock:user:${EMAIL}` && grantDone) return 'someone-elses-nonce';
        return realGet(key, opts as never);
      }) as never);

    const put = vi
      .spyOn(env.TRIVIA_KV, 'put')
      .mockImplementation((async (key: string, value: string, opts?: unknown) => {
        await realPut(key, value, opts as never);
        if (key === 'credit-applied:stripe-purchase:cs_lockbusy') grantDone = true;
      }) as never);

    await expect(
      handleCheckoutCompleted(checkoutEvent('cs_lockbusy', { customer: 'cus_busy' }), env),
    ).resolves.toBeUndefined();

    get.mockRestore();
    put.mockRestore();

    // Money first: the grant stands, and Stripe is told so, even though the
    // customer id did not make it.
    expect(await balance(env)).toBe(CREDIT_PRICING.creditsPerPurchase);
    expect(await env.TRIVIA_KV.get('stripe-fulfilled:cs_lockbusy')).toBe('fulfilled');
  });
});

describe('createCheckoutSession', () => {
  let env: Env;

  beforeEach(() => {
    vi.restoreAllMocks();
    env = createMockEnv({ STRIPE_SECRET_KEY: 'sk_test_123' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubStripe(response: Response) {
    const calls: Array<{ url: string; body: URLSearchParams; auth: string | null }> = [];
    vi.stubGlobal('fetch', async (input: RequestInfo, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: new URLSearchParams(String(init?.body ?? '')),
        auth: new Headers(init?.headers as HeadersInit).get('Authorization'),
      });
      return response;
    });
    return calls;
  }

  const user: User = { userId: USER_ID, email: EMAIL, credits: 0, createdAt: Date.now() };

  it('sends the priced line item and identifies the buyer', async () => {
    const calls = stubStripe(Response.json({ url: 'https://checkout.stripe.com/c/pay/abc' }));

    const url = await createCheckoutSession(user, env);

    expect(url).toBe('https://checkout.stripe.com/c/pay/abc');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(calls[0].auth).toBe('Bearer sk_test_123');
    // The webhook resolves the buyer from metadata.email, so a checkout that
    // does not carry it produces a payment nobody can be credited for.
    expect(calls[0].body.get('metadata[email]')).toBe(EMAIL);
    expect(calls[0].body.get('metadata[userId]')).toBe(USER_ID);
    expect(calls[0].body.get('client_reference_id')).toBe(USER_ID);
    expect(calls[0].body.get('line_items[0][price_data][unit_amount]')).toBe(
      String(CREDIT_PRICING.priceInCents),
    );
    expect(calls[0].body.get('mode')).toBe('payment');
  });

  it('reuses a known Stripe customer instead of prefilling an email', async () => {
    const calls = stubStripe(Response.json({ url: 'https://checkout.stripe.com/c/pay/def' }));

    await createCheckoutSession({ ...user, stripeCustomerId: 'cus_known' }, env);

    expect(calls[0].body.get('customer')).toBe('cus_known');
    expect(calls[0].body.get('customer_email')).toBeNull();
  });

  it('prefills the email when the buyer has no Stripe customer yet', async () => {
    const calls = stubStripe(Response.json({ url: 'https://checkout.stripe.com/c/pay/ghi' }));

    await createCheckoutSession(user, env);

    expect(calls[0].body.get('customer_email')).toBe(EMAIL);
    expect(calls[0].body.get('customer')).toBeNull();
  });

  it('throws rather than returning an undefined checkout url when Stripe errors', async () => {
    stubStripe(new Response('card_declined', { status: 402 }));
    await expect(createCheckoutSession(user, env)).rejects.toThrow('Failed to create checkout session');
  });

  it('refuses to build a session when the Stripe key is not configured', async () => {
    const calls = stubStripe(Response.json({ url: 'https://example.com' }));
    await expect(createCheckoutSession(user, createMockEnv())).rejects.toThrow(
      'STRIPE_SECRET_KEY is not configured',
    );
    expect(calls).toHaveLength(0);
  });
});
