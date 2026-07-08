/**
 * Session-lifecycle engine (Gap 6 §3). Pure decision + hash logic for
 * multi-device session invalidation and the PII-free deletion record. The DB
 * side (the Node session callback + revokeOtherSessions + the deletion record
 * write) is covered by the integration test in session-invalidation.test.ts;
 * this file pins the deterministic core.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DELETION_REF_SALT,
  hashUserRef,
  isSessionCurrent,
} from '@/lib/engine/auth/session';

describe('isSessionCurrent', () => {
  it('is current when the stamped epoch matches the DB epoch', () => {
    expect(isSessionCurrent(0, 0)).toBe(true);
    expect(isSessionCurrent(3, 3)).toBe(true);
  });

  it('is NOT current after the DB epoch is bumped past the token (revoke)', () => {
    expect(isSessionCurrent(1, 0)).toBe(false);
    expect(isSessionCurrent(5, 4)).toBe(false);
  });

  it('is NOT current when the user row is gone (deleted account)', () => {
    expect(isSessionCurrent(null, 0)).toBe(false);
    expect(isSessionCurrent(null, 7)).toBe(false);
    expect(isSessionCurrent(null, undefined)).toBe(false);
  });

  it('treats an absent token epoch as 0 (pre-feature / edge-minted Google tokens)', () => {
    // undefined validates against a default-0 user...
    expect(isSessionCurrent(0, undefined)).toBe(true);
    // ...and is correctly killed by any bump.
    expect(isSessionCurrent(1, undefined)).toBe(false);
  });

  it('never treats a stale token as current merely because the numbers are close', () => {
    // A token from a FUTURE epoch (should be impossible, but fail closed on !=).
    expect(isSessionCurrent(2, 3)).toBe(false);
  });
});

describe('hashUserRef', () => {
  // Pinned against SHA-256 vectors computed independently (node:crypto), so the
  // test is not a tautology over the implementation.
  it('produces the known salted-SHA-256 digest for the default salt', () => {
    expect(hashUserRef('del-doomed-X')).toBe(
      '62e7ce057e7126c6df40d5b2e9df5af8a299b1fba494065aec90f45a50d7ba77',
    );
    expect(hashUserRef('')).toBe(
      '2b13e56d3ab887c902b55e4ea73c604cdb09f287db19099554afc0b154ea24ac',
    );
  });

  it('retains no recoverable id — the Google id (which embeds an email) hashes away', () => {
    const hash = hashUserRef('google:someone@example.com');
    expect(hash).toBe('926958768cfe8aa2091ab5687abf61dce0266b47350f627d0aafcdd9addaa15d');
    expect(hash).not.toContain('someone');
    expect(hash).not.toContain('@');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic and salt-sensitive', () => {
    expect(hashUserRef('u1')).toBe(hashUserRef('u1'));
    expect(hashUserRef('u1', 'other-salt')).not.toBe(hashUserRef('u1', DEFAULT_DELETION_REF_SALT));
    expect(hashUserRef('u1')).not.toBe(hashUserRef('u2'));
  });
});
