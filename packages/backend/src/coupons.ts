import type { Env } from './env';
import type { Coupon } from '@lamo-trivia/shared';
import { getResendKey } from './env';

/** KV key for a coupon */
function couponKey(code: string): string {
  return `coupon:${code.toUpperCase()}`;
}

/** Generate a random coupon code: LAMO-XXXX-XXXX */
export function generateCouponCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion
  let part1 = '';
  let part2 = '';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 4; i++) {
    part1 += chars[bytes[i] % chars.length];
    part2 += chars[bytes[i + 4] % chars.length];
  }
  return `LAMO-${part1}-${part2}`;
}

/** Validate coupon code format */
export function isValidCouponCode(code: string): boolean {
  return /^[A-Z0-9]{4,20}$/.test(code.toUpperCase().replace(/-/g, ''));
}

/** Create a new coupon */
export async function createCoupon(
  env: Env,
  opts: {
    code?: string;
    credits: number;
    maxUses: number;
    expiresAt: number | null;
    note: string;
    createdBy: string;
  },
): Promise<Coupon> {
  const code = opts.code?.toUpperCase() || generateCouponCode();

  // Check for collision
  const existing = await env.TRIVIA_KV.get(couponKey(code));
  if (existing) {
    throw new Error('Coupon code already exists');
  }

  const coupon: Coupon = {
    code,
    credits: opts.credits,
    maxUses: opts.maxUses,
    usedCount: 0,
    usedBy: [],
    expiresAt: opts.expiresAt,
    createdAt: Date.now(),
    createdBy: opts.createdBy,
    note: opts.note,
  };

  // Store with optional TTL based on expiry
  const kvOpts: { metadata: Record<string, unknown>; expirationTtl?: number } = {
    metadata: {
      code: coupon.code,
      credits: coupon.credits,
      maxUses: coupon.maxUses,
      usedCount: coupon.usedCount,
      note: coupon.note.slice(0, 100),
      createdAt: coupon.createdAt,
    },
  };

  if (opts.expiresAt) {
    const ttlSeconds = Math.floor((opts.expiresAt - Date.now()) / 1000);
    if (ttlSeconds > 60) {
      kvOpts.expirationTtl = ttlSeconds;
    }
  }

  await env.TRIVIA_KV.put(couponKey(code), JSON.stringify(coupon), kvOpts);

  return coupon;
}

/** Get a coupon by code */
export async function getCoupon(env: Env, code: string): Promise<Coupon | null> {
  const raw = await env.TRIVIA_KV.get(couponKey(code.toUpperCase()));
  if (!raw) return null;
  return JSON.parse(raw) as Coupon;
}

/** List all coupons */
export async function listCoupons(
  env: Env,
  cursor?: string,
  limit = 50,
): Promise<{ coupons: Coupon[]; cursor: string | null; complete: boolean }> {
  const listResult = await env.TRIVIA_KV.list({
    prefix: 'coupon:',
    limit,
    cursor,
  });

  const coupons: Coupon[] = [];
  for (const key of listResult.keys) {
    const raw = await env.TRIVIA_KV.get(key.name);
    if (raw) {
      try {
        coupons.push(JSON.parse(raw) as Coupon);
      } catch {
        // skip malformed
      }
    }
  }

  return {
    coupons,
    cursor: listResult.list_complete ? null : listResult.cursor,
    complete: listResult.list_complete,
  };
}

/** Redeem a coupon for a user. Returns credits granted or throws on error. */
export async function redeemCoupon(
  env: Env,
  code: string,
  userEmail: string,
): Promise<{ credits: number; coupon: Coupon }> {
  const normalized = code.toUpperCase().replace(/-/g, '');
  // Re-add dashes for lookup — try both raw and formatted
  const coupon = await getCoupon(env, code) ?? await getCoupon(env, normalized);

  if (!coupon) {
    throw new Error('Invalid coupon code');
  }

  // Check expiry
  if (coupon.expiresAt && Date.now() > coupon.expiresAt) {
    throw new Error('This coupon has expired');
  }

  // Check max uses
  if (coupon.usedCount >= coupon.maxUses) {
    throw new Error('This coupon has been fully redeemed');
  }

  // Check if user already used it
  if (coupon.usedBy.includes(userEmail.toLowerCase())) {
    throw new Error('You have already used this coupon');
  }

  // Redeem
  coupon.usedCount++;
  coupon.usedBy.push(userEmail.toLowerCase());

  // Update KV
  const kvOpts: { metadata: Record<string, unknown>; expirationTtl?: number } = {
    metadata: {
      code: coupon.code,
      credits: coupon.credits,
      maxUses: coupon.maxUses,
      usedCount: coupon.usedCount,
      note: coupon.note.slice(0, 100),
      createdAt: coupon.createdAt,
    },
  };

  if (coupon.expiresAt) {
    const ttlSeconds = Math.floor((coupon.expiresAt - Date.now()) / 1000);
    if (ttlSeconds > 60) {
      kvOpts.expirationTtl = ttlSeconds;
    }
  }

  await env.TRIVIA_KV.put(couponKey(coupon.code), JSON.stringify(coupon), kvOpts);

  return { credits: coupon.credits, coupon };
}

/** Delete a coupon */
export async function deleteCoupon(env: Env, code: string): Promise<boolean> {
  const coupon = await getCoupon(env, code);
  if (!coupon) return false;
  await env.TRIVIA_KV.delete(couponKey(coupon.code));
  return true;
}

/** Send a coupon email to a recipient */
export async function sendCouponEmail(
  env: Env,
  opts: {
    to: string;
    couponCode: string;
    credits: number;
    senderName: string;
    personalMessage?: string;
  },
): Promise<void> {
  const resendKey = await getResendKey(env);

  const messageHtml = opts.personalMessage
    ? `<p style="margin-bottom: 16px; color: #555;">"${opts.personalMessage.replace(/</g, '&lt;').replace(/>/g, '&gt;')}"</p>`
    : '';

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #1a1a2e;">You've received free credits!</h2>
      <p>${opts.senderName.replace(/</g, '&lt;').replace(/>/g, '&gt;')} sent you <strong>${opts.credits} free credits</strong> for LAMO Trivia.</p>
      ${messageHtml}
      <div style="background: #f8f9fa; border: 2px dashed #6c63ff; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
        <p style="color: #666; margin: 0 0 8px 0; font-size: 14px;">Your coupon code</p>
        <p style="font-size: 28px; font-weight: bold; color: #1a1a2e; letter-spacing: 2px; margin: 0;">${opts.couponCode}</p>
        <p style="color: #666; margin: 8px 0 0 0; font-size: 14px;">${opts.credits} credits</p>
      </div>
      <p style="font-size: 14px; color: #666;">
        To redeem: visit <a href="https://lamotrivia.app/credits" style="color: #6c63ff;">lamotrivia.app/credits</a>,
        sign in, and enter this code.
      </p>
      <p style="font-size: 12px; color: #999; margin-top: 24px;">
        LAMO Trivia — Free online trivia, puzzles, and scavenger hunts.
      </p>
    </div>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'LAMO Trivia <noreply@lamotrivia.app>',
      to: [opts.to],
      subject: `${opts.senderName} sent you free LAMO Trivia credits!`,
      html,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('Coupon email send error', text);
    throw new Error('Failed to send coupon email');
  }
}
