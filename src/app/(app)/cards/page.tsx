import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { CardsBreakdown } from '@/components/finance/cards-breakdown';
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
        <Card className="border-dashed" data-testid="cards-empty">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No credit cards yet. Add a card or connect a bank from the{' '}
            <a href="/accounts" className="underline hover:text-foreground">Accounts</a> page to get
            your “how much &amp; when to pay every card in full” plan here.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Credit cards</h1>
      {data.household?.hasPartners && (
        <HouseholdScopeToggle scope={data.scope} householdName={data.household.name} basePath="/cards" />
      )}
      <CardsBreakdown
        payInFull={data.payInFull}
        minimum={data.minimum}
        paymentAccountName={data.paymentAccountName}
        today={data.today}
        cardOwnerLabel={data.cardOwnerLabel}
      />
    </div>
  );
}
