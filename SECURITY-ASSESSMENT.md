# Security Assessment — LAMO Trivia

**Date:** 2026-03-15
**Scope:** Full codebase review (backend + frontend)
**Stack:** Cloudflare Workers (Hono), Durable Objects, KV, R2, React (Vite)

---

## Executive Summary

The application demonstrates **strong security fundamentals**. Authentication uses cryptographically secure tokens with timing-safe comparisons, CORS is properly restricted, input validation uses Zod schemas, and rate limiting is applied across all major endpoints. The codebase avoids common pitfalls like `dangerouslySetInnerHTML`, `eval()`, and wildcard CORS origins.

**Severity counts:** 0 Critical | 2 Medium | 4 Low | 5 Informational

---

## Findings

### MEDIUM Severity

#### M1. In-Memory Rate Limiting Resets on Worker Eviction

**Location:** `packages/backend/src/middleware/rate-limit.ts`

The `RateLimiter` class uses an in-memory `Map` to track request counts. Cloudflare Workers isolates are ephemeral — they can be evicted and recreated at any time. When this happens, all rate-limit state is lost, effectively resetting all limits.

**Impact:** An attacker could bypass rate limits by waiting for isolate recycling, or by targeting requests across multiple colocations. The `authCodeLimiter` (5 codes/hour) and `authVerifyLimiter` (20/min) are the most security-sensitive limiters affected.

**Recommendation:** For security-critical limiters (auth code sending, auth verification), consider using Cloudflare's built-in Rate Limiting rules (WAF), KV-backed counters, or Durable Objects for persistent state. The current approach is still valuable as a first layer of defense.

---

#### M2. WebSocket Rejoin Lacks Authentication

**Location:** `packages/backend/src/room.ts:244-264`

The `rejoin_game` WebSocket message allows any client to reconnect as an existing player by providing only a username (case-insensitive match). There is no session token or secret binding a WebSocket connection to a player identity.

**Impact:** During an active game, an attacker who knows (or guesses) a player's username could send a `rejoin_game` message and receive the full game state, including scores and current question. They could also submit answers on behalf of that player.

**Recommendation:** Bind WebSocket connections to a session or per-player secret. For example, issue a reconnect token on initial join and require it for rejoin.

---

### LOW Severity

#### L1. Session Tokens Stored in localStorage

**Location:** `packages/frontend/src/lib/api.ts:8`

Session tokens are stored in `localStorage` under the key `lamo_auth_token`. While this is a common pattern, `localStorage` is accessible to any JavaScript running on the same origin, making it vulnerable to XSS attacks.

**Impact:** If an XSS vulnerability were introduced (none exist currently), an attacker could exfiltrate session tokens. The risk is low because the frontend currently has no `dangerouslySetInnerHTML`, `eval()`, or other XSS vectors.

**Recommendation:** Consider using `httpOnly` cookies for session management (requires backend CORS changes). Alternatively, accept the current risk given the absence of XSS vectors and the lower sensitivity of the data (trivia game, not financial).

---

#### L2. Race Condition in Stripe Webhook Credit Fulfillment

**Location:** `packages/backend/src/stripe.ts:152-156`

The idempotency check uses KV `get` followed by `put`, which is not atomic. Under concurrent Stripe webhook retries, two requests could both read `null` before either writes, leading to double-crediting.

**Impact:** A user could receive double credits from a single purchase. This requires exact timing of concurrent webhook deliveries (unlikely but possible).

**Recommendation:** Use a conditional KV write or a Durable Object to enforce atomicity. Alternatively, Stripe's `checkout.session.completed` event is typically delivered once, so the practical risk is low.

---

#### L3. Group Game Creation Does Not Require Group Membership

**Location:** `packages/backend/src/routes/groups.ts:92-168`

The `POST /api/groups/:groupId/games` endpoint validates that the group exists but does not verify that the requesting user is a member or owner of the group. Any user with a valid `groupId` can create games within any group.

**Impact:** An attacker who discovers or guesses a group ID could create unwanted games in another user's group. Group IDs appear to be randomly generated, reducing discoverability.

**Recommendation:** Add group membership or ownership verification before allowing game creation within a group.

