'use server';

/**
 * Email/password auth actions (DECISIONS #43). Sign-up creates a hashed-password
 * user then signs them in; sign-in verifies via the 'password' Credentials
 * provider. Auth.js signIn throws NEXT_REDIRECT on success (must propagate) and
 * AuthError on bad credentials (caught → friendly message).
 */
import { AuthError } from 'next-auth';
import { signIn } from '@/auth';
import { hashPassword } from '@/lib/auth/password';
import { isSignupAllowed } from '@/lib/auth/allowlist';
import { normalizeEmail, validateSignup } from '@/lib/auth/validate';
import { rateLimitDurable } from '@/server/authz';
import { clientIp } from '@/lib/request-ip';
import { prisma } from '@/lib/db';

/**
 * Sign-in throttle (ROADMAP #8, hardened per Critic SEC-2). Two durable, cross-instance
 * dimensions that together stop brute-force WITHOUT enabling a targeted-account lockout:
 *  - PER-IP, checked BEFORE auth — the volume cap on a single attacker. Keyed on the
 *    caller's device, so it can never lock a victim out of their own account.
 *  - PER-ACCOUNT FAILED attempts, checked AFTER a failed sign-in — a correct password
 *    always succeeds before this runs, so a legitimate user is never blocked.
 */
const SIGNIN_FAIL_LIMIT = 8; // failed attempts per account / window
const SIGNIN_IP_LIMIT = 20; // attempts per device / window
const SIGNIN_WINDOW_MS = 60_000;

/**
 * Household owners — ALWAYS allowed to create an account on the deployed app
 * (DECISIONS #60), so a missing/mis-set SIGNUP_ALLOWLIST can never lock the
 * owners out of their own app. On Vercel this is unioned into the allowlist, so
 * with no env var the deploy is invite-only to exactly these two; with one, it's
 * these two PLUS whatever it lists. Off Vercel (tests/local) it's dormant, so the
 * suite's open-signup behavior is unchanged.
 */
const OWNER_ALLOWLIST = 'michael.lee.p@gmail.com, lizysuh55@gmail.com';

/** The effective signup allowlist: on Vercel, the env list ∪ the owners (owners
 *  always allowed); elsewhere, the env list verbatim (unset → open, for tests). */
function effectiveAllowlist(): string {
  const env = process.env.SIGNUP_ALLOWLIST?.trim() ?? '';
  if (!process.env.VERCEL) return env; // local/test: unchanged (dormant by default)
  return [env, OWNER_ALLOWLIST].filter(Boolean).join(', ');
}

export interface AuthFormState {
  error?: string;
}

export async function signUpWithPassword(
  _prev: AuthFormState | null,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const parsed = validateSignup({ email, password });
  if (!parsed.ok) return { error: parsed.errors.join(' ') };

  // Invite-only gate (DECISIONS #57, #60). On Vercel the household owners are always
  // allowed (env ∪ OWNER_ALLOWLIST) so a mis-set env var can't lock them out; off
  // Vercel it stays dormant unless SIGNUP_ALLOWLIST is set. Checked on the normalized
  // email, before any DB write, so an un-invited address never creates a row.
  if (!isSignupAllowed(parsed.email, effectiveAllowlist())) {
    return { error: 'This app is invite-only. Ask the owner to add your email to the allowlist.' };
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.email }, select: { id: true } });
  if (existing) return { error: 'An account with that email already exists — sign in instead.' };

  await prisma.user.create({ data: { email: parsed.email, passwordHash: hashPassword(password) } });
  try {
    await signIn('password', { email: parsed.email, password, redirectTo: '/dashboard' });
  } catch (e) {
    if (e instanceof AuthError) return { error: 'Account created — please sign in.' };
    throw e; // NEXT_REDIRECT
  }
  return {};
}

export async function signInWithPassword(
  _prev: AuthFormState | null,
  formData: FormData,
): Promise<AuthFormState> {
  const email = normalizeEmail(String(formData.get('email') ?? ''));
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.' };

  // (1) Per-device volume cap, BEFORE any auth work (fails CLOSED on a limiter DB
  //     error). Keyed on the caller's IP, so it bounds an attacker's guess rate but
  //     can never lock a victim out of their own account.
  const ip = await clientIp();
  if (!(await rateLimitDurable(`signin-ip:${ip}`, SIGNIN_IP_LIMIT, SIGNIN_WINDOW_MS))) {
    return { error: 'Too many sign-in attempts from this device. Please wait a minute and try again.' };
  }

  try {
    await signIn('password', { email, password, redirectTo: '/dashboard' });
  } catch (e) {
    if (e instanceof AuthError) {
      // (2) Per-account FAILED-attempt cap, consumed ONLY on a failure and checked
      //     AFTER sign-in — so a correct password is never blocked (no targeted
      //     account lockout, Critic SEC-2).
      if (!(await rateLimitDurable(`signin-fail:${email}`, SIGNIN_FAIL_LIMIT, SIGNIN_WINDOW_MS))) {
        return { error: 'Too many failed attempts for this account. Please wait a minute and try again.' };
      }
      return { error: 'Invalid email or password.' };
    }
    throw e; // NEXT_REDIRECT
  }
  return {};
}

/** Single dispatcher for the sign-in/up form (mode in a hidden field). */
export async function authenticate(prev: AuthFormState | null, formData: FormData): Promise<AuthFormState> {
  return String(formData.get('mode') ?? 'signin') === 'signup'
    ? signUpWithPassword(prev, formData)
    : signInWithPassword(prev, formData);
}

export async function googleSignIn(): Promise<void> {
  await signIn('google', { redirectTo: '/dashboard' });
}
