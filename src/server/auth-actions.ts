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
import { normalizeEmail, validateSignup } from '@/lib/auth/validate';
import { prisma } from '@/lib/db';

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
  try {
    await signIn('password', { email, password, redirectTo: '/dashboard' });
  } catch (e) {
    if (e instanceof AuthError) return { error: 'Invalid email or password.' };
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
