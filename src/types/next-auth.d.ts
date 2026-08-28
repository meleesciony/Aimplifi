/**
 * NextAuth (Auth.js v5) module augmentation. Adds the per-user session epoch to
 * the JWT so the sign-in-time value (stamped in the jwt callback) can be compared
 * against the DB on every Node-side session resolution — the mechanism behind
 * multi-device session invalidation (Gap 6 §3, src/lib/engine/auth/session.ts).
 *
 * `remember` / `activityAt` are the opt-in stay-signed-in claims (#527): the
 * default idle window is still 30 minutes; checking the box at sign-in stamps
 * `remember: true` and uses the 30-day ceiling.
 */
import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface User {
    /** Set only on the credentials authorize return; never persisted. */
    remember?: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    /** Session epoch stamped at sign-in; compared to User.sessionEpoch on each request. */
    epoch?: number;
    /** Opt-in 30-day idle window; absent/false is the 30-minute default. */
    remember?: boolean;
    /** Unix seconds of the last session read; rolling idle starts here. */
    activityAt?: number;
  }
}
