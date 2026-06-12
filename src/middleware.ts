import { NextResponse } from 'next/server';
import { auth } from '@/auth';

/**
 * Route protection: pages redirect to sign-in; API routes get a proper 401
 * JSON (clients shouldn't receive HTML). /api/auth (Auth.js), /api/cron
 * (Bearer CRON_SECRET guard inside the route), the sign-in page, and static
 * assets are excluded.
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
    '/((?!api/auth|api/cron|sign-in|_next/static|_next/image|favicon.ico|manifest|icon).*)',
  ],
};
