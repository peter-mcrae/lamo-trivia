import { Env, getResendKey } from './env';
import { AUTH_CONSTANTS } from '@lamo-trivia/shared';
import type { User, Session, MagicCode, CreditTransaction } from '@lamo-trivia/shared';

/** Normalize email for consistent KV keys */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Generate a cryptographically secure 6-digit code */
function generateSecureCode(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(100000 + (array[0] % 900000));
}

/** Generate a 256-bit cryptographically secure token */
function generateSecureToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison to prevent timing attacks */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);
  if (aBuf.byteLength !== bBuf.byteLength) return false;

  // Workers runtime has crypto.subtle.timingSafeEqual
  if (typeof crypto.subtle.timingSafeEqual === 'function') {
    return crypto.subtle.timingSafeEqual(aBuf, bBuf);
  }

  // Fallback: constant-time comparison via HMAC (works in Node.js test env).
  // The key is random per call so the digests an attacker would need to
  // precompute are never the same twice.
  const keyBytes = new Uint8Array(32);
  crypto.getRandomValues(keyBytes);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const [macA, macB] = await Promise.all([
    crypto.subtle.sign('HMAC', key, aBuf),
    crypto.subtle.sign('HMAC', key, bBuf),
  ]);
  const viewA = new Uint8Array(macA);
  const viewB = new Uint8Array(macB);
  let result = 0;
  for (let i = 0; i < viewA.length; i++) {
    result |= viewA[i] ^ viewB[i];
  }
  return result === 0;
}

// --- KV mutual exclusion ---

/**
 * Cloudflare KV enforces a 60s floor on expirationTtl, so that is also the
 * shortest a lock can be held by an isolate that dies without releasing it.
 */
const LOCK_TTL_SECONDS = 60;

/** Thrown when another caller already holds the lock for a key. */
export class KvLockBusyError extends Error {
  readonly key: string;

  constructor(key: string) {
    super('Another operation is already in progress. Please try again.');
    this.name = 'KvLockBusyError';
    this.key = key;
  }
}

/**
 * Best-effort mutual exclusion over a KV key.
 *
 * KV has no compare-and-set, so the plain get-then-put lock used for
 * `credit-lock:{huntId}` in hunt-room.ts can still admit two holders that both
 * read "unlocked" before either writes. We narrow that window by writing a
 * per-caller nonce and then reading the key back: concurrent writers converge
 * on a single surviving value, so normally only one caller sees its own nonce
 * and proceeds.
 *
 * This is a mitigation, not a guarantee — KV is eventually consistent, so a
 * read-back can still be served a stale value. Every caller must therefore
 * also make a *duplicated* critical section harmless; see the idempotency key
 * in `adjustUserCredits`.
 */
export async function withKvLock<T>(
  env: Env,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const nonce = crypto.randomUUID();

  // Fast path: somebody clearly holds it already. Nothing of ours is in KV
  // yet, so there is nothing to release on the way out.
  if (await env.TRIVIA_KV.get(key)) {
    throw new KvLockBusyError(key);
  }

  await env.TRIVIA_KV.put(key, nonce, { expirationTtl: LOCK_TTL_SECONDS });

  // Our nonce is in KV from here, so every exit has to run the release below.
  // Losing arbitration used to throw *before* the `try`: two callers that
  // overwrote each other could both read back a value that wasn't theirs, both
  // bail, and neither release — leaving the key sitting unowned for its full
  // 60s TTL. On `credit-lock:user:{email}` that is a minute in which the user
  // can't redeem, start a hunt, or be credited for a purchase; on
  // `magic-lock:{email}` anyone who knows the address can induce it and block
  // that user's login.
  try {
    // Arbitration: if a racer's nonce is what survived, the lock is theirs.
    if ((await env.TRIVIA_KV.get(key)) !== nonce) {
      throw new KvLockBusyError(key);
    }
    return await fn();
  } finally {
    // Only release a lock we still own — if ours expired and a successor took
    // it, deleting here would hand a third caller the lock as well. A stale
    // read here can still skip a release we were entitled to make; KV has no
    // compare-and-set, so the TTL stays the backstop.
    if ((await env.TRIVIA_KV.get(key)) === nonce) {
      await env.TRIVIA_KV.delete(key);
    }
  }
}

// --- Magic Code ---

export async function sendMagicCode(email: string, env: Env): Promise<void> {
  email = normalizeEmail(email);
  const code = generateSecureCode();
  const magicCode: MagicCode = {
    code,
    expiresAt: Date.now() + AUTH_CONSTANTS.magicCodeTTL * 1000,
    attempts: 0,
  };

  await env.TRIVIA_KV.put(`magic:${email}`, JSON.stringify(magicCode), {
    expirationTtl: AUTH_CONSTANTS.magicCodeTTL,
  });

  const resendKey = await getResendKey(env);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'LAMO Trivia <noreply@lamotrivia.app>',
      to: [email],
      subject: 'Your login code',
      html: `<p>Your login code is: <strong>${code}</strong></p><p>This code expires in 10 minutes.</p>`,
    }),
  });

  if (!res.ok) {
    console.error('Resend error', await res.text());
    throw new Error('Failed to send email');
  }
}

