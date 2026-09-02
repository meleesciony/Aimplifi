/**
 * Password hashing for email/password sign-in (DECISIONS #43). Uses Node's
 * built-in scrypt — no native dependency, memory-hard, salted per password.
 * Format: `scrypt$<saltB64>$<keyB64>`. Verification is constant-time.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { passwordToStore } from '@/lib/auth/validate';

const KEY_LEN = 64;

export function hashPassword(plain: string): string {
  const stored = passwordToStore(plain);
  const salt = randomBytes(16);
  const key = scryptSync(stored, salt, KEY_LEN);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(plain: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1], 'base64');
    expected = Buffer.from(parts[2], 'base64');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;
  const actual = scryptSync(plain, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
