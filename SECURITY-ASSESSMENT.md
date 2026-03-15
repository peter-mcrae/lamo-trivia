# Security Assessment — LAMO Trivia

**Date:** 2026-03-15
**Scope:** Full-stack review of authentication, authorization, input validation, payment processing, WebSocket security, CORS, and frontend token handling.

---

## Executive Summary

The LAMO Trivia codebase demonstrates **strong security practices** across most areas. Authentication uses cryptographically secure tokens with timing-safe comparisons, Stripe webhook verification is properly implemented with idempotency guards, WebSocket connections are rate-limited and validated against schemas, CORS is properly restricted, and prompt injection defenses are in place for AI integrations.

**Overall rating: Good** — with a few findings worth addressing, most of which are low severity.

---

## Findings

### CRITICAL — None

No critical vulnerabilities were identified.

### HIGH — None

No high-severity vulnerabilities were identified.

---

### MEDIUM

#### M1. Stripe Webhook Idempotency Race Condition

**File:** `packages/backend/src/stripe.ts:152-156`

The idempotency check uses a read-then-write pattern:
```ts
const existing = await env.TRIVIA_KV.get(idempotencyKey);
if (existing) return;
await env.TRIVIA_KV.put(idempotencyKey, 'processing', ...);
```
KV is eventually consistent, so two near-simultaneous webhook retries could both pass the `get()` check before either `put()` propagates. This could result in double-crediting a purchase.

**Recommendation:** This is mitigated by Stripe's own deduplication (webhooks typically retry after 5+ seconds), and the practical risk is low. However, for belt-and-suspenders protection, consider using a Durable Object for atomic idempotency checks, or accept the current risk given the low probability.

---

#### M2. In-Memory Rate Limiting Resets on Worker Recycling

**File:** `packages/backend/src/middleware/rate-limit.ts`

Rate limiters use in-memory `Map` instances. Cloudflare Workers isolates are ephemeral — when an isolate is recycled (which can happen frequently under load or after idle periods), all rate limit state is lost. An attacker could theoretically bypass rate limits by triggering requests to different isolates.

**Recommendation:** For auth-critical endpoints (`send-code`, `verify-code`), consider supplementing with a KV-backed or Durable Object-backed counter for more durable rate limiting. The current approach still provides good protection against casual abuse.

---

### LOW

#### L1. Accept-Invite Endpoint Has No Rate Limiting

**File:** `packages/backend/src/routes/auth.ts:67-123`

The `POST /api/auth/accept-invite` endpoint validates the token format (`/^[0-9a-f]{64}$/`) but has no rate limiter. While brute-forcing a 256-bit token is computationally infeasible, adding IP-based rate limiting would be consistent with other endpoints.

**Recommendation:** Add `authVerifyLimiter` or a dedicated limiter to this endpoint.

---

#### L2. Hunt History Endpoint Has No Authentication

**File:** `packages/backend/src/routes/hunts.ts:111-127`

`GET /api/hunts/history` lists all historical hunts without requiring authentication — only IP-based rate limiting. While hunt history data is likely non-sensitive, any authenticated user could enumerate all hunts.

**Recommendation:** Consider whether this is intentional (public leaderboard) or should require auth. If intentional, no change needed.

---

#### L3. Group Game Creation Doesn't Verify Group Membership

**File:** `packages/backend/src/routes/groups.ts:92-168`

`POST /api/groups/:groupId/games` only verifies the group exists, not that the requester is a member. Anyone who knows a `groupId` (which is a short, guessable join code) could create games in any group.

**Recommendation:** Verify the request comes from an authenticated group member or owner before allowing game creation.

---

#### L4. Group Member Recovery Has No Authentication

**File:** `packages/backend/src/group.ts:321-352`

The `recover_member` WebSocket message allows anyone who knows a username and has the group's join code to reclaim that member's identity. There's no verification beyond username matching.

**Recommendation:** This is a UX tradeoff (the app targets casual social play), but for groups with sensitive data, consider adding a verification step.

