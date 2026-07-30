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
import { credentialRejection } from '@/lib/auth/reject-reason';
import { normalizeEmail } from '@/lib/auth/validate';
import { prisma } from '@/lib/db';
import { currentSessionEpoch, isSessionEpochCurrent } from '@/server/session-guard';
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
        if (!user || !verifyPassword(password, user.passwordHash)) {
          // PII-FREE DIAGNOSTIC (owner report 2026-07-29: sign-in "sometimes says
          // wrong pw", and the retry works). The reader sees ONE sentence for
          // several different facts, so a reproduction on its own tells us
          // nothing. This records which fact it was and nothing else — no email,
          // no password, no length, no descriptor of content — via the pure
          // classifier in '@/lib/auth/reject-reason'. The owner's first captured
          // failure logged `bad-hash`, so the discriminator now splits THAT case
          // by mechanism (whitespace / mis-filled email / genuinely other bytes).
          // Every branch returns the SAME null and the reader is told the SAME
          // sentence, so this cannot become an account-enumeration oracle.
          console.warn(
            `[auth] credentials rejected: reason=${credentialRejection({
              userFound: Boolean(user),
              storedHash: user?.passwordHash,
              email,
              password,
              verify: verifyPassword,
            })}`,
          );
          return null; // same response either way
        }
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
    // Node jwt override (Gap 6 §3). Runs the edge logic first (sets token.sub for
    // credentials/Google), then — ONLY at sign-in (a fresh mint carries `user` or
    // `account`) — stamps the token epoch from the DB. This is where Prisma is
    // available (the sign-in POST is Node), so EVERY provider (password, demo,
    // Google) gets the CURRENT epoch, not a static 0. Without this, demo/Google
    // tokens minted at a hardcoded 0 could never match a bumped epoch, so a single
    // "sign out of all devices" would brick those accounts on the next sign-in.
    // Subsequent requests carry no user/account → no DB read (the per-request check
    // lives in the session callback below).
    jwt: async (params) => {
      const token = await authConfig.callbacks.jwt(params);
      if ((params.user || params.account) && token.sub) {
        const epoch = await currentSessionEpoch(token.sub);
        if (epoch !== undefined) token.epoch = epoch;
      }
      return token;
    },
    // Node-only session enforcement (Gap 6 §3). The edge session callback
    // (authConfig) maps token.sub → session.user.id with no DB; here — where
    // Prisma is available — we additionally verify the token's stamped epoch is
    // still current and the user still exists. A stale token (revokeOtherSessions
    // bumped the epoch) or a deleted account (row gone) yields a user-less session,
    // so requireUserId throws Unauthorized on this device and every other. Every
    // Node auth() call (all server actions + pages via requireUserId) passes
    // through here; middleware keeps using the Prisma-free edge config.
    session: async (params) => {
      const base = authConfig.callbacks.session(params);
      const { token } = params;
      if (token.sub && !(await isSessionEpochCurrent(token.sub, token.epoch))) {
        return { ...base, user: undefined as unknown as (typeof base)['user'] };
      }
      return base;
    },
  },
});
