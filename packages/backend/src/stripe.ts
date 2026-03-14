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
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return parts.signatures.includes(computed);
}

// --- Webhook handler ---

export async function handleCheckoutCompleted(
  event: StripeCheckoutEvent,
  env: Env,
): Promise<void> {
  const session = event.data.object;
  const email = session.metadata?.email ?? session.customer_email;
  if (!email) {
    console.error('Webhook missing email', session.id);
    return;
  }

  // Idempotency check
  const idempotencyKey = `stripe-fulfilled:${session.id}`;
  const existing = await env.TRIVIA_KV.get(idempotencyKey);
  if (existing) return;

  const user = await getUser(email, env);
  if (!user) {
    console.error('Webhook user not found', email);
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

  // Mark as fulfilled (keep for 30 days to prevent replays)
  await env.TRIVIA_KV.put(idempotencyKey, '1', { expirationTtl: 30 * 24 * 60 * 60 });
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
