/**
 * Remember-me is forwarded from the sign-in form into Auth.js credentials
 * (DECISIONS #527). The idle-window math is locked in session-lifetime.test.ts;
 * this file locks the wiring so an unchecked box cannot silently mint a
 * remember token (or the reverse).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/auth', () => ({ signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('next-auth', () => ({ AuthError: class AuthError extends Error {} }));
vi.mock('next/headers', () => ({ headers: vi.fn() }));

import { headers } from 'next/headers';
import { signIn } from '@/auth';
import { signInWithPassword, signUpWithPassword } from '@/server/auth-actions';

function mockIp(ip: string) {
  vi.mocked(headers).mockResolvedValue({
    get: (k: string) => (k === 'x-forwarded-for' ? ip : null),
  } as never);
}

function signInFd(email: string, password: string, remember?: boolean) {
  const f = new FormData();
  f.set('email', email);
  f.set('password', password);
  f.set('mode', 'signin');
  if (remember) f.set('remember', 'on');
  return f;
}

describe('signInWithPassword remember-me forwarding', () => {
  afterEach(() => vi.clearAllMocks());

  it('test_regression__checked_remember_box_is_forwarded_to_authjs', async () => {
    mockIp(`10.9.0.${(process.pid % 200) + 1}`);
    vi.mocked(signIn).mockResolvedValue(undefined as never);
    const email = `remember-on-${Date.now()}@test.local`;
    await signInWithPassword(null, signInFd(email, 'supersecret1', true));
    expect(signIn).toHaveBeenCalledWith(
      'password',
      expect.objectContaining({ email, remember: 'true', redirectTo: '/dashboard' }),
    );
  });

  it('test_regression__unchecked_remember_box_never_forwards_true', async () => {
    mockIp(`10.9.1.${(process.pid % 200) + 1}`);
    vi.mocked(signIn).mockResolvedValue(undefined as never);
    const email = `remember-off-${Date.now()}@test.local`;
    await signInWithPassword(null, signInFd(email, 'supersecret1'));
    expect(signIn).toHaveBeenCalledWith(
      'password',
      expect.objectContaining({ email, remember: 'false' }),
    );
  });

  it('echoes the checked box back on a failed attempt so a retry is not a re-tick', async () => {
    mockIp(`10.9.2.${(process.pid % 200) + 1}`);
    const { AuthError } = await import('next-auth');
    vi.mocked(signIn).mockRejectedValue(new AuthError('bad'));
    const out = await signInWithPassword(
      null,
      signInFd(`remember-echo-${Date.now()}@test.local`, 'wrong', true),
    );
    expect(out.remember).toBe(true);
    expect(out.error).toBe('Invalid email or password.');
  });
});

describe('sign-in form remember-me wiring (source lock)', () => {
  it('renders an unchecked checkbox named remember, never a second submit', () => {
    const form = readFileSync(
      join(process.cwd(), 'src/components/auth/email-password-form.tsx'),
      'utf8',
    );
    expect(form).toContain('data-testid="auth-remember"');
    expect(form).toContain('name="remember"');
    expect(form).toContain('Remember me on this device');
    expect(form).toContain('tap-target');
    expect(form).not.toMatch(/defaultChecked=\{true\}/);
    expect(form).not.toMatch(/type="submit"[^>]*remember/i);
  });
});

describe('signUpWithPassword remember-me forwarding', () => {
  afterEach(() => vi.clearAllMocks());

  it('echoes the checked box on a rejected signup so a retry is not a re-tick', async () => {
    // Invalid input — no DB write — still must echo remember and not call signIn.
    const f = new FormData();
    f.set('email', 'not-an-email');
    f.set('password', 'short');
    f.set('mode', 'signup');
    f.set('remember', 'on');
    const out = await signUpWithPassword(null, f);
    expect(out.remember).toBe(true);
    expect(out.error).toBeTruthy();
    expect(signIn).not.toHaveBeenCalled();
  });
});
