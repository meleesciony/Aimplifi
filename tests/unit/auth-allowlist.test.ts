/**
 * Invite-only signup allowlist (DECISIONS #57) — pure known-answer tests.
 * The critical property: DORMANT (open) when unset so demo/local/test signup
 * keeps working, and a strict gate when set.
 */
import { describe, expect, it } from 'vitest';
import { isSignupAllowed, parseAllowlist } from '@/lib/auth/allowlist';

describe('parseAllowlist', () => {
  it('returns [] for unset/blank (→ open signup)', () => {
    expect(parseAllowlist(undefined)).toEqual([]);
    expect(parseAllowlist(null)).toEqual([]);
    expect(parseAllowlist('   ')).toEqual([]);
  });

  it('splits on commas, spaces, semicolons, and newlines; lowercases; de-dupes', () => {
    expect(parseAllowlist('A@x.com, b@x.com;  b@x.com\n@team.com')).toEqual([
      'a@x.com',
      'b@x.com',
      '@team.com',
    ]);
  });
});

describe('isSignupAllowed', () => {
  it('is OPEN when the allowlist is unset or blank (demo/local/test invariant)', () => {
    expect(isSignupAllowed('anyone@anywhere.com', undefined)).toBe(true);
    expect(isSignupAllowed('anyone@anywhere.com', '')).toBe(true);
    expect(isSignupAllowed('anyone@anywhere.com', '   ')).toBe(true);
  });

  it('allows an exact listed email, case-insensitively', () => {
    const list = 'wife@home.com, tester@home.com';
    expect(isSignupAllowed('wife@home.com', list)).toBe(true);
    expect(isSignupAllowed('  WIFE@Home.com ', list)).toBe(true); // normalized both sides
    expect(isSignupAllowed('tester@home.com', list)).toBe(true);
  });

  it('rejects an email not on the list', () => {
    expect(isSignupAllowed('stranger@elsewhere.com', 'wife@home.com')).toBe(false);
  });

  it('allows a whole domain via an "@domain" entry', () => {
    const list = '@trustedteam.com';
    expect(isSignupAllowed('newperson@trustedteam.com', list)).toBe(true);
    expect(isSignupAllowed('another@trustedteam.com', list)).toBe(true);
    expect(isSignupAllowed('person@othercorp.com', list)).toBe(false); // wrong domain
  });

  it('does not let a domain entry match a lookalike subdomain or suffix', () => {
    // '@team.com' must not allow '@evilteam.com' or '@team.com.attacker.net'
    expect(isSignupAllowed('x@evilteam.com', '@team.com')).toBe(false);
    expect(isSignupAllowed('x@team.com.attacker.net', '@team.com')).toBe(false);
  });

  it('refuses a malformed email whenever a non-empty allowlist is in force', () => {
    expect(isSignupAllowed('not-an-email', '@team.com')).toBe(false);
    expect(isSignupAllowed('@team.com', '@team.com')).toBe(false); // no local part
    expect(isSignupAllowed('user@', '@team.com')).toBe(false); // no domain
    expect(isSignupAllowed('', 'wife@home.com')).toBe(false);
  });
});
