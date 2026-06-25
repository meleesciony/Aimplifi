/**
 * Google OAuth user provisioning + invite-only gate (DECISIONS #43, #100).
 *
 * Lives OUTSIDE src/auth.ts so it instantiates no NextAuth client and can be
 * integration-tested directly against throwaway users; the signIn callback in
 * src/auth.ts is a thin adapter over this function. It is Prisma-aware but imports
 * nothing from @/auth, so there is no import cycle.
 *
 * Enforces the SAME allowlist as email/password signup (effectiveAllowlist) so the
 * OAuth path cannot bypass invite-only — the gap a Plaid-prep adversarial review
 * found, where the old callback upserted a User for ANY Google email:
 *   - the email already belongs to a DIFFERENT account (e.g. a password user)
 *       → refuse (account-linking is a documented follow-up, #43)
 *   - the SAME Google user signing in again
 *       → allow (the allowlist gates account CREATION, never sign-in for an
 *         already-created account — mirrors allowlist.ts's contract)
 *   - a NEW email NOT on the allowlist
 *       → refuse, and create no row
 *   - a NEW email on the allowlist (or an empty/dormant allowlist)
 *       → create the User and allow
 */
import { effectiveAllowlist, isSignupAllowed } from '@/lib/auth/allowlist';
import { prisma } from '@/lib/db';

/**
 * @param email normalized (trim + lowercase) email from the Google profile
 * @param name  display name from the Google profile, or null
 * @returns whether the sign-in is permitted (false → Auth.js denies it)
 */
export async function applyGoogleSignIn(email: string, name: string | null): Promise<boolean> {
  const id = `google:${email}`;
  try {
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    // Existing row: allow only if it IS this Google account; a different id means the
    // email is already a password (or other) account — refuse rather than collide on
    // the unique-email constraint.
    if (existing) return existing.id === id;
    // New account: enforce invite-only exactly like password signup. No row is
    // created when the email is not permitted.
    if (!isSignupAllowed(email, effectiveAllowlist())) return false;
    await prisma.user.upsert({ where: { id }, create: { id, email, name }, update: {} });
    return true;
  } catch {
    return false; // never surface a raw 500 from the OAuth callback
  }
}
