import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { Button } from '@/components/ui/button';
import { getReviewCount } from '@/server/triage';

async function ReviewBadge({ userId }: { userId: string }) {
  const count = await getReviewCount(userId);
  if (count === 0) return null;
  return (
    <span
      className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-semibold text-white"
      data-testid="review-badge"
    >
      {count}
    </span>
  );
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');

  async function doSignOut() {
    'use server';
    await signOut({ redirectTo: '/sign-in' });
  }

  return (
    <div className="mx-auto max-w-5xl px-3 pb-12 sm:px-6">
      <header className="flex items-center justify-between gap-2 py-3">
        <nav className="flex items-center gap-1 sm:gap-3" aria-label="Main">
          <Link href="/dashboard" className="mr-1 text-base font-bold tracking-tight sm:text-lg">
            Pulse<span className="text-emerald-500">Finance</span>
          </Link>
          <Link
            href="/dashboard"
            className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Dashboard
          </Link>
          <Link
            href="/cards"
            className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            data-testid="nav-cards"
          >
            Cards
          </Link>
          <Link
            href="/triage"
            className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            data-testid="nav-triage"
          >
            Review
            <ReviewBadge userId={session.user.id} />
          </Link>
          <Link
            href="/coach"
            className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            data-testid="nav-coach"
          >
            Coach
          </Link>
        </nav>
        <form action={doSignOut}>
          <Button variant="ghost" size="sm" type="submit">
            Sign out
          </Button>
        </form>
      </header>
      <main>{children}</main>
      <footer className="mt-10 border-t pt-4 text-xs text-muted-foreground">
        Pulse Finance is an educational tool, not financial advice. Projections
        state their assumptions; verify amounts with your card issuer before
        paying.
      </footer>
    </div>
  );
}
