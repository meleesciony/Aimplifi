import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time Bearer check for the cron routes (/api/cron/*). Rejects when the
 * secret is unset or the Authorization header doesn't match. Uses timingSafeEqual
 * (as the password path does) so the comparison can't leak the secret through
 * response timing. Shared by every cron route so they can't drift.
 */
export function checkCronBearer(authHeader: string | null, secret: string | undefined): boolean {
  if (!secret || !authHeader) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(authHeader);
  // timingSafeEqual throws on length mismatch — guard first (the length itself is
  // not secret), then compare the bytes in constant time.
  return expected.length === got.length && timingSafeEqual(expected, got);
}