export async function verifyMagicCode(
  email: string,
  code: string,
  env: Env,
): Promise<boolean> {
  email = normalizeEmail(email);
  const key = `magic:${email}`;

  try {
    return await withKvLock(env, `magic-lock:${email}`, async () => {
      const raw = await env.TRIVIA_KV.get(key);
      if (!raw) return false;

      const magicCode = JSON.parse(raw) as MagicCode;

      if (Date.now() > magicCode.expiresAt) {
        await env.TRIVIA_KV.delete(key);
        return false;
      }

      if (magicCode.attempts >= AUTH_CONSTANTS.maxCodeAttempts) {
        await env.TRIVIA_KV.delete(key);
        return false;
      }

      // Spend the attempt BEFORE comparing. Incrementing only on a mismatch
      // (the previous order) meant an abandoned or crashed request never
      // counted against the cap, and a burst of parallel guesses all read the
      // same stale count and were all admitted.
      magicCode.attempts++;
      await env.TRIVIA_KV.put(key, JSON.stringify(magicCode), {
        expirationTtl: AUTH_CONSTANTS.magicCodeTTL,
      });

      if (!(await timingSafeEqual(magicCode.code, code))) {
        return false;
      }

      // Success — delete the code
      await env.TRIVIA_KV.delete(key);
      return true;
    });
  } catch (err) {
    if (err instanceof KvLockBusyError) {
      // Another verification for this email is already in flight. Refusing is
      // the safe answer: parallel verifications of one code are the exact
      // shape of a brute-force burst trying to outrun the attempt counter.
      return false;
    }
    throw err;
  }
}

// --- Session & User ---

export async function createSession(
  email: string,
  env: Env,
): Promise<{ token: string; user: User }> {
  email = normalizeEmail(email);

  // Get or create user
  let user = await getUser(email, env);
  if (!user) {
    user = {
      userId: crypto.randomUUID(),
      email,
      credits: 0,
      createdAt: Date.now(),
    };
    await env.TRIVIA_KV.put(`user:${email}`, JSON.stringify(user));
  }

  const token = generateSecureToken();
  const session: Session = {
    userId: user.userId,
    email,
    expiresAt: Date.now() + AUTH_CONSTANTS.sessionTTL * 1000,
  };

  await env.TRIVIA_KV.put(`session:${token}`, JSON.stringify(session), {
    expirationTtl: AUTH_CONSTANTS.sessionTTL,
  });

  return { token, user };
}

export async function getSessionUser(
  request: Request,
  env: Env,
): Promise<User | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  const raw = await env.TRIVIA_KV.get(`session:${token}`);
  if (!raw) return null;

  const session = JSON.parse(raw) as Session;
  if (Date.now() > session.expiresAt) {
    await env.TRIVIA_KV.delete(`session:${token}`);
    return null;
  }

  return getUser(session.email, env);
}

export async function deleteSession(
  request: Request,
  env: Env,
): Promise<void> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return;
  const token = authHeader.slice(7);
  await env.TRIVIA_KV.delete(`session:${token}`);
}

// --- User helpers ---

export async function getUser(email: string, env: Env): Promise<User | null> {
  email = normalizeEmail(email);
  const raw = await env.TRIVIA_KV.get(`user:${email}`);
  if (!raw) return null;
  return JSON.parse(raw) as User;
}

export async function updateUser(user: User, env: Env): Promise<void> {
  await env.TRIVIA_KV.put(`user:${user.email}`, JSON.stringify(user));
}

// --- Credit mutations ---

/**
 * How long a "this grant was already applied" marker is kept. The durable
 * record of a redemption lives elsewhere (a coupon's `usedBy`, an invite's
 * `acceptedAt`); this marker only has to outlive the race window, which is
 * milliseconds, by a wide margin.
 */
const CREDIT_IDEMPOTENCY_TTL = 90 * 24 * 60 * 60; // 90 days

/** Thrown when a debit would take a balance below zero. */
export class InsufficientCreditsError extends Error {
  readonly email: string;
  readonly balance: number;
  readonly delta: number;

  constructor(email: string, balance: number, delta: number) {
    super(`Insufficient credits: a balance of ${balance} cannot absorb ${delta}`);
    this.name = 'InsufficientCreditsError';
    this.email = email;
    this.balance = balance;
    this.delta = delta;
  }
}

export interface CreditAdjustment {
  user: User;
  /** True when this call created the user record. */
  isNewUser: boolean;
  /** False when the idempotency key showed the grant had already been applied. */
  applied: boolean;
}

