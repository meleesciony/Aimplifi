/**
 * Google OAuth must honor the SAME invite-only allowlist as email/password signup
 * (DECISIONS #100). A Plaid-prep adversarial review found the old signIn callback
 * upserted a User for ANY Google email, bypassing the gate. This drives the REAL
 * applyGoogleSignIn against throwaway users (unique per run, cleaned up) — it never
 * touches the seeded demo user — proving: un-allowlisted NEW emails create no row,
 * allowlisted ones are provisioned, existing accounts still sign in, and an email
 * already owned by a password account is refused.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyGoogleSignIn } from '@/lib/auth/google-provision';
import { prisma } from '@/lib/db';

describe('applyGoogleSignIn — Google OAuth respects invite-only (DECISIONS #100)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const allowed = `g-allowed-${stamp}@example.com`;
  const blocked = `g-blocked-${stamp}@example.com`;
  const legacy = `g-legacy-${stamp}@example.com`;
  const pwEmail = `g-pw-${stamp}@example.com`;
  const pwId = `pw-${stamp}`;
  const ids = [allowed, blocked, legacy, pwEmail].map((e) => `google:${e}`).concat(pwId);

  const savedAllowlist = process.env.SIGNUP_ALLOWLIST;
  const savedVercel = process.env.VERCEL;

  const wipe = () => prisma.user.deleteMany({ where: { id: { in: ids } } });

  beforeEach(async () => {
    delete process.env.VERCEL; // off Vercel → effectiveAllowlist() is SIGNUP_ALLOWLIST verbatim
    process.env.SIGNUP_ALLOWLIST = allowed; // a non-empty list → invite-only is in force
    await wipe();
  });
  afterEach(wipe);
  afterAll(() => {
    if (savedAllowlist === undefined) delete process.env.SIGNUP_ALLOWLIST;
    else process.env.SIGNUP_ALLOWLIST = savedAllowlist;
    if (savedVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = savedVercel;
  });

  it('refuses a NEW Google email that is not on the allowlist, and creates no row', async () => {
    expect(await applyGoogleSignIn(blocked, 'Blocked')).toBe(false);
    expect(await prisma.user.findUnique({ where: { id: `google:${blocked}` } })).toBeNull();
  });

  it('admits and provisions a NEW Google email that IS on the allowlist', async () => {
    expect(await applyGoogleSignIn(allowed, 'Allowed')).toBe(true);
    const row = await prisma.user.findUnique({ where: { id: `google:${allowed}` } });
    expect(row?.email).toBe(allowed);
  });

  it('lets an EXISTING Google account sign in even when not on the allowlist (gate is creation-only)', async () => {
    await prisma.user.create({ data: { id: `google:${legacy}`, email: legacy } });
    // legacy is intentionally NOT in SIGNUP_ALLOWLIST (still just `allowed`)
    expect(await applyGoogleSignIn(legacy, null)).toBe(true);
  });

  it('refuses when the email already belongs to a different (password) account, leaving it intact', async () => {
    await prisma.user.create({ data: { id: pwId, email: pwEmail, passwordHash: 'x' } });
    process.env.SIGNUP_ALLOWLIST = pwEmail; // even if allowlisted, the id collision must refuse
    expect(await applyGoogleSignIn(pwEmail, null)).toBe(false);
    const row = await prisma.user.findUnique({ where: { email: pwEmail }, select: { id: true } });
    expect(row?.id).toBe(pwId);
  });

  it('with an empty/dormant allowlist, a new Google email is admitted (open signup preserved)', async () => {
    delete process.env.SIGNUP_ALLOWLIST;
    expect(await applyGoogleSignIn(allowed, 'Open')).toBe(true);
    expect(await prisma.user.findUnique({ where: { id: `google:${allowed}` } })).not.toBeNull();
  });
});
