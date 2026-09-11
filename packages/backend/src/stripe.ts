import { Env, getStripeKey } from './env';
import { CREDIT_PRICING } from '@lamo-trivia/shared';
import type { User } from '@lamo-trivia/shared';
import { getUser, updateUser, adjustUserCredits, withKvLock, KvLockBusyError } from './auth';

// --- Checkout ---

export async function createCheckoutSession(
  user: User,
  env: Env,
): Promise<string> {
  const stripeKey = await getStripeKey(env);

  const params = new URLSearchParams({
    'mode': 'payment',
    'success_url': `${env.FRONTEND_URL}/credits/success?session_id={CHECKOUT_SESSION_ID}`,
    'cancel_url': `${env.FRONTEND_URL}/credits`,
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product]': 'prod_U94S9OVyc0Yekk',
    'line_items[0][price_data][unit_amount]': String(CREDIT_PRICING.priceInCents),
    'line_items[0][quantity]': '1',
    'metadata[userId]': user.userId,
    'metadata[email]': user.email,
    'client_reference_id': user.userId,
  });

  // Attach or create Stripe customer
  if (user.stripeCustomerId) {
    params.set('customer', user.stripeCustomerId);
  } else {
    params.set('customer_email', user.email);
  }

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Stripe checkout error', err);
    throw new Error('Failed to create checkout session');
  }

  const session = (await res.json()) as { url: string };
  return session.url;
}

// --- Webhook signature verification ---

export async function verifyWebhookSignature(
  payload: string,
  sigHeader: string,
  secret: string,
): Promise<boolean> {
  const parts = sigHeader.split(',').reduce(
    (acc, part) => {
      const [key, val] = part.split('=');
      if (key === 't') acc.timestamp = val;
      if (key === 'v1') acc.signatures.push(val);
      return acc;
    },
    { timestamp: '', signatures: [] as string[] },
  );

  if (!parts.timestamp || parts.signatures.length === 0) return false;

  // Reject events older than 5 minutes
  const ts = parseInt(parts.timestamp);
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const signedPayload = `${parts.timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const computedBuf = new Uint8Array(sig);

  // Constant-time comparison against each candidate signature
  for (const candidate of parts.signatures) {
    const candidateBytes = hexToBytes(candidate);
    if (!candidateBytes || candidateBytes.byteLength !== computedBuf.byteLength) continue;
    if (await constantTimeEqual(computedBuf, candidateBytes)) {
      return true;
    }
  }
  return false;
}

/** Constant-time byte comparison */
async function constantTimeEqual(a: Uint8Array, b: Uint8Array): Promise<boolean> {
  if (a.byteLength !== b.byteLength) return false;
  // Workers runtime
  if (typeof crypto.subtle.timingSafeEqual === 'function') {
    return crypto.subtle.timingSafeEqual(a, b);
  }
  // Fallback via HMAC
  const key = await crypto.subtle.importKey(
    'raw', new Uint8Array(32),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const [macA, macB] = await Promise.all([
    crypto.subtle.sign('HMAC', key, a),
    crypto.subtle.sign('HMAC', key, b),
  ]);
  const viewA = new Uint8Array(macA);
  const viewB = new Uint8Array(macB);
  let result = 0;
  for (let i = 0; i < viewA.length; i++) result |= viewA[i] ^ viewB[i];
  return result === 0;
}

/** Convert hex string to Uint8Array, returns null on invalid input */
function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// --- Webhook handler ---

export async function handleCheckoutCompleted(
  event: StripeCheckoutEvent,
  env: Env,
): Promise<void> {
  const session = event.data.object;

  // Only credit when payment is actually received
  if (session.payment_status !== 'paid') {
    console.log('Checkout completed but payment not yet received', session.id);
    return;
  }

  const email = session.metadata?.email ?? session.customer_email;
  if (!email) {
    console.error('Webhook missing email', session.id);
    return;
  }

  // Idempotency: write the key FIRST to prevent double-crediting from concurrent retries
  const idempotencyKey = `stripe-fulfilled:${session.id}`;
  const existing = await env.TRIVIA_KV.get(idempotencyKey);
  if (existing) return;
  await env.TRIVIA_KV.put(idempotencyKey, 'processing', { expirationTtl: 30 * 24 * 60 * 60 });

  const user = await getUser(email, env);
  if (!user) {
    console.error('Webhook user not found', email);
    // Remove idempotency key so it can be retried when user exists
    await env.TRIVIA_KV.delete(idempotencyKey);
    return;
  }

  // Add credits. `user` above is only a snapshot used for the existence check:
  // `user.credits += n` on it and a whole-record write back would revert any
  // coupon redemption or hunt deduction that landed in between. The Stripe
  // retry gate above doesn't help there — the racing write isn't a retry.
  // adjustUserCredits re-reads the balance inside the per-user lock instead.
  let credited: User;
  try {
    ({ user: credited } = await adjustUserCredits(
      env,
      email,
      CREDIT_PRICING.creditsPerPurchase,
      {
        // One Checkout Session is one purchase. Coarser (the user id) would
        // swallow their second purchase; finer (a per-delivery id) would let
        // two deliveries of this session pay out twice.
        idempotencyKey: `stripe-purchase:${session.id}`,
        transaction: {
          type: 'purchase',
          amount: CREDIT_PRICING.creditsPerPurchase,
          timestamp: Date.now(),
          details: `Purchased ${CREDIT_PRICING.creditsPerPurchase} credits`,
          stripeSessionId: session.id,
        },
      },
    ));
  } catch (err) {
    // Drop the gate so Stripe's retry can have another go — leaving it at
    // 'processing' would make the retry return early and lose a paid grant.
    //
    // Deleting this gate is only safe because it is not the last one. The
    // retry re-enters adjustUserCredits, which keeps its own
    // `credit-applied:stripe-purchase:{session}` marker for 90 days and only
    // ever removes it for a failure that happened *before* the balance was
    // written. So either the balance moved and the marker survives (the retry
    // is a no-op returning applied: false), or neither happened and the retry
    // pays out exactly once. The marker used to be rolled back for any failure
    // at all, ledger appends included — which, with this delete, turned one
    // payment into two grants.
    await env.TRIVIA_KV.delete(idempotencyKey);
    throw err;
  }

  // Save Stripe customer ID if we got one. This is a second write, so it has
  // to re-read the user under the same per-user lock adjustUserCredits takes
  // internally (auth.ts) — keep the key in step with it:
  // writing the pre-grant `user` object back here would carry its stale
  // credits and undo the purchase we just made. Best-effort — a paid-for
  // grant must not fail on a bookkeeping field.
  const customerId = session.customer;
  if (customerId && !credited.stripeCustomerId) {
    try {
      await withKvLock(env, `credit-lock:user:${credited.email}`, async () => {
        const fresh = await getUser(credited.email, env);
        if (!fresh || fresh.stripeCustomerId) return;
        fresh.stripeCustomerId = customerId;
        await updateUser(fresh, env);
      });
    } catch (err) {
      if (!(err instanceof KvLockBusyError)) throw err;
      // Another credit op holds the lock; the id gets picked up next purchase.
      console.warn('Stripe customer id not saved, lock busy', session.id);
    }
  }

  // Mark as fulfilled
  await env.TRIVIA_KV.put(idempotencyKey, 'fulfilled', { expirationTtl: 30 * 24 * 60 * 60 });
}

// --- Stripe types (minimal) ---

interface StripeCheckoutEvent {
  type: string;
  data: {
    object: {
      id: string;
      customer?: string;
      customer_email?: string;
      metadata?: Record<string, string>;
      payment_status: string;
    };
  };
}
