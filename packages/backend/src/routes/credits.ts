import { Hono } from 'hono';
import type { Env } from '../env';
import { getSessionUser, adjustUserCredits, KvLockBusyError } from '../auth';
import { redeemCoupon } from '../coupons';
import { createCheckoutSession, verifyWebhookSignature, handleCheckoutCompleted } from '../stripe';
import { ipRateLimit, authVerifyLimiter, getClientIP } from '../middleware/rate-limit';

const credits = new Hono<{ Bindings: Env }>();

// POST /api/checkout — create Stripe Checkout session
credits.post('/checkout', async (c) => {
  const user = await getSessionUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const checkoutUrl = await createCheckoutSession(user, c.env);
  return c.json({ url: checkoutUrl });
});

// POST /api/webhooks/stripe — Stripe webhook
credits.post('/webhooks/stripe', async (c) => {
  const sig = c.req.header('stripe-signature');
  if (!sig || !c.env.STRIPE_WEBHOOK_SECRET) {
    return c.json({ error: 'Missing signature' }, 400);
  }
  const payload = await c.req.text();
  const valid = await verifyWebhookSignature(payload, sig, c.env.STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    return c.json({ error: 'Invalid signature' }, 400);
  }
  const event = JSON.parse(payload);
  if (event.type === 'checkout.session.completed') {
    await handleCheckoutCompleted(event, c.env);
  }
  return c.json({ received: true });
});

// GET /api/credits/balance
credits.get('/credits/balance', async (c) => {
  const user = await getSessionUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  return c.json({ credits: user.credits });
});

// GET /api/credits/transactions
credits.get('/credits/transactions', async (c) => {
  const user = await getSessionUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const { getCreditTransactions } = await import('../auth');
  const transactions = await getCreditTransactions(user.userId, c.env);
  return c.json({ transactions });
});

// POST /api/coupons/redeem
credits.post('/coupons/redeem', async (c) => {
  if (!authVerifyLimiter.check(getClientIP(c.req.raw))) {
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }
  const user = await getSessionUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Sign in to redeem a coupon' }, 401);

  const body = (await c.req.json()) as { code?: string };
  if (!body.code || typeof body.code !== 'string' || body.code.trim().length === 0) {
    return c.json({ error: 'Coupon code is required' }, 400);
  }

  try {
    let newBalance = user.credits;

    // The grant runs inside redeemCoupon's per-coupon lock, keyed so a
    // duplicate can't double-credit. `user.credits` here is a pre-redemption
    // snapshot — adjustUserCredits re-reads the real balance under its own
    // lock rather than trusting it, which is what the old
    // `user.credits += n; updateUser(user)` got wrong.
    const { credits: creditsGranted } = await redeemCoupon(
      c.env,
      body.code.trim(),
      user.email,
      async (coupon) => {
        const result = await adjustUserCredits(c.env, user.email, coupon.credits, {
          idempotencyKey: `coupon:${coupon.code}:${coupon.createdAt}:${user.userId}`,
          transaction: {
            type: 'coupon',
            amount: coupon.credits,
            timestamp: Date.now(),
            details: `Coupon ${coupon.code}: ${coupon.note || 'Free credits'}`,
          },
        });
        newBalance = result.user.credits;
      },
    );

    return c.json({ credits: creditsGranted, newBalance });
  } catch (err) {
    if (err instanceof KvLockBusyError) {
      // A concurrent redemption holds the coupon or the user lock. That is a
      // conflict with the current state, not a malformed request — the same
      // condition, and now the same status, as the admin credit route.
      return c.json({ error: err.message }, 409);
    }
    return c.json(
      { error: err instanceof Error ? err.message : 'Failed to redeem coupon' },
      400,
    );
  }
});

export { credits as creditRoutes };
