import { Env, getResendKey } from './env';
import { AUTH_CONSTANTS } from '@lamo-trivia/shared';
import type { User, Session, MagicCode, CreditTransaction } from '@lamo-trivia/shared';

// --- Magic Code ---

export async function sendMagicCode(email: string, env: Env): Promise<void> {
  const code = String(Math.floor(100000 + Math.random() * 900000));
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

  if (magicCode.code !== code) {
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

  const token = crypto.randomUUID();
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
