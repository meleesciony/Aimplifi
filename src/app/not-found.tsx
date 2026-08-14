import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

/**
 * Root 404 boundary (DECISIONS #157). Next serves this for any unmatched URL.
 * Unlike global-error.tsx (which replaces the root layout on a root-layout crash
 * and must inline its styles), not-found.tsx renders INSIDE the root layout, so
 * globals.css + the dark theme + fonts are loaded and it can use Tailwind + the
 * app tokens exactly like (app)/error.tsx. Completes the error chrome:
 * global-error.tsx = root crash, (app)/error.tsx = in-shell render throw, this =
 * 404. Branded, with one clear recovery to /dashboard. Reachability: middleware
 * redirects an unauthenticated visitor to /sign-in for MOST unmatched paths, so an
 * authed user is the usual reacher; a few paths under an unanchored middleware
 * exclusion prefix (those beginning "icon", "manifest", or "favicon.ico") skip
 * middleware and render this 404 directly with no session — the /dashboard
 * recovery still works for them
 * (middleware then routes an unauthed click on to /sign-in). A single CTA is
 * deliberate: "Go to dashboard" is right for the common authed reacher and
 * redirects gracefully for the rare unauthed/expired one, so no "Sign in" link
 * (which would confuse a signed-in user) is added. There are no notFound() callers
 * today, so this only fires on a genuinely unmatched path — no (app)/not-found.tsx
 * is needed (a segment-level one would only matter if a route called notFound()).
 */
export const metadata: Metadata = {
  title: 'Page not found',
};

export default function NotFound() {
  return (
    <main
      className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
      data-testid="not-found"
    >
      <p className="text-lg font-bold tracking-tight">
        Aim<span className="text-brand-500">plifi</span>
      </p>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t find that page. It may have moved, or the link might be out of date.
      </p>
      <Link
        href="/dashboard"
        className={buttonVariants({ size: 'sm' })}
        data-testid="not-found-home"
      >
        Go to dashboard
      </Link>
    </main>
  );
}
