import type { Env } from './env';
import type { Coupon } from '@lamo-trivia/shared';
import { getResendKey } from './env';
import { withKvLock } from './auth';

/**
 * How long a per-user claim record is kept. The coupon's own `usedBy` list is
 * the durable record of who redeemed it; this key exists only as a second,
 * per-user barrier against a concurrent double redemption.
 */
const COUPON_CLAIM_TTL = 90 * 24 * 60 * 60; // 90 days

/** KV key for a coupon */
function couponKey(code: string): string {
  return `coupon:${code.toUpperCase()}`;
}

/**
 * KV key recording that one user has claimed one coupon. `createdAt` is part
 * of the key so deleting a code and re-issuing it doesn't inherit the old
 * coupon's claims.
 */
function couponClaimKey(coupon: Coupon, email: string): string {
  return `coupon-claim:${coupon.code.toUpperCase()}:${coupon.createdAt}:${email.toLowerCase()}`;
}

/**
 * KV put options for a coupon record. The metadata mirrors the record, so it
 * has to be rebuilt from whatever version is being written — including the
 * pre-redemption one a rollback restores.
 */
function couponKvOptions(coupon: Coupon): {
  metadata: Record<string, unknown>;
  expirationTtl?: number;
} {
  const opts: { metadata: Record<string, unknown>; expirationTtl?: number } = {
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
      opts.expirationTtl = ttlSeconds;
    }
  }

  return opts;
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
  await env.TRIVIA_KV.put(couponKey(code), JSON.stringify(coupon), couponKvOptions(coupon));

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

/**
 * Redeem a coupon for a user. Returns credits granted or throws on error.
 *
 * Redemption used to be a bare read-check-write: N concurrent requests for the
 * same code all read `usedCount` before any of them wrote it back, so all N
 * passed both the max-uses and the already-used check. It is now serialised on
 * a per-coupon lock, re-validated inside that lock, and backed by a per-user
 * claim key so a duplicate that outruns the lock still can't redeem twice.
 *
 * `grant` (when supplied) runs inside the lock, *after* the coupon has been
 * written back as consumed. That ordering decides what an isolate that dies
 * mid-redemption leaves behind: a burnt use, which an admin can re-issue,
 * rather than a fully-paid-out coupon that is still redeemable by the next
 * person. A *clean* failure is different — `grant` is all-or-nothing (see
 * `adjustUserCredits`), so a throw means no credits moved and the use is put
 * back.
 */
export async function redeemCoupon(
  env: Env,
  code: string,
  userEmail: string,
  grant?: (coupon: Coupon) => Promise<void>,
): Promise<{ credits: number; coupon: Coupon }> {
  const email = userEmail.toLowerCase();
  const normalized = code.toUpperCase().replace(/-/g, '');
  // Re-add dashes for lookup — try both raw and formatted
  const found = await getCoupon(env, code) ?? await getCoupon(env, normalized);

  if (!found) {
    throw new Error('Invalid coupon code');
  }

  return withKvLock(env, `coupon-lock:${found.code}`, async () => {
    // Re-read inside the lock — `found` was fetched before we held it, so its
    // usedCount may already be stale.
    const coupon = await getCoupon(env, found.code);
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

    // Check if user already used it — the claim key catches a redemption that
    // was granted but whose coupon write never landed.
    const claimKey = couponClaimKey(coupon, email);
    if (coupon.usedBy.includes(email) || (await env.TRIVIA_KV.get(claimKey))) {
      throw new Error('You have already used this coupon');
    }

    // Redeem. `coupon` is left untouched so it can be written back verbatim if
    // the redemption has to be undone.
    const consumed: Coupon = {
      ...coupon,
      usedCount: coupon.usedCount + 1,
      usedBy: [...coupon.usedBy, email],
    };

    await env.TRIVIA_KV.put(
      claimKey,
      JSON.stringify({ code: coupon.code, email, credits: coupon.credits, claimedAt: Date.now() }),
      { expirationTtl: COUPON_CLAIM_TTL },
    );

    // Consume first, then grant. Each step is undone only if it actually
    // happened: the old rollback deleted the claim key for *any* failure under
    // the comment "Nothing was consumed", including one raised after the
    // credits had already been handed out — which dropped the user's barrier
    // and left the coupon unconsumed, i.e. payable again.
    let consumedWritten = false;
    try {
      await env.TRIVIA_KV.put(
        couponKey(consumed.code),
        JSON.stringify(consumed),
        couponKvOptions(consumed),
      );
      consumedWritten = true;

      if (grant) await grant(consumed);
    } catch (err) {
      // A throw from `grant` means the credits did not move, so the use goes
      // back and the claim is dropped for a retry.
      try {
        if (consumedWritten) {
          await env.TRIVIA_KV.put(
            couponKey(coupon.code),
            JSON.stringify(coupon),
            couponKvOptions(coupon),
          );
        }
        await env.TRIVIA_KV.delete(claimKey);
      } catch (rollbackErr) {
        // Undoing failed as well, so the use stays consumed and the claim
        // stands together with it — the safe residue. Surface the original
        // failure, not this one.
        console.error('Coupon rollback failed; redemption left consumed', {
          code: coupon.code,
          email,
          error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
        });
      }
      throw err;
    }

    return { credits: consumed.credits, coupon: consumed };
  });
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
        <p style="font-size: 28px; font-weight: bold; color: #1a1a2e; letter-spacing: 2px; margin: 0;">${opts.couponCode.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
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
