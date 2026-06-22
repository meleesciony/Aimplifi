import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import authConfig from '@/auth.config';

// Edge-safe instance (no Prisma) — middleware only checks the session.
const { auth } = NextAuth(authConfig);

/**
 * Route protection: pages redirect to sign-in; API routes get a proper 401
 * JSON (clients shouldn't receive HTML). /api/auth (Auth.js), /api/cron
 * (Bearer CRON_SECRET guard inside the route), /api/plaid/webhook (called by
 * Plaid, not a logged-in user), the sign-in page, and static assets are excluded.
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
    // These two are anchored ($) + the dot escaped so /offline-* and /swXjs can't
    // skip auth via a prefix collision.
    '/((?!api/auth|api/cron|api/plaid/webhook|api/owner-connect|sign-in|offline$|sw\\.js$|_next/static|_next/image|favicon.ico|manifest|icon).*)',
  ],
};
