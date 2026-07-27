/**
 * Locking test for the session idle timeout (REGRESSION_LEDGER 2026-07-27).
 *
 * Symptom this pins: `authConfig` set `session: { strategy: 'jwt' }` and NO
 * `maxAge`, so Auth.js applied its 30-DAY default to both the JWT and the
 * session cookie's `Expires` attribute. A 30-day `Expires` is a persistent
 * cookie — written to disk — so signing in survived closing the browser and
 * shutting the machine down, for a month, on any shared or stolen computer.
 *
 * These assertions fail against the old config (maxAge undefined) and pass
 * against the new one. The upper bound is the real guard: a future edit that
 * "just bumps it a bit" to days has to come through here first.
 */
import { describe, expect, it } from 'vitest';
import {
  SESSION_IDLE_TIMEOUT_MINUTES,
  SESSION_IDLE_TIMEOUT_SECONDS,
  authConfig,
} from '@/auth.config';

const MINUTE = 60;

describe('session idle timeout', () => {
  it('sets an explicit maxAge, so Auth.js never falls back to its 30-day default', () => {
    expect(authConfig.session?.maxAge).toBeDefined();
    expect(authConfig.session?.maxAge).toBe(SESSION_IDLE_TIMEOUT_SECONDS);
  });

  it('keeps the window at or under 30 minutes — the whole point of the fix', () => {
    expect(SESSION_IDLE_TIMEOUT_SECONDS).toBeLessThanOrEqual(30 * MINUTE);
  });

  it('keeps the window long enough to be usable (at least 5 minutes)', () => {
    expect(SESSION_IDLE_TIMEOUT_SECONDS).toBeGreaterThanOrEqual(5 * MINUTE);
  });

  it('states the same number in the UI copy that it enforces in the cookie', () => {
    // The sign-in page renders SESSION_IDLE_TIMEOUT_MINUTES. If someone changes
    // the seconds without the minutes deriving from them, the page starts lying.
    expect(SESSION_IDLE_TIMEOUT_MINUTES).toBe(SESSION_IDLE_TIMEOUT_SECONDS / MINUTE);
    expect(Number.isInteger(SESSION_IDLE_TIMEOUT_MINUTES)).toBe(true);
  });

  it('does NOT set updateAge, which Auth.js ignores under the jwt strategy', () => {
    // @auth/core consults session.updateAge only in the database-strategy branch
    // of lib/actions/session.js. Setting it here would imply a refresh throttle
    // that does not exist — the jwt branch re-signs on every read.
    expect(authConfig.session).not.toHaveProperty('updateAge');
  });

  it('still uses the stateless jwt strategy (no adapter was introduced)', () => {
    expect(authConfig.session?.strategy).toBe('jwt');
  });
});
