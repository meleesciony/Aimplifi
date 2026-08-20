/**
 * Demo CTA action (DECISIONS #489) — locks the #164/#166/#167 mutation contract:
 * `demoSignIn` must call Auth.js with `redirect: false` and return `{ ok: true }`
 * so the client can `window.location.assign('/dashboard')`. A server-driven
 * `redirectTo` left progressive enhancement dead (live HTML `action=""`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { signIn } = vi.hoisted(() => ({ signIn: vi.fn() }));

vi.mock('@/auth', () => ({ signIn }));
vi.mock('next-auth', () => ({ AuthError: class AuthError extends Error {} }));

import { demoSignIn } from '@/server/auth-actions';

describe('demoSignIn (DECISIONS #489)', () => {
  beforeEach(() => {
    signIn.mockReset();
    signIn.mockResolvedValue('/dashboard');
  });

  it('test_regression__demo_cta_uses_redirect_false_and_returns_ok', async () => {
    const res = await demoSignIn();
    expect(res).toEqual({ ok: true });
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(signIn).toHaveBeenCalledWith('demo', { redirect: false });
  });

  it('test_regression__demo_cta_propagates_auth_failure', async () => {
    const { AuthError } = await import('next-auth');
    signIn.mockRejectedValue(new AuthError('boom'));
    await expect(demoSignIn()).rejects.toBeInstanceOf(AuthError);
  });
});

describe('sign-in page demo CTA wiring (source lock)', () => {
  it('test_regression__demo_cta_uses_client_onsubmit_not_form_action', () => {
    const page = readFileSync(join(process.cwd(), 'src/app/sign-in/page.tsx'), 'utf8');
    expect(page).toContain('DemoSignInButton');
    expect(page).not.toMatch(/form\s+action=\{demoSignIn\}/);
    expect(page).not.toMatch(/async function demoSignIn/);

    const button = readFileSync(
      join(process.cwd(), 'src/components/auth/demo-sign-in-button.tsx'),
      'utf8',
    );
    expect(button).toContain("'use client'");
    expect(button).toContain('onSubmit');
    expect(button).toContain("window.location.assign('/dashboard')");
    expect(button).toContain('ActionDeadline');
    expect(button).toContain('data-testid="demo-sign-in"');
    expect(button).toContain('Explore the demo');
  });
});
