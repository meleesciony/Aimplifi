/**
 * Sign-up validation (DECISIONS #43) — pure, all errors at once. Normalizes the
 * email (trim + lowercase) so lookups and the unique constraint are consistent.
 */
export interface SignupOk {
  ok: true;
  email: string;
}
export interface SignupErr {
  ok: false;
  errors: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateSignup(input: { email: string; password: string }): SignupOk | SignupErr {
  const errors: string[] = [];
  const email = normalizeEmail(input.email ?? '');
  if (!EMAIL_RE.test(email)) errors.push('Enter a valid email address.');
  if ((input.password ?? '').length < MIN_PASSWORD_LENGTH) {
    errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if ((input.password ?? '').length > MAX_PASSWORD_LENGTH) {
    errors.push('Password is too long.');
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, email };
}
