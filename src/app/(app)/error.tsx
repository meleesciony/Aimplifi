'use client';

/**
 * App-segment error boundary. Catches any render-time throw in an authenticated
 * route (e.g. a server-component data error) and degrades to a recoverable,
 * styled screen instead of a raw 500 — keeping demo mode first-class. The most
 * concrete case: after "delete my data" in demo, signing back in lands on a
 * dashboard with no accounts; this offers a clear recovery path (reseed) rather
 * than a crash. (redirect()/signOut() throws are control flow, not errors, and
 * are not caught here.)
 */
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md space-y-4 py-12 text-center" data-testid="app-error">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        This page couldn&apos;t load. Try again, or sign in again — if it keeps happening, please reach
        out for help.
      </p>
      <div className="flex justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
          data-testid="app-error-retry"
        >
          Try again
        </button>
        <Link href="/sign-in" className={buttonVariants({ size: 'sm' })}>
          Sign in
        </Link>
      </div>
    </div>
  );
}
