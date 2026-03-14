import { Env, getStripeKey } from './env';
import { CREDIT_PRICING } from '@lamo-trivia/shared';
import type { User } from '@lamo-trivia/shared';
import { getUser, updateUser, addCreditTransaction } from './auth';

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
    'line_items[0][price_data][product_data][name]': `${CREDIT_PRICING.creditsPerPurchase} Scavenger Hunt Credits`,
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

  // Add credits
  user.credits += CREDIT_PRICING.creditsPerPurchase;

  // Save Stripe customer ID if we got one
  if (session.customer && !user.stripeCustomerId) {
    user.stripeCustomerId = session.customer;
  }

  await updateUser(user, env);

  // Record transaction
  await addCreditTransaction(user.userId, {
    type: 'purchase',
    amount: CREDIT_PRICING.creditsPerPurchase,
    timestamp: Date.now(),
    details: `Purchased ${CREDIT_PRICING.creditsPerPurchase} credits`,
    stripeSessionId: session.id,
  }, env);

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
