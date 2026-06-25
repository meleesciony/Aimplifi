/**
 * Full Auth.js v5 instance (Node runtime — uses Prisma). Spreads the edge-safe
 * authConfig and adds the email/password Credentials provider (DB lookup) plus
 * the Google user-upsert signIn callback (DECISIONS #43). Demo sign-in and the
 * dormant Google provider come from authConfig.
 *
 * Middleware does NOT import this file — it uses auth.config.ts directly so the
 * edge bundle stays Prisma-free.
 */
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { applyGoogleSignIn } from '@/lib/auth/google-provision';
import { verifyPassword } from '@/lib/auth/password';
import { normalizeEmail } from '@/lib/auth/validate';
import { prisma } from '@/lib/db';
import { DEMO_USER_ID, authConfig } from '@/auth.config';

export { DEMO_USER_ID };

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
    Credentials({
      id: 'password',
      name: 'Email and password',
      credentials: { email: {}, password: {} },
      authorize: async (creds) => {
        const email = normalizeEmail(String(creds?.email ?? ''));
        const password = String(creds?.password ?? '');
        if (!email || !password) return null;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !verifyPassword(password, user.passwordHash)) return null; // same response either way
        return { id: user.id, email: user.email, name: user.name ?? undefined };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // Google: enforce the invite-only allowlist AND provision the User row via
    // google-provision.ts (DECISIONS #43, #100). The OAuth path is now gated
    // exactly like email/password signup — un-allowlisted emails create no row —
    // while existing accounts keep signing in. Keyed by the same deterministic
    // `google:<email>` id the jwt callback derives (no adapter, no Account-model
    // collision).
    signIn: async ({ account, profile }) => {
      if (account?.provider === 'google' && profile?.email) {
        return applyGoogleSignIn(
          normalizeEmail(String(profile.email)),
          (profile.name as string | undefined) ?? null,
        );
      }
      return true;
    },
  },
});
