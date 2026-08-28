/**
 * Session lifetime policy (DECISIONS #527). Two idle windows, one choice at
 * sign-in: the default 30-minute idle timeout (#321) and an opt-in 30-day
 * "remember me" window. Pure — no Auth.js, no Date.now — so the jwt callback
 * and the tests share one function.
 *
 * Auth.js `session.maxAge` is a SINGLE ceiling used to mint JWT `exp` and the
 * cookie's `Expires` on every session read. It cannot vary per sign-in, so the
 * config ceiling is the remember window; this module is what still kills a
 * default (unchecked) session after 30 minutes of inactivity, even though the
 * cookie may remain on disk until the ceiling.
 */
export const SESSION_IDLE_TIMEOUT_SECONDS = 30 * 60;

/** The same idle window in whole minutes, for user-facing copy. */
export const SESSION_IDLE_TIMEOUT_MINUTES = SESSION_IDLE_TIMEOUT_SECONDS / 60;

/** Opt-in ceiling when the reader checks "Remember me" at sign-in. */
export const SESSION_REMEMBER_TIMEOUT_SECONDS = 30 * 24 * 60 * 60;

/** The remember window in whole days, for user-facing copy. */
export const SESSION_REMEMBER_TIMEOUT_DAYS = SESSION_REMEMBER_TIMEOUT_SECONDS / (24 * 60 * 60);

export function sessionIdleTimeoutSeconds(remember: boolean): number {
  return remember ? SESSION_REMEMBER_TIMEOUT_SECONDS : SESSION_IDLE_TIMEOUT_SECONDS;
}

/**
 * HTML checkboxes submit `"on"` when checked and omit the field when not.
 * Auth.js credentials arrive as strings; we also accept `"true"` / `"1"` so a
 * hidden-input or a test FormData cannot silently disagree with the box.
 */
export function isRememberRequested(value: FormDataEntryValue | null | undefined): boolean {
  if (value == null) return false;
  const s = String(value).trim().toLowerCase();
  return s === 'on' || s === 'true' || s === '1' || s === 'yes';
}

export type SessionLifetimeToken = {
  remember?: boolean;
  activityAt?: number;
};

/**
 * Stamp or enforce the idle window on a JWT.
 *
 * - Sign-in: write `remember` from the form and `activityAt = now`.
 * - Later: if `activityAt` is missing (tokens minted before this feature),
 *   stamp now and continue — do not treat `iat` as last activity, or a
 *   deploy would sign out anyone who has been using the app for >30 minutes.
 * - If `now - activityAt` is past the window for this token's remember flag,
 *   return null (caller must drop the session). Otherwise roll `activityAt`.
 */
export function applySessionLifetime(
  token: SessionLifetimeToken,
  opts: { nowSeconds: number; isSignIn: boolean; rememberRequested?: boolean },
): SessionLifetimeToken | null {
  if (opts.isSignIn) {
    return {
      ...token,
      remember: opts.rememberRequested === true,
      activityAt: opts.nowSeconds,
    };
  }
  const remember = token.remember === true;
  if (
    typeof token.activityAt === 'number' &&
    opts.nowSeconds - token.activityAt >= sessionIdleTimeoutSeconds(remember)
  ) {
    return null;
  }
  return { ...token, activityAt: opts.nowSeconds };
}

/**
 * Read the lifetime claims off an Auth.js JWT without depending on the
 * `next-auth/jwt` module augmentation (probes typecheck auth.config.ts without
 * `src/types/next-auth.d.ts` in their program).
 */
export function lifetimeFieldsFrom(token: object): SessionLifetimeToken {
  const t = token as Record<string, unknown>;
  return {
    remember: t.remember === true ? true : t.remember === false ? false : undefined,
    activityAt: typeof t.activityAt === 'number' ? t.activityAt : undefined,
  };
}

/** True only when credentials authorize stamped `remember: true` on the user. */
export function userRequestedRemember(user: object | undefined): boolean {
  if (!user) return false;
  return (user as Record<string, unknown>).remember === true;
}

/** Stamp the lifetime claims back onto the JWT (same probes constraint). */
export function stampLifetimeFields(token: object, fields: SessionLifetimeToken): void {
  const t = token as Record<string, unknown>;
  t.remember = fields.remember === true;
  t.activityAt = fields.activityAt;
}
