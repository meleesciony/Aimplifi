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

/**
 * Household owners — ALWAYS allowed to create an account on the deployed app
 * (DECISIONS #60), so a missing/mis-set SIGNUP_ALLOWLIST can never lock the
 * owners out of their own app.
 */
export const OWNER_ALLOWLIST = 'michael.lee.p@gmail.com, lizysuh55@gmail.com';

/**
 * The effective signup allowlist string (DECISIONS #57, #60, #100). On Vercel it's
 * the env list ∪ the owners (owners always allowed, so a mis-set env var can't lock
 * them out); elsewhere (tests/local) it's the env list verbatim — unset → empty →
 * open (dormant). This now gates ACCOUNT CREATION for BOTH email/password signup
 * (src/server/auth-actions.ts) and Google OAuth (src/lib/auth/google-provision.ts),
 * so neither path can bypass invite-only. Lives here (a Prisma-free, env-only
 * module) so the OAuth callback can reuse it without cycling through @/auth.
 */
export function effectiveAllowlist(): string {
  const env = process.env.SIGNUP_ALLOWLIST?.trim() ?? '';
  if (!process.env.VERCEL) return env; // local/test: unchanged (dormant by default)
  return [env, OWNER_ALLOWLIST].filter(Boolean).join(', ');
}
