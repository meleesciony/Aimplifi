/**
 * Invite-only signup allowlist (DECISIONS #57). Pure, env-driven, and DORMANT by
 * default so the zero-credential demo + the test suite keep working: when
 * `SIGNUP_ALLOWLIST` is unset/blank the list is empty and signup is OPEN (the
 * existing behavior). Set it in production (e.g. on Vercel) to a comma/space/
 * newline/semicolon-separated list of permitted entries to make signup
 * invite-only. Entries may be:
 *   - an exact email           ("jane@example.com")
 *   - a whole domain           ("@example.com")  → any address at that domain
 * Matching is case-insensitive (both sides normalized). This gates ACCOUNT
 * CREATION only; it never affects sign-in for already-created accounts.
 */
import { normalizeEmail } from '@/lib/auth/validate';

/** Split the raw env value into normalized, de-duplicated entries (emails or @domains). */
export function parseAllowlist(raw: string | undefined | null): string[] {
  const seen = new Set<string>();
  for (const part of (raw ?? '').split(/[\s,;]+/)) {
    const e = part.trim().toLowerCase();
    if (e) seen.add(e);
  }
  return [...seen];
}

/**
 * True if `email` may create an account given the raw allowlist value.
 * Empty/unset allowlist → OPEN (true). Otherwise the normalized email must be an
 * exact listed address OR its domain must be listed as "@domain". A malformed
 * email is refused whenever a non-empty allowlist is in force.
 */
export function isSignupAllowed(email: string, rawAllowlist: string | undefined | null): boolean {
  const list = parseAllowlist(rawAllowlist);
  if (list.length === 0) return true; // dormant by default — preserves demo/local/test signup

  const e = normalizeEmail(email);
  const at = e.lastIndexOf('@');
  if (at <= 0 || at === e.length - 1) return false; // no local part or no domain → not a usable email
  if (list.includes(e)) return true;

  const domain = e.slice(at); // includes the leading '@'
  return list.includes(domain);
}
