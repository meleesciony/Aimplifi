/**
 * The shared at-rest salt resolution (src/lib/auth/token-salt.ts), extracted from
 * the three secrets that are stored only as sha256(salt:value) — password-reset
 * tokens, household invite codes, and the deletion record's user ref
 * (2026-07-21 agent review, finding B3).
 *
 * The order is a security property, not a preference: a deployed install must be
 * salted with a real secret (AUTH_SECRET) even when the feature's own var is
 * unset, and the public dev fallback exists ONLY so the zero-credential demo
 * boots (CLAUDE.md rule 4).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tokenSalt } from '@/lib/auth/token-salt';

const ORIG_AUTH = process.env.AUTH_SECRET;
const ORIG_FEATURE = process.env.TEST_FEATURE_SALT;

beforeEach(() => {
  delete process.env.AUTH_SECRET;
  delete process.env.TEST_FEATURE_SALT;
});

afterEach(() => {
  if (ORIG_AUTH === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = ORIG_AUTH;
  if (ORIG_FEATURE === undefined) delete process.env.TEST_FEATURE_SALT;
  else process.env.TEST_FEATURE_SALT = ORIG_FEATURE;
});

describe('tokenSalt — env override → AUTH_SECRET → dev fallback', () => {
  it('uses the feature’s own var when set, even alongside AUTH_SECRET', () => {
    process.env.TEST_FEATURE_SALT = 'feature-salt';
    process.env.AUTH_SECRET = 'auth-secret';
    expect(tokenSalt('TEST_FEATURE_SALT', 'dev-fallback')).toBe('feature-salt');
  });

  it('falls back to AUTH_SECRET — so a real deployment is never publicly salted', () => {
    process.env.AUTH_SECRET = 'auth-secret';
    expect(tokenSalt('TEST_FEATURE_SALT', 'dev-fallback')).toBe('auth-secret');
  });

  it('uses the public dev fallback ONLY when neither env var exists', () => {
    expect(tokenSalt('TEST_FEATURE_SALT', 'dev-fallback')).toBe('dev-fallback');
  });

  it('honours an explicitly EMPTY salt rather than falling through', () => {
    // `??`, not `||`: an operator who sets it empty meant empty. Falling through
    // would silently hash with a different salt than they configured.
    process.env.TEST_FEATURE_SALT = '';
    process.env.AUTH_SECRET = 'auth-secret';
    expect(tokenSalt('TEST_FEATURE_SALT', 'dev-fallback')).toBe('');
  });

  it('is per-feature: two features never share a salt by accident', () => {
    process.env.AUTH_SECRET = 'auth-secret';
    // With AUTH_SECRET present both resolve to it — that is intended (one secret,
    // three distinct hash inputs, since each hash prefixes its own value).
    expect(tokenSalt('RESET_TOKEN_SALT', 'aimplifi-reset-dev-v1')).toBe('auth-secret');
    delete process.env.AUTH_SECRET;
    // With nothing set, the dev fallbacks are DIFFERENT strings per feature, so a
    // leaked invite-code hash dump can't be replayed against reset tokens.
    expect(tokenSalt('RESET_TOKEN_SALT', 'aimplifi-reset-dev-v1')).not.toBe(
      tokenSalt('INVITE_CODE_SALT', 'aimplifi-invite-dev-v1'),
    );
  });
});
