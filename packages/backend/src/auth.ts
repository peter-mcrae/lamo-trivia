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

  // Fallback: constant-time comparison via HMAC (works in Node.js test env)
  const key = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(32),
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
      from: 'LAMO Trivia <noreply@lamotrivia.com>',
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
  const raw = await env.TRIVIA_KV.get(`magic:${email}`);
  if (!raw) return false;

  const magicCode = JSON.parse(raw) as MagicCode;

  if (Date.now() > magicCode.expiresAt) {
    await env.TRIVIA_KV.delete(`magic:${email}`);
    return false;
  }

  if (magicCode.attempts >= AUTH_CONSTANTS.maxCodeAttempts) {
    await env.TRIVIA_KV.delete(`magic:${email}`);
    return false;
  }

  const match = await timingSafeEqual(magicCode.code, code);
  if (!match) {
    magicCode.attempts++;
    await env.TRIVIA_KV.put(`magic:${email}`, JSON.stringify(magicCode), {
      expirationTtl: AUTH_CONSTANTS.magicCodeTTL,
    });
    return false;
  }

  // Success — delete the code
  await env.TRIVIA_KV.delete(`magic:${email}`);
  return true;
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
