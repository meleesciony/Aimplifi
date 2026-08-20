/**
 * Header Sign out action (DECISIONS #492) — locks the #164/#166/#167 mutation
 * contract: `doSignOut` must call Auth.js with `redirect: false` and return
 * `{ ok: true }` so the client can `window.location.assign('/sign-in')`. A
 * server-driven `redirectTo` left progressive enhancement dead (live HTML
 * `action=""` on the layout form).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));

vi.mock('@/auth', () => ({ signOut, signIn: vi.fn() }));
vi.mock('next-auth', () => ({ AuthError: class AuthError extends Error {} }));

import { doSignOut } from '@/server/auth-actions';

describe('doSignOut (DECISIONS #492)', () => {
  beforeEach(() => {
    signOut.mockReset();
    signOut.mockResolvedValue(undefined);
  });

  it('test_regression__sign_out_uses_redirect_false_and_returns_ok', async () => {
    const res = await doSignOut();
    expect(res).toEqual({ ok: true });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ redirect: false });
  });

  it('test_regression__sign_out_propagates_auth_failure', async () => {
    const boom = new Error('signOut failed');
    signOut.mockRejectedValue(boom);
    await expect(doSignOut()).rejects.toBe(boom);
  });
});

describe('app layout Sign out wiring (source lock)', () => {
  it('test_regression__sign_out_uses_client_onsubmit_not_form_action', () => {
    const layout = readFileSync(join(process.cwd(), 'src/app/(app)/layout.tsx'), 'utf8');
    expect(layout).toContain('SignOutButton');
    expect(layout).not.toMatch(/form\s+action=\{doSignOut\}/);
    expect(layout).not.toMatch(/async function doSignOut/);
    expect(layout).not.toMatch(/signOut\(\{\s*redirectTo:/);

    const button = readFileSync(
      join(process.cwd(), 'src/components/auth/sign-out-button.tsx'),
      'utf8',
    );
    expect(button).toContain("'use client'");
    expect(button).toContain('onSubmit');
    expect(button).toContain("window.location.assign('/sign-in')");
    expect(button).toContain('ActionDeadline');
    expect(button).toContain('data-testid="sign-out-form"');
    expect(button).toContain('Sign out');
    expect(button).toContain('variant="ghost"');
    expect(button).toContain('size="sm"');
  });
});
