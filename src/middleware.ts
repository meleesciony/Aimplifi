export { auth as middleware } from '@/auth';

// Protect everything except auth endpoints, the sign-in page, and static assets.
export const config = {
  matcher: ['/((?!api/auth|sign-in|_next/static|_next/image|favicon.ico|manifest).*)'],
};
