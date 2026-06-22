import { redirect } from 'next/navigation';
import { DEMO_USER_ID, auth, signOut } from '@/auth';
import { AppNav } from '@/components/app-nav';
import { Button } from '@/components/ui/button';
import { formatISODate, isoDate } from '@/lib/dates';
import { getProvider } from '@/lib/providers/demo';
import { getReviewCount } from '@/server/triage';

async function ReviewBadge({ userId }: { userId: string }) {
  const count = await getReviewCount(userId);
  if (count === 0) return null;
  return (
    <span
      className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-800 px-1 text-[10px] font-semibold text-white"
      data-testid="review-badge"
    >
      {count}
    </span>
  );
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const today = getProvider().today(session.user.id);
  // The "demo dataset" banner is about fictional data — true only for the demo
  // user, not real signed-up accounts (DECISIONS #43).
  const isDemo = session.user.id === DEMO_USER_ID;

  async function doSignOut() {
    'use server';
    await signOut({ redirectTo: '/sign-in' });
  }

  return (
    <div className="mx-auto max-w-5xl px-3 pb-20 sm:px-6 sm:pb-12">
      <header className="flex items-center justify-between gap-2 py-3">
        <AppNav reviewBadge={<ReviewBadge userId={session.user.id} />} />
        <form action={doSignOut}>
          <Button variant="ghost" size="sm" type="submit">
            Sign out
          </Button>
        </form>
      </header>
      {isDemo && (
        <p className="mb-3 text-xs text-muted-foreground" data-testid="demo-banner">
          Demo dataset · fictional accounts · as of {formatISODate(isoDate(today), 'long')}
        </p>
      )}
      <main>{children}</main>
      <footer className="mt-10 border-t pt-4 text-xs text-muted-foreground">
        Aimplifi is an educational tool, not financial advice. Projections
        state their assumptions; verify amounts with your card issuer before
        paying.
      </footer>
    </div>
  );
}
