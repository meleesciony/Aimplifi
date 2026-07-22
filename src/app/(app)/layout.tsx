import { redirect } from 'next/navigation';
import { DEMO_USER_ID, auth, signOut } from '@/auth';
import { AppNav } from '@/components/app-nav';
import { AutoSync } from '@/components/auto-sync';
import { Button } from '@/components/ui/button';
import { formatISODate, isoDate } from '@/lib/dates';
import { prisma } from '@/lib/db';
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
  // Auto-sync on load is only meaningful for a user with a live bank connection;
  // a cheap indexed lookup gates the client component so demo/manual-only users
  // never fire a background sync (DECISIONS #91).
  const hasSimplefin =
    (await prisma.simpleFinConnection.findUnique({
      where: { userId: session.user.id },
      select: { userId: true },
    })) !== null;

  async function doSignOut() {
    'use server';
    await signOut({ redirectTo: '/sign-in' });
  }

  return (
    <div className="pb-bottom-nav mx-auto max-w-5xl px-4 sm:px-6">
      <AutoSync enabled={hasSimplefin} />
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>
      {/* sticky glass header on desktop; on phones it stays static (the fixed
          bottom tab bar is the primary nav there, and a sticky top bar trips a
          mobile scroll-into-view quirk) */}
      {/* items-center on phones (brand + More + Sign out on one row); items-start
          on sm+ so a wrapped link row doesn't vertically center Sign out into it.
          Sign-out shrink-0: never share width with the 13 desktop text links (#188). */}
      <header className="-mx-4 flex items-center justify-between gap-3 border-b bg-background px-4 py-3 sm:sticky sm:top-0 sm:z-30 sm:items-start sm:-mx-6 sm:bg-background/80 sm:px-6 sm:backdrop-blur sm:supports-[backdrop-filter]:bg-background/60">
        <AppNav reviewBadge={<ReviewBadge userId={session.user.id} />} />
        <form action={doSignOut} className="shrink-0 sm:pt-0.5" data-testid="sign-out-form">
          <Button variant="ghost" size="sm" type="submit">
            Sign out
          </Button>
        </form>
      </header>
      {isDemo && (
        <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground" data-testid="demo-banner">
          <span className="inline-block size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
          Demo dataset · fictional accounts · as of {formatISODate(isoDate(today), 'long')}
        </p>
      )}
      <main id="content" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <footer className="mt-10 border-t pt-4 text-xs text-muted-foreground">
        Aimplifi is an educational tool, not financial advice. Projections
        state their assumptions; verify amounts with your card issuer before
        paying.
      </footer>
    </div>
  );
}
