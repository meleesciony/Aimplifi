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
import {
  SESSION_REMEMBER_TIMEOUT_SECONDS,
  applySessionLifetime,
  lifetimeFieldsFrom,
  stampLifetimeFields,
  userRequestedRemember,
} from '@/lib/engine/auth/session-lifetime';

export { DEMO_USER_ID };
export {
  SESSION_IDLE_TIMEOUT_MINUTES,
  SESSION_IDLE_TIMEOUT_SECONDS,
  SESSION_REMEMBER_TIMEOUT_DAYS,
  SESSION_REMEMBER_TIMEOUT_SECONDS,
} from '@/lib/engine/auth/session-lifetime';

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
  // Ceiling for JWT `exp` and cookie `Expires`. Auth.js cannot vary this per
  // sign-in (it re-signs from this number on every session read), so the
  // remember window lives here and `applySessionLifetime` still kills a
  // default (unchecked) session after 30 minutes of idle. See #321 / #527.
  session: { strategy: 'jwt', maxAge: SESSION_REMEMBER_TIMEOUT_SECONDS },
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
      } else if (user?.id) {
        token.sub = user.id; // credentials (demo / password): our DB id
      }
      // Idle window (#321 default 30 min, #527 opt-in 30 days). Edge-safe: the
      // claim lives on the token, no Prisma. Returning null drops the session
      // so middleware sends the reader to /sign-in.
      const next = applySessionLifetime(lifetimeFieldsFrom(token), {
        nowSeconds: Math.floor(Date.now() / 1000),
        isSignIn: Boolean(user || account),
        rememberRequested: userRequestedRemember(user),
      });
      if (!next) return null; // @auth/core session.js: null → sessionStore.clean()
      stampLifetimeFields(token, next);
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
