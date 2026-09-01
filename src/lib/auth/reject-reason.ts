/**
 * Why a credential sign-in was rejected — a PII-FREE discriminator for the logs
 * (O.14b, owner report 2026-07-29: sign-in "sometimes says wrong pw", the retry
 * works).
 *
 * The first-generation discriminator (`no-user` | `bad-hash`) did its job: the
 * owner's 2026-07-29T03:21:42Z failure logged `bad-hash`, which proved the email
 * arrived exactly as stored and the PASSWORD bytes were the wrong ones — and,
 * because he saw "Invalid email or password." rather than "Enter your email and
 * password.", that those wrong bytes were non-empty. Since `verifyPassword` is
 * deterministic in (plain, stored), the retry succeeding means the two submits
 * carried DIFFERENT bytes. What it cannot say is HOW they differed, and the
 * candidates have different fixes:
 *
 *   - surrounding whitespace added by an autofill  → fixable HERE (normalize)
 *   - the email landing in the password field      → fixable in the form markup
 *   - a genuinely different password (e.g. a stale
 *     entry saved in the password manager)         → fixable in the RESET flow,
 *                                                    which never offers the new
 *                                                    credential for saving
 *
 * So this module splits `bad-hash` three ways using only facts we can derive
 * server-side from bytes we already hold in memory for the length of the request.
 *
 * WHAT IS AND IS NOT LOGGED. The return value is a fixed enum — never the email,
 * the password, its length, or any descriptor of its content. The READER's copy
 * is identical in every branch (see auth.ts), so none of this can become an
 * account-enumeration oracle. The one honest caveat: `bad-hash+trim-verifies`
 * tells anyone who can read production logs that the submitted value was correct
 * apart from surrounding whitespace. That is only reachable by someone who
 * already holds the password modulo spaces AND can read our logs, which is a
 * strictly deeper compromise than this line, so it is accepted in exchange for
 * naming a real defect.
 */

export type CredentialRejection =
  /** The address did not match any stored user. */
  | 'no-user'
  /** The user exists but has no password set (e.g. a Google-provisioned account). */
  | 'no-password-set'
  /** Correct password, wrapped in whitespace — an autofill/keyboard artefact. */
  | 'bad-hash+trim-verifies'
  /** The password field carried the email address — a mis-targeted autofill. */
  | 'bad-hash+equals-email'
  /** Genuinely different bytes: a wrong or stale password. */
  | 'bad-hash';

export interface RejectionInput {
  /** Did a user row come back for the normalized email? */
  userFound: boolean;
  /** The stored `scrypt$salt$key` string, if the row has one. */
  storedHash: string | null | undefined;
  /** The normalized email that was looked up. */
  email: string;
  /** The password exactly as submitted — never logged, never stored. */
  password: string;
  /** Injected so this module stays pure and testable (no crypto import here). */
  verify: (plain: string, stored: string) => boolean;
}

export function credentialRejection(input: RejectionInput): CredentialRejection {
  const { userFound, storedHash, email, password, verify } = input;
  if (!userFound) return 'no-user';
  if (!storedHash) return 'no-password-set';

  // Only pay for the extra scrypt when the value actually carries surrounding
  // whitespace — so the common wrong-password case costs nothing beyond the
  // verification that already ran, and the timing of a normal rejection is
  // unchanged.
  const trimmed = password.trim();
  if (trimmed !== password && trimmed.length > 0 && verify(trimmed, storedHash)) {
    return 'bad-hash+trim-verifies';
  }

  // A password manager that targets the wrong field puts the username in both.
  // Compared case-insensitively and trimmed, because the email was normalized
  // before lookup and the mis-filled copy would not have been.
  if (password.trim().toLowerCase() === email.trim().toLowerCase() && email.length > 0) {
    return 'bad-hash+equals-email';
  }

  return 'bad-hash';
}

/**
 * Values to try against the stored hash. Raw first (the typed password). Then
 * the trimmed copy when autofill/keyboard wrapped it in whitespace. Empty after
 * trim is not a candidate — that would turn "   " into a login.
 */
export function passwordVerifyCandidates(password: string): string[] {
  const trimmed = password.trim();
  if (trimmed !== password && trimmed.length > 0) return [password, trimmed];
  return [password];
}

/** True when any candidate verifies. Null/empty stored hash never matches. */
export function credentialsMatch(
  password: string,
  storedHash: string | null | undefined,
  verify: (plain: string, stored: string) => boolean,
): boolean {
  if (!storedHash) return false;
  return passwordVerifyCandidates(password).some((candidate) => verify(candidate, storedHash));
}
