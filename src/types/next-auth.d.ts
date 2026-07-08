/**
 * NextAuth (Auth.js v5) module augmentation. Adds the per-user session epoch to
 * the JWT so the sign-in-time value (stamped in the jwt callback) can be compared
 * against the DB on every Node-side session resolution — the mechanism behind
 * multi-device session invalidation (Gap 6 §3, src/lib/engine/auth/session.ts).
 */
import 'next-auth/jwt';

declare module 'next-auth/jwt' {
  interface JWT {
    /** Session epoch stamped at sign-in; compared to User.sessionEpoch on each request. */
    epoch?: number;
  }
}
