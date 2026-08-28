/**
 * Locking test for the session idle timeout (REGRESSION_LEDGER 2026-07-27,
 * amended DECISIONS #527).
 *
 * Symptom this pins: `authConfig` set `session: { strategy: 'jwt' }` and NO
 * `maxAge`, so Auth.js applied its 30-DAY default to both the JWT and the
 * session cookie's `Expires` attribute. A 30-day `Expires` is a persistent
 * cookie — written to disk — so signing in survived closing the browser and
 * shutting the machine down, for a month, on any shared or stolen computer.
 *
 * #527 keeps that Auth.js ceiling at 30 days (required: the library cannot
 * vary `maxAge` per sign-in) and grants it ONLY to tokens stamped
 * `remember: true`. The default path is still the 30-minute idle window,
 * enforced by `applySessionLifetime` in the jwt callback — not by deleting
 * the 30-minute assertion.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SESSION_IDLE_TIMEOUT_MINUTES,
  SESSION_IDLE_TIMEOUT_SECONDS,
  SESSION_REMEMBER_TIMEOUT_DAYS,
  SESSION_REMEMBER_TIMEOUT_SECONDS,
  authConfig,
} from '@/auth.config';

const MINUTE = 60;
const DAY = 24 * 60 * MINUTE;

describe('session idle timeout', () => {
  it('sets an explicit maxAge, so Auth.js never falls back to an implicit default', () => {
    expect(authConfig.session?.maxAge).toBeDefined();
    expect(authConfig.session?.maxAge).toBe(SESSION_REMEMBER_TIMEOUT_SECONDS);
  });

  it('keeps the DEFAULT window at or under 30 minutes — the whole point of the #321 fix', () => {
    expect(SESSION_IDLE_TIMEOUT_SECONDS).toBeLessThanOrEqual(30 * MINUTE);
  });

  it('keeps the default window long enough to be usable (at least 5 minutes)', () => {
    expect(SESSION_IDLE_TIMEOUT_SECONDS).toBeGreaterThanOrEqual(5 * MINUTE);
  });

  it('bounds the remember ceiling at 30 days — opt-in, not the Auth.js implicit default', () => {
    expect(SESSION_REMEMBER_TIMEOUT_SECONDS).toBe(30 * DAY);
    expect(SESSION_REMEMBER_TIMEOUT_DAYS).toBe(30);
  });

  it('states the same numbers in the UI copy that it enforces', () => {
    expect(SESSION_IDLE_TIMEOUT_MINUTES).toBe(SESSION_IDLE_TIMEOUT_SECONDS / MINUTE);
    expect(Number.isInteger(SESSION_IDLE_TIMEOUT_MINUTES)).toBe(true);
    expect(SESSION_REMEMBER_TIMEOUT_DAYS).toBe(SESSION_REMEMBER_TIMEOUT_SECONDS / DAY);
    expect(Number.isInteger(SESSION_REMEMBER_TIMEOUT_DAYS)).toBe(true);
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

  it('demo authorize does not stamp remember — the shared demo is always the 30-minute window', () => {
    const src = readFileSync(join(process.cwd(), 'src/auth.config.ts'), 'utf8');
    expect(src).toMatch(
      /id: 'demo'[\s\S]*?authorize: async \(\) => \(\{ id: DEMO_USER_ID, email: 'demo@aimplifi.app', name: 'Demo User' \}\)/,
    );
    expect(src).not.toMatch(/id: 'demo'[\s\S]*?remember:\s*true/);
  });

  it('test_regression__edge_jwt_drops_a_default_token_idle_past_30_minutes', async () => {
    const now = Math.floor(Date.now() / 1000);
    const dropped = await authConfig.callbacks.jwt({
      token: { remember: false, activityAt: now - SESSION_IDLE_TIMEOUT_SECONDS },
      user: undefined,
      account: null,
      profile: undefined,
      trigger: 'update',
    } as never);
    expect(dropped).toBeNull();
  });

  it('test_regression__edge_jwt_keeps_a_remember_token_overnight', async () => {
    const now = Math.floor(Date.now() / 1000);
    const kept = await authConfig.callbacks.jwt({
      token: { sub: 'u1', remember: true, activityAt: now - 12 * 60 * MINUTE },
      user: undefined,
      account: null,
      profile: undefined,
      trigger: 'update',
    } as never);
    expect(kept).not.toBeNull();
    expect(kept?.remember).toBe(true);
    expect(kept?.sub).toBe('u1');
  });

  it('a demo sign-in stamps remember=false', async () => {
    const token = await authConfig.callbacks.jwt({
      token: {},
      user: { id: 'user-demo', email: 'demo@aimplifi.app', name: 'Demo User' },
      account: { provider: 'demo', type: 'credentials' },
      profile: undefined,
      trigger: 'signIn',
    } as never);
    expect(token).not.toBeNull();
    expect(token?.remember).toBe(false);
  });

  it('a google sign-in stamps remember=false', async () => {
    const token = await authConfig.callbacks.jwt({
      token: {},
      user: { id: 'google:a@b.com', email: 'a@b.com' },
      account: { provider: 'google', type: 'oidc' },
      profile: { email: 'a@b.com' },
      trigger: 'signIn',
    } as never);
    expect(token).not.toBeNull();
    expect(token?.remember).toBe(false);
    expect(token?.sub).toBe('google:a@b.com');
  });
});