---

#### L4. Photo Upload Endpoint Lacks Authentication

**Location:** `packages/backend/src/routes/hunts.ts:78-108`

The `POST /api/hunts/:huntId/photos` endpoint only validates the hunt ID, file size, and content type. It does not require the user to be authenticated or to be a participant in the hunt.

**Impact:** Anyone who knows a hunt ID could upload arbitrary images (within the 5MB limit) to R2 storage, consuming storage quota. The images would not be used for verification unless submitted through the WebSocket flow.

**Recommendation:** Require session authentication and optionally verify the uploader is a participant in the specified hunt.

---

### INFORMATIONAL

#### I1. Secrets Management is Well-Implemented

- All API keys use Cloudflare Worker secrets (not hardcoded)
- Secret Store bindings are supported for wrangler v4+
- `.dev.vars` is in `.gitignore` and only `.dev.vars.example` (with placeholder values) is committed
- No real credentials found in the repository

#### I2. CORS Configuration is Correct

- Origin allowlist is properly enforced (no `*` with credentials)
- `Vary: Origin` header is set to prevent cache poisoning
- WebSocket upgrades validate the `Origin` header against the allowlist
- Security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`) are set

#### I3. Timing-Safe Comparisons Used Consistently

- `timingSafeEqual()` in `auth.ts` uses `crypto.subtle.timingSafeEqual` with an HMAC fallback
- Applied to: magic code verification, session token validation, seed secret auth, host secret validation, Stripe webhook signatures
- This prevents timing side-channel attacks on all secret comparisons

#### I4. Prompt Injection Mitigations for AI Features

- `vision.ts`: System prompt explicitly warns about manipulation attempts in item descriptions; descriptions are delimited with backticks and labeled as DATA
- `questions/ai.ts`: Topic input is sanitized (control chars, newlines, backticks stripped)
- These mitigations reduce but cannot fully eliminate prompt injection risk — this is inherent to LLM-based features

#### I5. Dependency Vulnerabilities (Dev/Build Only)

`npm audit` reports 5 vulnerabilities:
- **esbuild** (moderate): Dev server request leakage — only affects local development
- **undici** (high): Multiple issues (WebSocket overflow, HTTP smuggling, CRLF injection, DoS) — via `wrangler`/`miniflare`, only used in development/testing

None of these affect the production Cloudflare Workers runtime. They should be updated when compatible versions are available, but pose no immediate production risk.

---

## Positive Security Patterns Observed

| Area | Implementation |
|------|---------------|
| Authentication | Magic code (email OTP) with attempt limits, expiring codes, secure token generation |
| Admin Auth | Cloudflare Access JWT validation in production, SEED_SECRET fallback restricted to dev-only |
| Input Validation | Zod schemas for all user-facing inputs (`GameConfigSchema`, `HuntConfigSchema`, `SendCodeRequestSchema`, etc.) |
| Rate Limiting | Applied to all sensitive endpoints (auth, game creation, photo upload, admin) |
| WebSocket Security | Origin validation, per-connection message rate limiting (30/10s), message size cap (2KB), schema validation |
| Error Handling | Generic error messages to clients, detailed logging server-side, no stack traces leaked |
| File Upload | Content-type allowlist, size limits, UUID-based filenames (prevents path traversal) |
| Data Exposure | `hostSecret` stripped from hunt history responses (`const { hostSecret: _, ...safeEntry } = entry`) |

---

## Recommendations Summary

| Priority | Finding | Effort | Impact |
|----------|---------|--------|--------|
| Medium | M1. Persistent rate limiting for auth endpoints | Medium | Prevents brute-force on magic codes |
| Medium | M2. WebSocket rejoin authentication | Low | Prevents game session hijacking |
| Low | L1. Consider httpOnly cookies for tokens | Medium | Defense-in-depth against XSS |
| Low | L2. Atomic idempotency for Stripe webhooks | Low | Prevents double-crediting edge case |
| Low | L3. Group membership check for game creation | Low | Prevents unauthorized group game creation |
| Low | L4. Auth on photo upload endpoint | Low | Prevents storage abuse |