---

#### L5. Coupon Redemption Race Condition

**File:** `packages/backend/src/coupons.ts:124-178`

`redeemCoupon()` uses a read-modify-write pattern on KV. Two simultaneous redemptions for the same coupon could both pass the `usedCount < maxUses` check before either write propagates. This could allow extra redemptions beyond `maxUses`.

**Recommendation:** For high-value coupons, consider using a Durable Object for atomic redemption. For typical usage (small number of users redeeming), this is unlikely to be exploited.

---

### INFORMATIONAL

#### I1. Secrets Well Managed

- API keys (OpenAI, Anthropic, Resend, Stripe) use the Secret Store pattern with fallback to classic secrets — good separation.
- `SEED_SECRET` dev fallback is properly guarded to only activate when `CF_ACCESS_AUD` is not set.
- Stripe webhook secret uses constant-time comparison.

#### I2. Authentication — Strong Implementation

- Magic codes: 6-digit, 10-minute TTL, max 5 attempts, timing-safe comparison.
- Session tokens: 256-bit, cryptographically random, server-side validation.
- Admin auth: CF Access JWT with proper signature verification (RS256), audience validation, expiration check, issuer validation, and JWKS caching.

#### I3. Input Validation — Comprehensive

- All API inputs validated with Zod schemas before processing.
- WebSocket messages validated with discriminated union schemas.
- Message size limits (2KB) on all WebSocket handlers.
- Photo filenames validated against UUID regex to prevent path traversal.
- AI topic input sanitized to strip control characters and backticks.
- Admin parameters validated (email format, session token format, date format).

#### I4. CORS — Properly Configured

- Origin allowlist (frontend + admin URLs only), no wildcard.
- `Vary: Origin` header set correctly.
- `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` headers present.
- WebSocket upgrades require matching Origin header.

#### I5. Prompt Injection Defenses — Good

- `vision.ts`: Item descriptions are delimited as data, system prompt warns against injection, and the description is explicitly marked as not-instructions.
- `questions/ai.ts`: Topic input is sanitized to remove control chars, backticks, and newlines.

#### I6. Frontend Token Handling

- Auth token stored in `localStorage` under `lamo_auth_token`.
- Token sent via `Authorization: Bearer` header (not cookies), avoiding CSRF.
- Session cleared client-side when server confirms invalidity.
- Network errors preserve token (avoids unnecessary logouts on transient failures).

#### I7. Payment Processing

- Stripe webhook signature verified with constant-time comparison.
- Replay protection: timestamps older than 5 minutes rejected.
- Idempotency key prevents double-crediting (with minor race condition noted in M1).
- Payment status checked (`payment_status === 'paid'`) before crediting.

---

## Checklist Summary

| Category | Status | Notes |
|---|---|---|
| Authentication | ✅ Strong | Timing-safe, crypto-random tokens, magic code limits |
| Authorization | ⚠️ Adequate | Group membership not verified for game creation (L3) |
| Input Validation | ✅ Strong | Zod schemas, size limits, path traversal prevention |
| Payment Security | ✅ Strong | Webhook verification, idempotency, replay protection |
| WebSocket Security | ✅ Strong | Rate limiting, schema validation, origin checks |
| CORS | ✅ Strong | Allowlist, no wildcard, proper headers |
| XSS Prevention | ✅ Strong | HTML escaping in emails, React's built-in escaping |
| Prompt Injection | ✅ Good | Data delimiting, sanitization, system prompt hardening |
| Rate Limiting | ⚠️ Adequate | In-memory only (M2), most endpoints covered |
| Secrets Management | ✅ Strong | Secret Store pattern, env separation |

---

## Recommended Priority Actions

1. **L3** — Add group membership verification for game/hunt creation endpoints (low effort, meaningful access control improvement)
2. **M2** — Consider durable rate limiting for auth endpoints (medium effort, defense-in-depth)
3. **L1** — Add rate limiting to accept-invite endpoint (trivial)
