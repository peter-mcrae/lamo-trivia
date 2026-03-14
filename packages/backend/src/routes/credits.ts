import { Hono } from 'hono';
import type { Env } from '../env';
import { getSessionUser, addCreditTransaction, updateUser } from '../auth';
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
    const { credits: creditsGranted, coupon } = await redeemCoupon(c.env, body.code.trim(), user.email);

    user.credits += creditsGranted;
    await updateUser(user, c.env);

    await addCreditTransaction(user.userId, {
      type: 'coupon',
      amount: creditsGranted,
      timestamp: Date.now(),
      details: `Coupon ${coupon.code}: ${coupon.note || 'Free credits'}`,
    }, c.env);

    return c.json({ credits: creditsGranted, newBalance: user.credits });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : 'Failed to redeem coupon' },
      400,
    );
  }
});

export { credits as creditRoutes };
