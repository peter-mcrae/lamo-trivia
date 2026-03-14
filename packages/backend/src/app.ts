import { Hono } from 'hono';
import type { Env } from './env';
import { logError } from './errors';
import { authRoutes } from './routes/auth';
import { gameRoutes, miscRoutes } from './routes/games';
import { groupRoutes } from './routes/groups';
import { huntRoutes } from './routes/hunts';
import { creditRoutes } from './routes/credits';
import { adminRoutes } from './routes/admin';

export const app = new Hono<{ Bindings: Env }>();

// --- Route groups ---
app.route('/api/auth', authRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/games', gameRoutes);
app.route('/api/groups', groupRoutes);
app.route('/api/hunts', huntRoutes);

// Credit routes are mounted at /api level since they span /api/checkout,
// /api/webhooks/stripe, /api/credits/*, /api/coupons/redeem
app.route('/api', creditRoutes);

// Misc routes: /api/t, /api/health, /api/seed, /api/categories, /api/username/check,
// /api/analytics/summary, /api/ai-question-bank
app.route('/api', miscRoutes);

// Catch-all for unmatched /api routes
app.all('/api/*', (c) => c.notFound());

// Global error handler
app.onError((err, c) => {
  const url = new URL(c.req.url);
  if (err instanceof SyntaxError) {
    return c.json({ error: 'Invalid JSON in request body' }, 400);
  }
  logError(c.env, { route: url.pathname, method: c.req.method }, err, {
    ip: c.req.header('CF-Connecting-IP') ?? 'unknown',
  });
  return c.json({ error: 'Internal server error' }, 500);
});
