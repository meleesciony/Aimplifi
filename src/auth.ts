/**
 * Auth.js v5 — Phase 1: one-click demo sign-in (no secrets required).
 * Magic-link/Google + the full security pass land in Phase 4 (docs/DECISIONS.md #13).
 *
 * Kept Prisma-free so it can be imported from middleware (edge runtime).
 */
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

export const DEMO_USER_ID = 'user-demo';

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: { signIn: '/sign-in' },
  providers: [
    Credentials({
      id: 'demo',
      name: 'Demo account',
      credentials: {},
      // Demo mode: the seeded demo user is the only account. Real credential
      // flows (magic link / OAuth) are Phase 4 work.
      authorize: async () => ({
        id: DEMO_USER_ID,
        email: 'demo@pulse.finance',
        name: 'Demo User',
      }),
    }),
  ],
  callbacks: {
    authorized: ({ auth: session }) => Boolean(session?.user),
    jwt: ({ token, user }) => {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session: ({ session, token }) => {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
