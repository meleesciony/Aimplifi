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
