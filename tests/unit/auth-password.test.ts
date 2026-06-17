import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { MIN_PASSWORD_LENGTH, normalizeEmail, validateSignup } from '@/lib/auth/validate';

describe('password hashing (DECISIONS #43)', () => {
  it('round-trips: the right password verifies, a wrong one does not', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(verifyPassword('wrong password', hash)).toBe(false);
  });

  it('salts: the same password hashes differently each time, both verify', () => {
    const a = hashPassword('hunter2hunter2');
    const b = hashPassword('hunter2hunter2');
    expect(a).not.toBe(b);
    expect(verifyPassword('hunter2hunter2', a)).toBe(true);
    expect(verifyPassword('hunter2hunter2', b)).toBe(true);
  });

  it('rejects malformed / empty / tampered stored hashes', () => {
    expect(verifyPassword('x', null)).toBe(false);
    expect(verifyPassword('x', '')).toBe(false);
    expect(verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(verifyPassword('x', 'scrypt$only-two')).toBe(false);
  });
});

describe('validateSignup', () => {
  it('accepts a valid email + password and normalizes the email', () => {
    expect(validateSignup({ email: '  User@Example.COM ', password: 'longenough1' })).toEqual({
      ok: true,
      email: 'user@example.com',
    });
  });

  it(`rejects a bad email and a < ${MIN_PASSWORD_LENGTH}-char password, reporting both`, () => {
    const r = validateSignup({ email: 'nope', password: 'short' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(2);
  });

  it('normalizeEmail trims and lowercases', () => {
    expect(normalizeEmail('  Foo@Bar.com ')).toBe('foo@bar.com');
  });
});
