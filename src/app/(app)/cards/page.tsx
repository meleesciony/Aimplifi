import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { CardsBreakdown } from '@/components/finance/cards-breakdown';
import { ConnectAccountsButton } from '@/components/finance/connect-accounts-button';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { HouseholdScopeToggle } from '@/components/dashboard/household-scope-toggle';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { prisma } from '@/lib/db';
import { getDashboardData } from '@/server/finance';

export const metadata = { title: "Credit cards" };

export default async function CardsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  // No accounts yet → first-run onboarding (the cash-needed engine needs accounts).
  if ((await prisma.account.count({ where: { userId: session.user.id, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyDashboard />;

  // Household scope toggle (TASKS 4.2 slice 5) — same searchParam contract as
  // /dashboard: getDashboardData re-derives the EFFECTIVE scope (falls back to
  // 'mine' without live partners), so a stale `?scope=household` link never errors.
  const requestedScope = (await searchParams).scope === 'household' ? 'household' : 'mine';
  const data = await getDashboardData(session.user.id, requestedScope);

  if (data.payInFull.cards.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Credit cards</h1>
        {data.household?.hasPartners && (
          <HouseholdScopeToggle scope={data.scope} householdName={data.household.name} basePath="/cards" />
        )}
        {/* 2026-07-21 agent review A1: don't dead-end to /accounts — offer the real
            connect/add affordances inline. Plaid's button is self-contained (token
            minted on click); SimpleFIN connect stays on /accounts, where its
            connection state is actually known. */}
        <Card className="border-dashed" data-testid="cards-empty">
          <CardContent className="space-y-4 py-8 text-sm text-muted-foreground">
            <p className="text-center">
              No credit cards yet. Connect the bank that issues your card — or add it
              manually — to get your “how much &amp; when to pay every card in full” plan here.
            </p>
            <div className="mx-auto flex max-w-sm flex-col items-stretch gap-2">
              <ConnectAccountsButton />
              <div className="flex flex-col gap-2 sm:flex-row">
                <Link
                  href="/accounts"
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  data-testid="cards-empty-manual"
                >
                  Add a card manually
                </Link>
                <Link
                  href="/transactions/import"
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  data-testid="cards-empty-import"
                >
                  Import a CSV
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Credit cards</h1>
      {data.household?.hasPartners && (
        <HouseholdScopeToggle
          scope={data.scope}
          householdName={data.household.name}
          basePath="/cards"
          withheldCount={data.householdWithheldCount}
          duplicates={data.householdDuplicates}
        />
      )}
      <CardsBreakdown
        payInFull={data.payInFull}
        minimum={data.minimum}
        paymentAccountName={data.paymentAccountName}
        today={data.today}
        accountOwnerLabel={data.accountOwnerLabel}
        householdName={data.scope === 'household' ? data.household?.name ?? null : null}
      />
    </div>
  );
}
