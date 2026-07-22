/**
 * Password-reset core (#257) — guarded, authz-free (the account-delete.ts
 * pattern: every invariant lives HERE so vitest drives the real logic against
 * the real Prisma client, and the thin action wrapper adds only rate limits,
 * request-derived inputs, and audit).
 *
 * Security invariants (each locked by password-reset-server.test.ts):
 *  - Only the sha256(salt:token) hash is ever stored; the plaintext exists in
 *    the emailed link and nowhere else.
 *  - The shared demo account can never mint or consume a reset token — fence in
 *    the core, by construction.
 *  - One active token per user: minting deletes prior UNUSED tokens (a stale
 *    email link dies the moment a newer one is requested; consumed tokens keep
 *    their row as the audit trail).
 *  - Single-use is enforced by an ATOMIC CLAIM inside the update transaction
 *    (updateMany where usedAt IS NULL), not by a read-then-write — the #256
 *    critic P1-1 lesson applied from the start: every input a destructive
 *    mutation judges is re-read/claimed inside the transaction that commits it.
 *  - A successful reset bumps sessionEpoch in the SAME transaction, revoking
 *    every existing session (Gap 6 §3 machinery) — a stolen session does not
 *    survive the password change it may have provoked.
 *  - Failure modes (unknown token, used, expired) collapse to ONE neutral
 *    user-facing message; the distinct internal states exist for tests/audit.
 */
import { randomBytes } from 'node:crypto';
import {
  RESET_TOKEN_BYTES,
  RESET_TOKEN_TTL_MS,
  hashResetToken,
  resetTokenFromBytes,
  resetTokenState,
} from '@/lib/engine/auth/reset';
import { hashPassword } from '@/lib/auth/password';
import { tokenSalt } from '@/lib/auth/token-salt';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, normalizeEmail } from '@/lib/auth/validate';
import { isDemoUser } from '@/lib/demo-user';
import { sendEmail } from '@/lib/email';
import { prisma } from '@/lib/db';

/** Salt for at-rest token hashing. The resolution order (env override → auth
 *  secret → public dev fallback, so the zero-credential demo still boots) is the
 *  shared `tokenSalt` idiom — see src/lib/auth/token-salt.ts. */
export function resetTokenSalt(): string {
  return tokenSalt('RESET_TOKEN_SALT', 'aimplifi-reset-dev-v1');
}

export const RESET_NEUTRAL_MESSAGE =
  'If an account exists for that email, we’ve sent a password-reset link. Check your inbox — the link works for 30 minutes.';

const RESET_FAILED_MESSAGE =
  'That reset link is invalid, already used, or expired. Request a new one below.';

/**
 * Mint a reset token for a user: plaintext OUT (for the email link — the action
 * must never return it to the browser), hash in the DB. Prior unused tokens are
 * invalidated in the same transaction (single-active policy). Demo-fenced.
 */
export async function mintResetToken(userId: string, now: Date): Promise<string | null> {
  if (isDemoUser(userId)) return null;
  const token = resetTokenFromBytes(randomBytes(RESET_TOKEN_BYTES));
  const tokenHash = hashResetToken(token, resetTokenSalt());
  const expiresAt = new Date(now.getTime() + RESET_TOKEN_TTL_MS);
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId, usedAt: null } }),
    prisma.passwordResetToken.create({ data: { userId, tokenHash, expiresAt } }),
  ]);
  return token;
}

export interface RequestResetResult {
  /** Always true from the caller's perspective — the response is enumeration-neutral. */
  ok: true;
  /** Internal disposition, for the action's audit log ONLY (never the client):
   *  'sent' | 'send-failed' | 'no-account' | 'demo' | 'no-origin'. */
  disposition: 'sent' | 'send-failed' | 'no-account' | 'demo' | 'no-origin';
  /** The user the request resolved to, when it did (for audit attribution). */
  userId?: string;
}

/**
 * The forgot-password request: resolve the email, mint + send when it names a
 * real (non-demo) account, and report the SAME outward result regardless — the
 * caller's message must not vary with account existence (no enumeration leak).
 * `baseUrl` is the absolute origin for the link, derived (fail-closed) by the
 * action; null = no trustworthy origin, so NO email is sent (a poisoned link is
 * worse than none — the neutral outward response is unchanged, the disposition
 * tells the operator via the audit log).
 */
export async function requestPasswordResetCore(
  emailRaw: string,
  now: Date,
  baseUrl: string | null,
): Promise<RequestResetResult> {
  const email = normalizeEmail(emailRaw);
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return { ok: true, disposition: 'no-account' };
  if (baseUrl === null) return { ok: true, disposition: 'no-origin', userId: user.id };
  const token = await mintResetToken(user.id, now);
  if (token === null) return { ok: true, disposition: 'demo' };
  const link = `${baseUrl.replace(/\/$/, '')}/reset-password?token=${token}`;
  const sent = await sendEmail({
    to: email,
    subject: 'Reset your Aimplifi password',
    text: [
      'Someone (hopefully you) asked to reset the password for this Aimplifi account.',
      '',
      `Reset it here (link works for 30 minutes, one use):`,
      link,
      '',
      'If you didn’t ask for this, you can ignore this email — your password is unchanged',
      'and the link expires on its own.',
    ].join('\n'),
  });
  return { ok: true, disposition: sent.sent ? 'sent' : 'send-failed', userId: user.id };
}

export interface PerformResetResult {
  ok: boolean;
  /** User-facing message on failure (already neutral — one string for every token fault). */
  error?: string;
  /** Internal state for tests/audit: 'reset' | 'bad-token' | 'used' | 'expired' | 'weak-password' | 'demo'. */
  state: 'reset' | 'bad-token' | 'used' | 'expired' | 'weak-password' | 'demo';
  userId?: string;
}

/** Consume a reset token and set the new password. See module docstring for invariants. */
export async function performPasswordReset(
  tokenPlain: string,
  newPassword: string,
  now: Date,
): Promise<PerformResetResult> {
  if (newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > MAX_PASSWORD_LENGTH) {
    return {
      ok: false,
      state: 'weak-password',
      error: `Password must be ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} characters.`,
    };
  }
  if (!tokenPlain) return { ok: false, state: 'bad-token', error: RESET_FAILED_MESSAGE };

  // Lookup is BY the at-rest hash (unique) — the hash function itself is the
  // comparison, so there is no orderable partial-match oracle to time.
  const tokenHash = hashResetToken(tokenPlain, resetTokenSalt());
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, usedAt: true, expiresAt: true },
  });
  if (!row) return { ok: false, state: 'bad-token', error: RESET_FAILED_MESSAGE };
  if (isDemoUser(row.userId)) return { ok: false, state: 'demo', error: RESET_FAILED_MESSAGE };

  const state = resetTokenState(row, now);
  if (state !== 'live') return { ok: false, state, error: RESET_FAILED_MESSAGE };

  // ATOMIC CLAIM + password write + all-session revoke, one transaction. The
  // claim (updateMany where usedAt IS NULL) is the single-use gate: two racing
  // confirms can both pass the read above, but exactly one claims the row.
  const claimed = await prisma.$transaction(async (tx) => {
    const claim = await tx.passwordResetToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claim.count !== 1) return false;
    await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash: hashPassword(newPassword), sessionEpoch: { increment: 1 } },
    });
    return true;
  });
  if (!claimed) return { ok: false, state: 'used', error: RESET_FAILED_MESSAGE };
  return { ok: true, state: 'reset', userId: row.userId };
}
