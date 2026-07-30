/**
 * O.14b — the PII-free rejection discriminator. These are the branches the next
 * production occurrence has to land in, so each one is pinned with the real
 * scrypt verifier rather than a stub wherever the answer depends on hashing.
 */
import { describe, expect, it, vi } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { credentialRejection } from '@/lib/auth/reject-reason';

const EMAIL = 'owner@aimplifi.test';
const PASSWORD = 'correct-horse-battery-staple';
const HASH = hashPassword(PASSWORD);

const base = { userFound: true, storedHash: HASH, email: EMAIL, verify: verifyPassword };

describe('credentialRejection', () => {
  it('reports no-user when the address did not match a stored account', () => {
    expect(
      credentialRejection({ ...base, userFound: false, storedHash: null, password: PASSWORD }),
    ).toBe('no-user');
  });

  it('reports no-password-set for an account with no password (e.g. Google-provisioned)', () => {
    expect(credentialRejection({ ...base, storedHash: null, password: PASSWORD })).toBe(
      'no-password-set',
    );
  });

  it('names surrounding whitespace when the trimmed value is the real password', () => {
    for (const wrapped of [` ${PASSWORD}`, `${PASSWORD} `, `\t${PASSWORD}\n`, ` ${PASSWORD} `]) {
      expect(credentialRejection({ ...base, password: wrapped })).toBe('bad-hash+trim-verifies');
    }
  });

  it('does NOT claim whitespace when trimming still does not verify', () => {
    expect(credentialRejection({ ...base, password: ' something-else ' })).toBe('bad-hash');
  });

  it('names a mis-filled email in the password field, case- and space-insensitively', () => {
    expect(credentialRejection({ ...base, password: EMAIL })).toBe('bad-hash+equals-email');
    expect(credentialRejection({ ...base, password: ` ${EMAIL.toUpperCase()} ` })).toBe(
      'bad-hash+equals-email',
    );
  });

  it('falls back to bad-hash for genuinely different bytes (a wrong or stale password)', () => {
    expect(credentialRejection({ ...base, password: 'my-previous-password' })).toBe('bad-hash');
  });

  it('never treats an all-whitespace submission as the real password', () => {
    const verify = vi.fn(() => true); // even a verifier that says yes to everything
    expect(credentialRejection({ ...base, verify, password: '   ' })).toBe('bad-hash');
    expect(verify).not.toHaveBeenCalled();
  });

  it('pays for no extra verification when the value carries no surrounding whitespace', () => {
    const verify = vi.fn(() => false);
    credentialRejection({ ...base, verify, password: 'plain-wrong' });
    expect(verify).not.toHaveBeenCalled();
  });

  it('reveals nothing beyond a fixed enum (no email, password, or length in the value)', () => {
    const reason = credentialRejection({ ...base, password: ` ${PASSWORD} ` });
    expect(reason).not.toContain(PASSWORD);
    expect(reason).not.toContain(EMAIL);
    expect(reason).not.toMatch(/\d/); // no lengths, no counts
  });
});
