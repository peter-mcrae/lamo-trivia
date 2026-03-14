# Refactor Plan: Hono Router Migration + Admin Subdomain Split

## Overview

Two-phase refactor:
1. **Phase 1** — Migrate backend from 890-line if/else router to Hono framework with route groups and middleware
2. **Phase 2** — Extract admin frontend into its own `packages/admin` CF Pages project for `admin.lamotrivia.app`

## Phase 1: Backend Hono Migration

### 1.1 Install Hono

Add `hono` dependency to `packages/backend/package.json`. Hono is built for Cloudflare Workers — zero external deps, ~14KB.

### 1.2 Create route modules

Split `router.ts` (890 lines) into focused route files:

```
packages/backend/src/
  routes/
    auth.ts          — /api/auth/* (send-code, verify-code, me, logout)
    games.ts         — /api/games, /api/categories, /api/username/check, /api/ai-question-bank
    groups.ts        — /api/groups/* (create, list, get, group games, group hunts)
    hunts.ts         — /api/hunts/* (create, photos, history)
    credits.ts       — /api/checkout, /api/webhooks/stripe, /api/credits/*, /api/coupons/redeem
    admin.ts         — /api/admin/* (moved from admin-routes.ts)
    tracking.ts      — /api/t (analytics beacon)
    seed.ts          — /api/seed, /api/analytics/summary
  middleware/
    rate-limit.ts    — Unified RateLimiter class (consolidates 2 duplicate implementations)
    admin-auth.ts    — CF Access JWT + SEED_SECRET fallback middleware (from admin-auth.ts)
    seed-auth.ts     — Bearer SEED_SECRET middleware for seed/analytics endpoints
  app.ts             — Hono app assembly: mount route groups + middleware
```

### 1.3 Rewrite `index.ts` entry point

Current `index.ts` handles CORS, WebSocket upgrades, then delegates to `handleRequest()`. New structure:

```ts
// index.ts — thin entry point
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { app } from './app';

export { GameLobby, GameRoom, PrivateGroup, ScavengerHuntRoom };

export default {
  fetch(request: Request, env: Env) {
    return app.fetch(request, env);
  }
};
```

WebSocket upgrades will be handled as Hono routes with `c.env` access.

### 1.4 Consolidate rate limiting

Current state: `router.ts` has its own `RateLimiter` class + 9 instances, and `admin-routes.ts` has a separate `adminRateLimiter` Map. Consolidate into `middleware/rate-limit.ts` with a single `RateLimiter` class and per-route-group middleware factories.

### 1.5 Wire up the Hono app (`app.ts`)

```ts
const app = new Hono<{ Bindings: Env }>();

// CORS
app.use('/api/*', cors({ origin: (_, c) => c.env.FRONTEND_URL, ... }));

// WebSocket upgrades
app.get('/ws/game/:gameId', handleGameWS);
app.get('/ws/hunt/:huntId', handleHuntWS);
app.get('/ws/group/:groupId', handleGroupWS);

// Route groups
app.route('/api/auth', authRoutes);
app.route('/api/admin', adminRoutes);     // has cfAccessAuth middleware
app.route('/api/games', gameRoutes);
app.route('/api/groups', groupRoutes);
app.route('/api/hunts', huntRoutes);
app.route('/api/credits', creditRoutes);
// ... etc

// Catch-all
app.all('*', (c) => c.text('Not found', 404));
```

### 1.6 Update admin routes with Hono middleware

```ts
// routes/admin.ts
const admin = new Hono<{ Bindings: Env }>();
admin.use('*', cfAccessAuthMiddleware);    // every admin route, no exceptions
admin.use('*', adminRateLimitMiddleware);
admin.get('/users', handleListUsers);
admin.get('/users/:email', handleGetUser);
admin.post('/users/:email/credits', handleAdjustCredits);
// ... etc
```

Handler functions stay largely the same — just adapted to use `c.req`, `c.env`, `c.json()` instead of raw `Request`/`Response`.

### 1.7 Update tests

Tests currently call `handleRequest(request, env)` directly. Update to call the Hono app's `fetch` method instead:

```ts
// Before:
const response = await handleRequest(request, env);

// After:
const response = await app.fetch(request, env);
```

The mock infrastructure (`mocks.ts`) stays the same — it mocks KV, DOs, etc. which Hono doesn't touch.

### 1.8 Delete old files

Remove:
- `router.ts` (replaced by `app.ts` + route modules)
- `admin-routes.ts` (moved to `routes/admin.ts`)
- Inline rate limiter code from admin-routes.ts

Keep:
- `admin-auth.ts` → move to `middleware/admin-auth.ts`
- All DO files (`lobby.ts`, `room.ts`, `group.ts`, `hunt-room.ts`) — unchanged
- All business logic files (`auth.ts`, `coupons.ts`, `stripe.ts`, etc.) — unchanged

---

## Phase 2: Admin Subdomain Split

