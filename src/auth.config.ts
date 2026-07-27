/**
 * Edge-safe Auth.js config (DECISIONS #43). Imported by BOTH middleware (edge
 * runtime — must stay Prisma-free) and the full Node instance in auth.ts.
 *
 * Providers here are the ones whose definition is edge-safe: the one-click demo
 * (static authorize) and Google (dormant unless AUTH_GOOGLE_* are set). The
 * email/password Credentials provider needs a DB lookup, so it lives ONLY in
 * auth.ts — middleware never runs a provider's authorize (it only checks the
 * session via the `authorized` callback).
 *
 * Google users are keyed by a DETERMINISTIC id (`google:<email>`) derived in the
 * jwt callback with no DB call — so we avoid the Auth.js Prisma adapter and its
 * `Account` model name collision with our financial Account model entirely. The
 * matching User row is upserted in auth.ts's signIn callback (Node).
 */
import type { NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';

// Defined in a NextAuth-free module so the cron import graph can recognize the demo
// user without pulling Auth.js in (#220 / #225). Re-exported here: every existing
// `import { DEMO_USER_ID } from '@/auth.config'` keeps working.
import { DEMO_USER_ID } from '@/lib/demo-user';

export { DEMO_USER_ID };

/**
 * How long a session survives with NO activity, in seconds. Once the window
 * elapses the next request carries no session and lands on /sign-in.
 *
 * Why this is an IDLE timeout and not a hard cap on the session: under the `jwt`
 * strategy Auth.js re-signs the token and re-sets the cookie with a fresh
 * `expires` on EVERY session read (@auth/core `lib/actions/session.js` — the JWT
 * branch does this unconditionally), and next-auth's middleware wrapper copies
 * those Set-Cookie headers onto the response it returns (`lib/index.js`,
 * "Preserve cookies from the session response"). Our middleware runs on every
 * app route, so each page load rolls the window forward and someone actively
 * using the app is never signed out mid-task.
 *
 * `session.updateAge` is deliberately NOT set: Auth.js only consults it in the
 * DATABASE-strategy branch, so on `jwt` it is a no-op and setting it would imply
 * a throttle that does not exist.
 *
 * Before this existed the config set no `maxAge`, so Auth.js's default of 30 DAYS
 * applied to both the token and the cookie's `Expires` attribute. A 30-day
 * `Expires` makes it a persistent cookie: the browser writes it to disk, so it
 * survived closing the browser and shutting the machine down — for a month.
 */
export const SESSION_IDLE_TIMEOUT_SECONDS = 30 * 60;

/** The same window in whole minutes, for user-facing copy (single source of truth). */
export const SESSION_IDLE_TIMEOUT_MINUTES = SESSION_IDLE_TIMEOUT_SECONDS / 60;

const googleProviders =
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
    ? [
        Google({
          clientId: process.env.AUTH_GOOGLE_ID,
          clientSecret: process.env.AUTH_GOOGLE_SECRET,
        }),
      ]
    : [];

export const authConfig = {
  trustHost: true,
  session: { strategy: 'jwt', maxAge: SESSION_IDLE_TIMEOUT_SECONDS },
  pages: { signIn: '/sign-in' },
  providers: [
    Credentials({
      id: 'demo',
      name: 'Demo account',
      credentials: {},
      authorize: async () => ({ id: DEMO_USER_ID, email: 'demo@aimplifi.app', name: 'Demo User' }),
    }),
    ...googleProviders,
  ],
  callbacks: {
    authorized: ({ auth: session }) => Boolean(session?.user),
    jwt: ({ token, user, account, profile }) => {
      // Google: key by email deterministically (no DB in the edge jwt callback).
      if (account?.provider === 'google' && profile?.email) {
        token.sub = `google:${String(profile.email).toLowerCase()}`;
        return token;
      }
      if (user?.id) token.sub = user.id; // credentials (demo / password): our DB id
      // NOTE: the session epoch is NOT stamped here — the edge jwt callback is
      // Prisma-free, and demo/Google authorize can't carry it. It is stamped from
      // the DB in the Node jwt override (src/auth.ts) at sign-in, for every provider
      // uniformly, so a fresh sign-in after a revoke always re-reads the CURRENT
      // epoch (Gap 6 §3 — the fix for the demo/Google lock-out P0).
      return token;
    },
    session: ({ session, token }) => {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
} satisfies NextAuthConfig;

export default authConfig;
