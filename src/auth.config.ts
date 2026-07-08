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

export const DEMO_USER_ID = 'user-demo';

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
  session: { strategy: 'jwt' },
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
