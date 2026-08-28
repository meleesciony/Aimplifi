/**
 * Opt-in "remember me" idle windows (DECISIONS #527). The default path must
 * still die at 30 minutes (#321); the remember path is the 30-day ceiling
 * Auth.js uses for cookie/JWT exp, granted only when the box is checked.
 */
import { describe, expect, it } from 'vitest';
import {
  SESSION_IDLE_TIMEOUT_SECONDS,
  SESSION_REMEMBER_TIMEOUT_SECONDS,
  applySessionLifetime,
  isRememberRequested,
  lifetimeFieldsFrom,
  sessionIdleTimeoutSeconds,
  stampLifetimeFields,
  userRequestedRemember,
} from '@/lib/engine/auth/session-lifetime';

const NOW = 1_800_000_000;

describe('isRememberRequested', () => {
  it('treats a checked HTML checkbox as yes', () => {
    expect(isRememberRequested('on')).toBe(true);
    expect(isRememberRequested('true')).toBe(true);
    expect(isRememberRequested('1')).toBe(true);
    expect(isRememberRequested('YES')).toBe(true);
  });

  it('treats missing, empty, and explicit-no values as no', () => {
    expect(isRememberRequested(null)).toBe(false);
    expect(isRememberRequested(undefined)).toBe(false);
    expect(isRememberRequested('')).toBe(false);
    expect(isRememberRequested('off')).toBe(false);
    expect(isRememberRequested('false')).toBe(false);
    expect(isRememberRequested('0')).toBe(false);
  });
});

describe('sessionIdleTimeoutSeconds', () => {
  it('keeps the default window at 30 minutes and the remember window at 30 days', () => {
    expect(sessionIdleTimeoutSeconds(false)).toBe(SESSION_IDLE_TIMEOUT_SECONDS);
    expect(sessionIdleTimeoutSeconds(true)).toBe(SESSION_REMEMBER_TIMEOUT_SECONDS);
  });
});

describe('applySessionLifetime', () => {
  it('stamps remember=false and activityAt on a default sign-in', () => {
    const next = applySessionLifetime({}, { nowSeconds: NOW, isSignIn: true, rememberRequested: false });
    expect(next).toEqual({ remember: false, activityAt: NOW });
  });

  it('stamps remember=true only when the form asked for it', () => {
    const next = applySessionLifetime({}, { nowSeconds: NOW, isSignIn: true, rememberRequested: true });
    expect(next).toEqual({ remember: true, activityAt: NOW });
  });

  it('an omitted rememberRequested is a default (short) session, never a remember session', () => {
    const next = applySessionLifetime({}, { nowSeconds: NOW, isSignIn: true });
    expect(next?.remember).toBe(false);
  });

  it('test_regression__default_session_dies_at_30_minutes_idle', () => {
    const stamped = applySessionLifetime(
      {},
      { nowSeconds: NOW, isSignIn: true, rememberRequested: false },
    )!;
    const still = applySessionLifetime(stamped, {
      nowSeconds: NOW + SESSION_IDLE_TIMEOUT_SECONDS - 1,
      isSignIn: false,
    });
    expect(still?.activityAt).toBe(NOW + SESSION_IDLE_TIMEOUT_SECONDS - 1);
    expect(
      applySessionLifetime(stamped, {
        nowSeconds: NOW + SESSION_IDLE_TIMEOUT_SECONDS,
        isSignIn: false,
      }),
    ).toBeNull();
  });

  it('test_regression__remember_session_survives_overnight_and_dies_at_30_days', () => {
    const stamped = applySessionLifetime(
      {},
      { nowSeconds: NOW, isSignIn: true, rememberRequested: true },
    )!;
    const overnight = 12 * 60 * 60;
    const still = applySessionLifetime(stamped, { nowSeconds: NOW + overnight, isSignIn: false });
    expect(still).not.toBeNull();
    expect(still?.remember).toBe(true);
    expect(
      applySessionLifetime(stamped, {
        nowSeconds: NOW + SESSION_REMEMBER_TIMEOUT_SECONDS,
        isSignIn: false,
      }),
    ).toBeNull();
  });

  it('a pre-feature token without activityAt is grandfathered, not timed from iat', () => {
    const next = applySessionLifetime(
      { remember: false },
      { nowSeconds: NOW, isSignIn: false },
    );
    expect(next).toEqual({ remember: false, activityAt: NOW });
  });

  it('rolling activity keeps a default session alive across many page loads', () => {
    let token = applySessionLifetime({}, { nowSeconds: NOW, isSignIn: true, rememberRequested: false })!;
    for (let i = 1; i <= 5; i++) {
      const t = applySessionLifetime(token, {
        nowSeconds: NOW + i * (SESSION_IDLE_TIMEOUT_SECONDS - 1),
        isSignIn: false,
      });
      expect(t, `load ${i} should still be signed in`).not.toBeNull();
      token = t!;
    }
  });

  it('reads lifetime claims off a plain object without requiring the JWT type', () => {
    expect(lifetimeFieldsFrom({ sub: 'u1' })).toEqual({ remember: undefined, activityAt: undefined });
    expect(lifetimeFieldsFrom({ remember: true, activityAt: 9 })).toEqual({
      remember: true,
      activityAt: 9,
    });
    expect(userRequestedRemember(undefined)).toBe(false);
    expect(userRequestedRemember({ id: 'u1' })).toBe(false);
    expect(userRequestedRemember({ id: 'u1', remember: true })).toBe(true);
    const token: Record<string, unknown> = { sub: 'u1' };
    stampLifetimeFields(token, { remember: true, activityAt: 42 });
    expect(token.remember).toBe(true);
    expect(token.activityAt).toBe(42);
  });
});