/**
 * Apply a credit delta to a user once, and only once.
 *
 * Callers used to do `user.credits += n; await updateUser(user)` against a
 * `User` they had fetched earlier in the request — a lost update as soon as
 * two grants overlapped. Two things fix that here, because KV gives us
 * neither on its own:
 *
 *  - a per-user lock serialises the read-modify-write of `user:{email}`, and
 *    the balance is re-read *inside* it rather than trusted from the caller;
 *  - `idempotencyKey` records that this specific grant landed, so a duplicate
 *    that slips past the lock (KV locks are best-effort — see `withKvLock`)
 *    is a no-op instead of double credit.
 *
 * The contract callers can rely on:
 *
 *  - **All or nothing.** If this throws, the balance did not move, and the
 *    marker has been rolled back so a retry is safe. Once `updateUser` has
 *    returned, the grant is committed and the marker stays put *whatever*
 *    happens next — including a failed ledger append, which is logged and
 *    swallowed. A missing ledger row can be reconstructed; a double grant
 *    can't, and rolling the marker back after the balance had already landed
 *    is exactly how one caller's retry (Stripe's, say) turned one payment
 *    into two grants.
 *  - **`applied: true` means the whole delta moved.** A debit larger than the
 *    balance is refused with `InsufficientCreditsError` rather than floored at
 *    zero: a partial application reported as success left the ledger — which
 *    records the requested amount — permanently out of step with the balance.
 *    The caller decides what a refusal means; it is the only one that knows.
 *  - The marker is written before the balance changes, so a crash in between
 *    loses a grant. That is the safe direction for money.
 */
export async function adjustUserCredits(
  env: Env,
  email: string,
  delta: number,
  opts: {
    /** Stable per-grant identifier, e.g. `coupon:LAMO-AAAA-BBBB:{userId}`. */
    idempotencyKey: string;
    /** Recorded inside the lock, so the ledger can't fork from the balance. */
    transaction?: CreditTransaction;
    /** Create the user if they don't exist yet (invite acceptance). */
    createIfMissing?: boolean;
  },
): Promise<CreditAdjustment> {
  email = normalizeEmail(email);
  const appliedKey = `credit-applied:${opts.idempotencyKey}`;

  return withKvLock(env, `credit-lock:user:${email}`, async () => {
    const alreadyApplied = await env.TRIVIA_KV.get(appliedKey);
    if (alreadyApplied) {
      const current = await getUser(email, env);
      if (!current) throw new Error('User not found');
      return { user: current, isNewUser: false, applied: false };
    }

    const existing = await getUser(email, env);
    if (!existing && !opts.createIfMissing) {
      throw new Error('User not found');
    }

    const isNewUser = !existing;
    const user: User = existing ?? {
      userId: crypto.randomUUID(),
      email,
      credits: 0,
      createdAt: Date.now(),
    };

    // Refuse an overdraw before anything is written: clamping it to zero
    // applied part of the delta and still reported `applied: true`, while the
    // ledger recorded the amount that was asked for. Nothing has landed yet,
    // so there is nothing to roll back.
    const nextBalance = user.credits + delta;
    if (nextBalance < 0) {
      throw new InsufficientCreditsError(email, user.credits, delta);
    }

    await env.TRIVIA_KV.put(
      appliedKey,
      JSON.stringify({ email, delta, appliedAt: Date.now() }),
      { expirationTtl: CREDIT_IDEMPOTENCY_TTL },
    );

    user.credits = nextBalance;
    try {
      await updateUser(user, env);
    } catch (err) {
      // Still uncommitted — a throwing put is the only "it didn't land" signal
      // KV gives us — so drop the marker and let the caller retry.
      await env.TRIVIA_KV.delete(appliedKey);
      throw err;
    }

    // The balance is committed. Past this point the marker MUST survive: it is
    // the only thing standing between a caller's retry and a second grant.
    if (opts.transaction) {
      try {
        await addCreditTransaction(user.userId, opts.transaction, env);
      } catch (err) {
        // `transactions:{userId}` is a hot single key, so tripping KV's ~1
        // write/sec/key limit here is ordinary. The balance is the source of
        // truth and it already moved; losing the ledger row is recoverable,
        // re-opening the grant is not.
        console.error('Credit ledger append failed after balance committed', {
          email,
          delta,
          idempotencyKey: opts.idempotencyKey,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { user, isNewUser, applied: true };
  });
}

// --- Credit transactions ---

export async function addCreditTransaction(
  userId: string,
  transaction: CreditTransaction,
  env: Env,
): Promise<void> {
  const raw = await env.TRIVIA_KV.get(`transactions:${userId}`);
  let transactions: CreditTransaction[] = raw ? JSON.parse(raw) : [];

  // Prepend new transaction, cap at 100
  transactions = [transaction, ...transactions].slice(0, 100);

  await env.TRIVIA_KV.put(`transactions:${userId}`, JSON.stringify(transactions));
}

export async function getCreditTransactions(
  userId: string,
  env: Env,
): Promise<CreditTransaction[]> {
  const raw = await env.TRIVIA_KV.get(`transactions:${userId}`);
  return raw ? JSON.parse(raw) : [];
}

// Exported for use in router.ts
export { timingSafeEqual };
