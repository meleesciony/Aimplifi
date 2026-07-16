/**
 * The one shared demo account id.
 *
 * It lives here, and not in auth.config.ts, because the cron import graph must stay
 * free of NextAuth (the #220 rule) while still being able to recognize the demo user.
 * `@/auth.config` re-exports it, so every existing `DEMO_USER_ID` import is unchanged.
 *
 * Why anything needs to recognize it: the demo is a credential-free, ONE-CLICK login,
 * so every anonymous visitor is the SAME user row. Anything that accumulates a user's
 * own input and shows it back to them — a household seat (#210), a learned phrasing
 * (#225) — would therefore be showing one stranger's typed words to the next. Features
 * of that shape opt the demo user out; read-only demo data does not.
 */
export const DEMO_USER_ID = 'user-demo';

export function isDemoUser(userId: string): boolean {
  return userId === DEMO_USER_ID;
}

/**
 * Refusal shown when the shared demo account tries to connect/ingest a real bank
 * (#242 follow-up). Connecting a bank to `user-demo` would land ONE visitor's real
 * financial data in the row every other anonymous visitor sees — the same
 * shared-account leak class as the household seat (#210) and learned vocabulary
 * (#226). No-shame, states the why, points at the real fix (a free account).
 */
export const DEMO_CONNECT_BLOCKED =
  'The demo is a shared account, so it can’t connect a real bank — create your own free account to link securely.';
