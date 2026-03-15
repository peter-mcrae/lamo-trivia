# LAMO Trivia - Deployment Guide

## Overview

4 deployable components, all on Cloudflare:

| Component | Type | Domain | Cloudflare Project |
|-----------|------|--------|-------------------|
| Backend | Worker | api.lamotrivia.app | `lamo-trivia-api` |
| Frontend | Pages | lamotrivia.app | `lamo-trivia` |
| Admin | Pages + Functions | admin.lamotrivia.app | `lamo-trivia-admin` |
| Monitor | Worker (cron) | (no domain) | `lamo-trivia-monitor` |

## Deploy Commands

```bash
# From repo root:
npm run deploy:backend    # wrangler deploy
npm run deploy:frontend   # vite build && wrangler pages deploy
npm run deploy:admin      # vite build && wrangler pages deploy
npm run deploy:monitor    # wrangler deploy
```

Frontend and Admin are also auto-deployed via GitHub Git integration on push to main.

**IMPORTANT**: Admin has a Pages Function (`functions/api/[[catchall]].ts`) that proxies `/api/*` to `api.lamotrivia.app`. The Cloudflare Pages build config root directory MUST be set to `packages/admin` for Git-integrated deploys to include the function. If the function isn't included, API calls return HTML instead of JSON.

## Backend Worker Secrets

Set via `cd packages/backend && npx wrangler secret put <NAME>`:

| Secret | Required | Purpose |
|--------|----------|---------|
| `SEED_SECRET` | Yes | Auth for `POST /api/seed` + dev admin fallback |
| `CF_ACCESS_TEAM_DOMAIN` | Yes (prod) | Cloudflare Access team name (e.g. `lamotrivia`) |
| `CF_ACCESS_AUD` | Yes (prod) | Access application audience tag |
| `OPENAI_API_KEY` | Optional | AI-generated trivia questions |
| `ANTHROPIC_API_KEY` | Optional | Claude vision for scavenger hunt photo verification |
| `RESEND_API_KEY` | Optional | Magic code emails |
| `STRIPE_SECRET_KEY` | Optional | Payments |
| `STRIPE_WEBHOOK_SECRET` | Optional | Stripe webhook validation |
| `GA_API_SECRET` | Optional | GA4 server-side analytics |

## Backend Worker Environment Variables

Set in `wrangler.toml` `[vars]`:

| Var | Value | Purpose |
|-----|-------|---------|
| `FRONTEND_URL` | `https://lamotrivia.app` | CORS allowlist |
| `ADMIN_URL` | `https://admin.lamotrivia.app` | CORS allowlist |
| `GA_MEASUREMENT_ID` | `G-804RC3BG82` | GA4 tracking |

## Backend Bindings

| Binding | Type | ID/Name |
|---------|------|---------|
| `TRIVIA_KV` | KV Namespace | `34ed0bee812244b59410394854c16952` |
| `R2_HUNT_PHOTOS` | R2 Bucket | `lamo-hunt-photos` |
| `GAME_LOBBY` | Durable Object | `GameLobby` |
| `GAME_ROOM` | Durable Object | `GameRoom` |
| `PRIVATE_GROUP` | Durable Object | `PrivateGroup` |
| `SCAVENGER_HUNT_ROOM` | Durable Object | `ScavengerHuntRoom` |

## Frontend Environment

| Var | File | Value |
|-----|------|-------|
| `VITE_API_URL` | `.env.production` | `https://api.lamotrivia.app/api` |

This is baked into the JS bundle at build time. In dev, falls back to `/api` (proxied by Vite to localhost:8787).

## Cloudflare Zero Trust (Access)

- **Protected domain**: `admin.lamotrivia.app`
- **Team domain**: `lamotrivia.cloudflareaccess.com`
- **Access app domains**: `*.lamo-trivia-admin.pages.dev`, `admin.lamotrivia.app/*`
- **DO NOT** add `lamotrivia.app` or `lamo-trivia.pages.dev` to the Access app — it blocks the public site
- Admin auth flow: Access injects `Cf-Access-Jwt-Assertion` header → Pages Function proxies to `api.lamotrivia.app` with that header → backend validates JWT

## DNS Records (Cloudflare zone: lamotrivia.app)

- `lamotrivia.app` → Pages project `lamo-trivia` (custom domain)
- `admin.lamotrivia.app` → Pages project `lamo-trivia-admin` (custom domain)
- `api.lamotrivia.app` → Proxied record (Worker route catches `api.lamotrivia.app/*`)

## Cloudflare Pages Build Config

### Frontend (`lamo-trivia`)
- Root directory: `packages/frontend`
- Build command: `npm install && npm run build`
- Output directory: `dist`

### Admin (`lamo-trivia-admin`)
- Root directory: `packages/admin` (MUST be this for Functions to work)
- Build command: `npm run build` (v2 root directory strategy runs `npm install` at repo root automatically)
- Output directory: `dist` (configured in `packages/admin/wrangler.toml` as `pages_build_output_dir`)
- Has `functions/api/[[catchall]].ts` — proxies `/api/*` to backend
- Has `_routes.json` — routes `/api/*` to the function

## Dev Setup

```bash
# Terminal 1: Backend
npm run dev:backend    # wrangler dev on port 8787

# Terminal 2: Frontend
npm run dev:frontend   # Vite on port 5173 (proxies /api and /ws to 8787)

# Terminal 3 (optional): Admin
npm run dev:admin      # Vite on port 5174 (proxies /api to 8787)
```

## Content Security Policy

Frontend CSP allows: `connect-src 'self' https://api.lamotrivia.app wss://api.lamotrivia.app https://cloudflareinsights.com`

Admin CSP allows: `connect-src 'self' https://api.lamotrivia.app`
