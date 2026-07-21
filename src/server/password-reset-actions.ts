'use server';

/**
 * Forgot-password server actions (#257) — thin wrappers over the guarded core
 * (src/server/password-reset.ts), adding exactly three things: durable rate
 * limits, the request-derived absolute origin for the emailed link, and audit
 * rows. Every security invariant lives in the core.
 *
 * Enumeration stance: the request action returns the SAME neutral message for
 * every non-throttled outcome (account or not, email sent or provider-dormant).
 * The throttle messages key on the SUBMITTED email/device, not on account
 * existence, so they leak nothing either.
 */
import { headers } from 'next/headers';
import {
  RESET_NEUTRAL_MESSAGE,
  performPasswordReset,
  requestPasswordResetCore,
} from '@/server/password-reset';
import { isValidEmail, normalizeEmail } from '@/lib/auth/validate';
import { rateLimitDurable } from '@/server/authz';
import { clientIp } from '@/lib/request-ip';
import { prisma } from '@/lib/db';

/** Request throttles: tighter than sign-in — each hit can send an email. */
const RESET_REQ_IP_LIMIT = 5; // requests per device / window
const RESET_REQ_EMAIL_LIMIT = 3; // requests per target email / window
const RESET_REQ_WINDOW_MS = 15 * 60_000;
/** Confirm throttle: defense in depth only (the 2^256 token is the boundary). */
const RESET_CONFIRM_IP_LIMIT = 10;
const RESET_CONFIRM_WINDOW_MS = 15 * 60_000;
/** Minimum request-action response time — the timing-oracle floor (critic P2-1). */
const RESET_RESPONSE_FLOOR_MS = 750;

export interface ResetRequestState {
  message?: string;
  error?: string;
}

/**
 * Absolute origin for the emailed link, FAIL-CLOSED against reset-link
 * poisoning (#257 critic P2-2, CWE-640): a reset token rides a raw email href
 * with no downstream validation, so a spoofable Host header would hand an
 * attacker a victim's live token. Header-derived origins are therefore trusted
 * only where the platform owns the header (Vercel) or the host is local dev;
 * any other deploy must pin AUTH_URL — with none, we return null and the core
 * skips the email (outwardly identical neutral response; disposition audited).
 */
async function requestOrigin(): Promise<string | null> {
  const pinned = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  if (pinned) return pinned.replace(/\/$/, '');
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  if (!host) return null;
  const platformOwned = Boolean(process.env.VERCEL); // Vercel overwrites X-Forwarded-Host
  const localDev = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  return platformOwned || localDev ? `${proto}://${host}` : null;
}

export async function requestPasswordReset(
  _prev: ResetRequestState | null,
  formData: FormData,
): Promise<ResetRequestState> {
  const email = normalizeEmail(String(formData.get('email') ?? ''));
  if (!isValidEmail(email)) return { error: 'Enter a valid email address.' };

  // Per-device cap first (fails CLOSED on a limiter error), then per-target-email —
  // both keyed on submitted values, so neither existence-leaks.
  const ip = await clientIp();
  if (!(await rateLimitDurable(`reset-ip:${ip}`, RESET_REQ_IP_LIMIT, RESET_REQ_WINDOW_MS))) {
    return { error: 'Too many reset requests from this device. Please wait a few minutes.' };
  }
  if (!(await rateLimitDurable(`reset-email:${email}`, RESET_REQ_EMAIL_LIMIT, RESET_REQ_WINDOW_MS))) {
    return { error: 'Too many reset requests for that email. Please wait a few minutes and check your inbox.' };
  }

  // Timing-oracle floor (#257 critic P2-1): the known-email path does a mint
  // transaction + an email send; the unknown path is one indexed read (~3×
  // faster, measured — and far wider once Resend is live). Message and shape
  // are already identical; pad the fast path so elapsed time converges too.
  // Residual (recorded): an email send slower than the floor still leaks.
  const startedAt = Date.now();
  const res = await requestPasswordResetCore(email, new Date(), await requestOrigin());
  const elapsed = Date.now() - startedAt;
  if (elapsed < RESET_RESPONSE_FLOOR_MS) {
    await new Promise((r) => setTimeout(r, RESET_RESPONSE_FLOOR_MS - elapsed));
  }
  // Audit only when the request resolved to a real account (no row exists to
  // attribute otherwise, and inventing one would itself store the probed email).
  // Residual (critic re-verify, P3): this INSERT runs after the floor and only on
  // the known path — a ~1-5ms delta against the 750ms floor, swamped by jitter.
  if (res.userId) {
    try {
      await prisma.auditLog.create({
        data: {
          userId: res.userId,
          action: 'auth.reset.request',
          meta: JSON.stringify({ disposition: res.disposition }),
        },
      });
    } catch {}
  }
  return { message: RESET_NEUTRAL_MESSAGE };
}

export interface ResetConfirmState {
  success?: boolean;
  error?: string;
}

export async function confirmPasswordReset(
  _prev: ResetConfirmState | null,
  formData: FormData,
): Promise<ResetConfirmState> {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');

  const ip = await clientIp();
  if (!(await rateLimitDurable(`reset-confirm-ip:${ip}`, RESET_CONFIRM_IP_LIMIT, RESET_CONFIRM_WINDOW_MS))) {
    return { error: 'Too many attempts from this device. Please wait a few minutes.' };
  }

  const res = await performPasswordReset(token, password, new Date());
  if (!res.ok) return { error: res.error };
  try {
    await prisma.auditLog.create({
      data: { userId: res.userId!, action: 'auth.reset.complete', meta: '{}' },
    });
  } catch {}
  return { success: true };
}
