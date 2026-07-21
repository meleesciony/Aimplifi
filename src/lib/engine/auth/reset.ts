/**
 * Password-reset token engine (#257) — the pure half of the forgot-password
 * flow. Mirrors the household-invite idiom (membership.ts): randomness stays at
 * the caller, tokens are hashed at rest (sha256(salt:token)), comparison is
 * constant-time, and expiry is LAZY — state is derived from the stored row by a
 * pure predicate, never rewritten.
 *
 * Unlike an invite code (human-typed, short alphabet), a reset token rides a
 * URL: it is a full-entropy 32-byte secret rendered base64url — never truncated,
 * never case-normalized. 2^256 keyspace makes online guessing moot; the rate
 * limit on the confirm action is defense in depth, not the security boundary.
 *
 * No I/O, no Date.now() — `now` is always injected.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

/** Reset links live 30 minutes — long enough for a slow mailbox, short enough
 *  that a forgotten email in an abandoned inbox goes stale the same sitting. */
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

/** Bytes of entropy per token (base64url-rendered → 43 chars). */
export const RESET_TOKEN_BYTES = 32;

/**
 * Deterministically render token bytes as base64url (URL-safe, no padding).
 * Randomness stays at the caller (crypto.randomBytes); this stays pure.
 */
export function resetTokenFromBytes(bytes: Uint8Array): string {
  if (bytes.length < RESET_TOKEN_BYTES) {
    throw new Error(`resetTokenFromBytes needs at least ${RESET_TOKEN_BYTES} bytes`);
  }
  return Buffer.from(bytes.subarray(0, RESET_TOKEN_BYTES)).toString('base64url');
}

/** One-way at-rest hash of a reset token (hashInviteCode idiom — sha256(salt:token)).
 *  The token is used verbatim: no trimming/case-folding, a URL secret is exact bytes. */
export function hashResetToken(token: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${token}`).digest('hex');
}

/** Constant-time comparison of a candidate token against a stored hash. */
export function resetTokenMatches(candidate: string, tokenHash: string, salt: string): boolean {
  const a = Buffer.from(hashResetToken(candidate, salt), 'hex');
  const b = Buffer.from(tokenHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export type ResetTokenState = 'live' | 'used' | 'expired';

/**
 * Lazy state derivation (inviteEffectiveStatus idiom): `used` is terminal and
 * beats `expired` (a consumed token must never read as merely stale — the
 * distinction matters for the audit trail, though the user-facing error is one
 * neutral message either way). Boundary matches invites: at exactly `expiresAt`
 * the token is still live (expired means expiresAt < now).
 */
export function resetTokenState(
  row: { usedAt: Date | null; expiresAt: Date },
  now: Date,
): ResetTokenState {
  if (row.usedAt !== null) return 'used';
  if (row.expiresAt.getTime() < now.getTime()) return 'expired';
  return 'live';
}