### 2.1 Create `packages/admin` package

```
packages/admin/
  package.json           — same deps as frontend (React, React Router, Vite, Tailwind)
  wrangler.toml          — CF Pages config for admin.lamotrivia.app
  vite.config.ts         — dev proxy to localhost:8787
  tsconfig.json
  tailwind.config.js
  postcss.config.js
  public/
    _routes.json         — { include: ["/api/*"] }
    _headers             — security headers
  functions/
    api/[[catchall]].ts  — service binding proxy to lamo-trivia-api Worker
  src/
    main.tsx
    App.tsx              — admin routes only (no public routes)
    components/
      AdminLayout.tsx    — simplified: no checkAccess() hack, CF Access handles auth
    pages/
      AdminDashboard.tsx
      AdminUsers.tsx
      AdminUserDetail.tsx
      AdminAnalytics.tsx
      AdminErrors.tsx
      AdminCoupons.tsx
    lib/
      admin-api.ts       — API_BASE changes to '/api/admin' (relative, same subdomain)
```

### 2.2 Admin `wrangler.toml`

```toml
name = "lamo-trivia-admin"
pages_build_output_dir = "./dist"

[[services]]
binding = "API"
service = "lamo-trivia-api"
```

### 2.3 Admin `_routes.json`

```json
{
  "version": 1,
  "include": ["/api/*"],
  "exclude": []
}
```

### 2.4 Simplify AdminLayout

Remove the `checkAccess()` client-side auth hack. CF Access protects the entire subdomain at the edge — if you can load the page, you're authenticated. Keep a lightweight verification as defense-in-depth (the middleware still validates the JWT), but remove the loading/denied states and redirect logic.

### 2.5 Simplify admin-api.ts

- Remove HTML-response detection workaround (lines 13-15) — CF Access means no SPA fallback confusion
- `API_BASE` becomes `/api/admin` (relative to admin subdomain, proxied via service binding)
- Remove `checkAccess()` method entirely

### 2.6 Remove admin from `packages/frontend`

Delete from frontend:
- `src/pages/admin/` (all 6 files)
- `src/components/AdminLayout.tsx`
- `src/lib/admin-api.ts`
- Admin imports and routes from `App.tsx`

### 2.7 Update root `package.json`

Add `packages/admin` to workspaces:
```json
{
  "workspaces": [
    "packages/shared",
    "packages/backend",
    "packages/frontend",
    "packages/admin",
    "packages/monitor"
  ],
  "scripts": {
    "dev:admin": "npm run dev --workspace=packages/admin",
    "deploy:admin": "npm run deploy --workspace=packages/admin"
  }
}
```

### 2.8 Backend: support admin subdomain CORS

Update CORS in `app.ts` to allow both origins:
```ts
const allowedOrigins = [env.FRONTEND_URL, env.ADMIN_URL];
```

Add `ADMIN_URL` to `Env` type and `wrangler.toml`:
```toml
[vars]
FRONTEND_URL = "https://lamotrivia.app"
ADMIN_URL = "https://admin.lamotrivia.app"
```

---

## What doesn't change

- **Durable Objects** (`lobby.ts`, `room.ts`, `group.ts`, `hunt-room.ts`) — untouched
- **Business logic** (`auth.ts`, `coupons.ts`, `stripe.ts`, `questions/`, `vision.ts`, `analytics.ts`, `errors.ts`, `ga.ts`) — untouched
- **Shared package** (`packages/shared`) — untouched
- **Monitor package** (`packages/monitor`) — untouched
- **Frontend public routes** — untouched (just removing admin references)

## File change summary

| Action | Files |
|--------|-------|
| **New** | `packages/backend/src/app.ts`, `routes/*.ts` (7 files), `middleware/*.ts` (3 files) |
| **New** | `packages/admin/` (entire new package, ~15 files) |
| **Modified** | `packages/backend/src/index.ts` (simplified), `packages/backend/package.json` (+hono) |
| **Modified** | `packages/backend/src/env.ts` (+ADMIN_URL), `packages/backend/wrangler.toml` (+ADMIN_URL var) |
| **Modified** | `packages/frontend/src/App.tsx` (remove admin routes/imports) |
| **Modified** | Root `package.json` (add admin workspace + scripts) |
| **Modified** | Test files (update to use `app.fetch()` instead of `handleRequest()`) |
| **Deleted** | `packages/backend/src/router.ts`, `packages/backend/src/admin-routes.ts` |
| **Moved** | `packages/backend/src/admin-auth.ts` → `packages/backend/src/middleware/admin-auth.ts` |
| **Deleted from frontend** | `AdminLayout.tsx`, `admin-api.ts`, `pages/admin/*.tsx` (6 files) |

## Execution order

1. Phase 1 first (Hono migration) — this is the structural fix
2. Run existing tests after migration to verify no regressions
3. Phase 2 (admin split) — extract and deploy
4. Run all tests again to confirm
