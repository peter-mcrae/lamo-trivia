import type { Env } from './env';
import { getResendKey } from './env';

export interface Invite {
  token: string;
  email: string;
  credits: number;
  invitedBy: string;
  createdAt: number;
  acceptedAt?: number;
}

const INVITE_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

/** Generate a cryptographically secure invite token */
function generateInviteToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** KV key for an invite */
function inviteKey(token: string): string {
  return `invite:${token}`;
}

/** Create an invite and store it in KV */
export async function createInvite(
  env: Env,
  email: string,
  invitedBy: string,
  credits = 1000,
): Promise<Invite> {
  const token = generateInviteToken();
  const invite: Invite = {
    token,
    email: email.trim().toLowerCase(),
    credits,
    invitedBy,
    createdAt: Date.now(),
  };

  await env.TRIVIA_KV.put(inviteKey(token), JSON.stringify(invite), {
    expirationTtl: INVITE_TTL,
  });

  return invite;
}

/** Get an invite by token */
export async function getInvite(env: Env, token: string): Promise<Invite | null> {
  const raw = await env.TRIVIA_KV.get(inviteKey(token));
  if (!raw) return null;
  return JSON.parse(raw) as Invite;
}

/** Mark an invite as accepted */
export async function markInviteAccepted(env: Env, invite: Invite): Promise<void> {
  invite.acceptedAt = Date.now();
  // Keep it around briefly so we can detect re-use, then let it expire
  await env.TRIVIA_KV.put(inviteKey(invite.token), JSON.stringify(invite), {
    expirationTtl: 24 * 60 * 60, // keep for 1 more day
  });
}

/** Send an invite email */
export async function sendInviteEmail(
  env: Env,
  opts: {
    to: string;
    inviteToken: string;
    credits: number;
    senderName: string;
  },
): Promise<void> {
  const resendKey = await getResendKey(env);
  const frontendUrl = env.FRONTEND_URL || 'https://lamotrivia.app';
  const inviteUrl = `${frontendUrl}/invite/${opts.inviteToken}`;

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #1a1a2e;">You're invited to LAMO Trivia!</h2>
      <p>${opts.senderName.replace(/</g, '&lt;').replace(/>/g, '&gt;')} has invited you to join LAMO Trivia and gifted you <strong>${opts.credits} free credits</strong> to get started.</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${inviteUrl}" style="background: #6c63ff; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
          Accept Invite &amp; Get ${opts.credits} Credits
        </a>
      </div>
      <p style="font-size: 14px; color: #666;">
        Click the button above to create your account and receive your free credits.
        This invite expires in 7 days.
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
      subject: `${opts.senderName} invited you to LAMO Trivia!`,
      html,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('Invite email send error', text);
    throw new Error('Failed to send invite email');
  }
}
