'use server';

/**
 * Email/password auth actions (DECISIONS #43). Sign-up creates a hashed-password
 * user then signs them in; sign-in verifies via the 'password' Credentials
 * provider. Auth.js signIn throws NEXT_REDIRECT on success (must propagate) and
 * AuthError on bad credentials (caught → friendly message).
 */
import { AuthError } from 'next-auth';
import { signIn, signOut } from '@/auth';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { hashPassword } from '@/lib/auth/password';
import { effectiveAllowlist, isSignupAllowed } from '@/lib/auth/allowlist';
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
 * Auth.js error types that are OUR fault, not a wrong password (owner report
 * 2026-07-29: *"the login is buggy. When I click login, it sometimes says wrong
 * pw. I click it again, it works."*).
 *
 * Until now every `AuthError` — including a database failure inside `authorize`,
 * which Auth.js wraps as `CallbackRouteError` — was reported to the reader as
 * "Invalid email or password.". That sentence is a CLAIM about what the reader
 * typed, and on this path it could be false: a transient system fault told him
 * his own correct password was wrong. A message that blames the reader for our
 * outage is the worst kind of copy defect, because the honest reaction to it is
 * to doubt a password that was right.
 *
 * The DIRECTION of this list is deliberate. An unrecognised `AuthError` stays on
 * the credential path — it keeps the "invalid" copy AND keeps consuming the
 * per-account failed-attempt budget — because the alternative lets an attacker
 * who can provoke any unusual AuthError opt out of brute-force throttling. Only
 * types that are unambiguously infrastructure are excused, and being excused
 * costs the attacker nothing they could exploit (these need a broken deployment,
 * not a guessable input).
 */
const SYSTEM_AUTH_ERROR_TYPES: ReadonlySet<string> = new Set([
  'CallbackRouteError', // authorize() threw — e.g. the user lookup failed
  'AdapterError',
  'EventError',
  'JWTSessionError',
  'SessionTokenError',
  'MissingSecret',
  'MissingAdapter',
  'MissingAdapterMethods',
  'MissingAuthorize',
  'UnsupportedStrategy',
  'InvalidProvider',
  'InvalidEndpoints',
  'UntrustedHost',
  'ErrorPageLoop',
]);

// OWNER_ALLOWLIST + effectiveAllowlist() moved to '@/lib/auth/allowlist' (DECISIONS
// #100) so the Google OAuth signIn callback (src/auth.ts via google-provision.ts)
// enforces the SAME invite-only gate without importing this server-action module
// (which would cycle through @/auth).

export interface AuthFormState {
  error?: string;
  /**
   * The address that was just submitted, echoed back so the form can restore it
   * (O.14b). React resets an uncontrolled `<form action>` after the action
   * returns — MEASURED, not assumed: `tests/e2e/auth.spec.ts` "a failed attempt
   * keeps the email…" showed BOTH fields emptied on a rejection. So a retry was
   * never a second click on the values that just failed; it was a full re-entry,
   * which on a phone means re-invoking the password manager. Restoring the email
   * (via `defaultValue`, which is what React resets TO) removes half of that
   * re-entry. The password is deliberately NOT echoed: it is not sent back over
   * the wire to be restored into a field.
   */
  email?: string;
}

export async function signUpWithPassword(
  _prev: AuthFormState | null,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const parsed = validateSignup({ email, password });
  if (!parsed.ok) return { error: parsed.errors.join(' '), email: normalizeEmail(email) };

  // Invite-only gate (DECISIONS #57, #60). On Vercel the household owners are always
  // allowed (env ∪ OWNER_ALLOWLIST) so a mis-set env var can't lock them out; off
  // Vercel it stays dormant unless SIGNUP_ALLOWLIST is set. Checked on the normalized
  // email, before any DB write, so an un-invited address never creates a row.
  if (!isSignupAllowed(parsed.email, effectiveAllowlist())) {
    return {
      error: 'This app is invite-only. Ask the owner to add your email to the allowlist.',
      email: parsed.email,
    };
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.email }, select: { id: true } });
  if (existing)
    return { error: 'An account with that email already exists — sign in instead.', email: parsed.email };

  await prisma.user.create({ data: { email: parsed.email, passwordHash: hashPassword(password) } });
  try {
    await signIn('password', { email: parsed.email, password, redirectTo: '/dashboard' });
  } catch (e) {
    if (e instanceof AuthError) return { error: 'Account created — please sign in.', email: parsed.email };
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
  if (!email || !password) return { error: 'Enter your email and password.', email };

  // (1) Per-device volume cap, BEFORE any auth work (fails CLOSED on a limiter DB
  //     error). Keyed on the caller's IP, so it bounds an attacker's guess rate but
  //     can never lock a victim out of their own account.
  const ip = await clientIp();
  if (!(await rateLimitDurable(`signin-ip:${ip}`, SIGNIN_IP_LIMIT, SIGNIN_WINDOW_MS))) {
    return {
      error: 'Too many sign-in attempts from this device. Please wait a minute and try again.',
      email,
    };
  }

  try {
    await signIn('password', { email, password, redirectTo: '/dashboard' });
  } catch (e) {
    if (e instanceof AuthError) {
      // A fault on OUR side may not be reported as a wrong password, and may not
      // spend the reader's failed-attempt budget — he did not fail an attempt.
      // Unknown types deliberately fall through to the credential path below (see
      // SYSTEM_AUTH_ERROR_TYPES).
      if (SYSTEM_AUTH_ERROR_TYPES.has(e.type)) {
        console.error(`[auth] system error on sign-in: type=${e.type}`); // no email, no password
        return {
          error:
            'We could not complete sign-in, and it is a problem on our side rather than your password. Please try again.',
          email,
        };
      }
      // (2) Per-account FAILED-attempt cap, consumed ONLY on a failure and checked
      //     AFTER sign-in — so a correct password is never blocked (no targeted
      //     account lockout, Critic SEC-2).
      if (!(await rateLimitDurable(`signin-fail:${email}`, SIGNIN_FAIL_LIMIT, SIGNIN_WINDOW_MS))) {
        return {
          error: 'Too many failed attempts for this account. Please wait a minute and try again.',
          email,
        };
      }
      return { error: 'Invalid email or password.', email };
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

/**
 * Shared-demo sign-in (DECISIONS #489). Returns `{ ok: true }` so a client
 * onSubmit can `window.location.assign('/dashboard')` — the #164/#166/#167
 * mutation recipe. `redirect: false` keeps the session cookie set without a
 * server-driven NEXT_REDIRECT, which a progressive-enhancement document POST
 * never followed (live HTML had `action=""`, so no-JS POSTs stayed on /sign-in).
 */
export async function demoSignIn(): Promise<{ ok: true }> {
  try {
    await prisma.auditLog.create({
      data: { userId: DEMO_USER_ID, action: 'auth.signin', meta: '{}' },
    });
  } catch {
    /* audit is best-effort — never block demo entry */
  }
  // redirect: false sets the session cookie and returns (no NEXT_REDIRECT). If
  // Auth.js still throws a redirect or AuthError, let it propagate — never
  // swallow either into a false { ok: true }. Client navigates on ok.
  await signIn('demo', { redirect: false });
  return { ok: true };
}

/**
 * Header Sign out (DECISIONS #492). Same #164/#166/#167 / #489 recipe as
 * demoSignIn: `redirect: false` clears the session cookie without a
 * server-driven NEXT_REDIRECT, and returns `{ ok: true }` so the client can
 * `window.location.assign('/sign-in')`. The prior layout inline
 * `<form action={doSignOut}>` rendered live as `action=""`.
 */
export async function doSignOut(): Promise<{ ok: true }> {
  await signOut({ redirect: false });
  return { ok: true };
}
