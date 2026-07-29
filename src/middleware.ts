import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import authConfig from '@/auth.config';

// Edge-safe instance (no Prisma) — middleware only checks the session.
const { auth } = NextAuth(authConfig);

/**
 * Route protection: pages redirect to sign-in; API routes get a proper 401
 * JSON (clients shouldn't receive HTML). /api/auth (Auth.js), /api/cron
 * (Bearer CRON_SECRET guard inside the route), /api/repair (same Bearer guard —
 * operator-invoked repairs, O.12d), /api/plaid/webhook (called by Plaid, not a
 * logged-in user), the sign-in page, and static assets are excluded.
 */
export default auth((req) => {
  if (req.auth?.user) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const signIn = new URL('/sign-in', req.nextUrl.origin);
  return NextResponse.redirect(signIn);
});

export const config = {
  matcher: [
    // /sw.js (must serve as JS) and /offline (public fallback shell) are excluded
    // so the service worker registers and the offline page renders without a session.
    // /privacy is the public privacy policy — Plaid production access requires a
    // publicly reachable URL, so an unauthenticated reviewer must reach it without
    // a redirect to /sign-in. `privacy/?$` tolerates a trailing slash (/privacy and
    // /privacy/) while the `$` still blocks prefix collisions: /privacy-secret,
    // /privacyx and /privacy/anything all stay behind auth. /swXjs likewise can't
    // skip auth (the dot is escaped).
    // /forgot-password and /reset-password (#257) are necessarily public — a
    // locked-out user has no session. Same `/?$` trailing-slash tolerance +
    // prefix-collision block as /privacy.
    '/((?!api/auth|api/cron|api/repair|api/plaid/webhook|sign-in|forgot-password/?$|reset-password/?$|privacy/?$|offline$|sw\\.js$|_next/static|_next/image|favicon.ico|manifest|icon).*)',
  ],
};
