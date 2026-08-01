import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { CashNeededCard } from '@/components/finance/cash-needed-card';
import { paintedHeroCards } from '@/lib/engine/account/card-duplicate-view';
import { dashboardCardIdentity } from '@/components/finance/card-identity-view';
import { CurrencyExclusionBanner } from '@/components/finance/currency-exclusion-banner';
import { FeedDroppedBanner } from '@/components/finance/feed-dropped-banner';
import { NetWorthCard } from '@/components/finance/net-worth-card';
import { CashFlowRadarCard } from '@/components/finance/cash-flow-radar-card';
import { SafeToSpendCard } from '@/components/finance/safe-to-spend-card';
import { StaleDataBanner } from '@/components/finance/stale-data-banner';
import { ConnectionAlertsCard } from '@/components/finance/connection-alerts-card';
import { HouseholdScopeToggle } from '@/components/dashboard/household-scope-toggle';
import { RecentTransactionsCard } from '@/components/dashboard/recent-transactions-card';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { StepIndicator } from '@/components/onboarding/step-indicator';
import { OnboardingNudge } from '@/components/settings/onboarding-nudge';
import { PAYMENT_ACCOUNT_TYPES, needsOnboarding } from '@/lib/engine/settings/dials';
import { prisma } from '@/lib/db';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { getCoachData } from '@/server/coach';
import { getDashboardData } from '@/server/finance';
import { getDashboardRecent } from '@/server/dashboard-recent';
import { getFeedDroppedAccounts, getWithheldAccountSummary } from '@/server/transactions';
import { getConnectionAlerts, getDataFreshness } from '@/server/connection-health';
import { getCashFlowRadar } from '@/server/radar';
import { getReturnMoment } from '@/server/return-moment';
import { ReturnMomentCard } from '@/components/dashboard/return-moment-card';
import { TodayFeedCard } from '@/components/dashboard/today-feed-card';
import { getNudgeDismissedKeys } from '@/server/nudge';
import { buildNudgeFeed } from '@/lib/engine/nudge/select';
import { getSpendingPlan } from '@/server/spending-plan';
import { frozenNothingDueRows } from '@/lib/engine/account/feed-dropped-view';

export const metadata = { title: "Dashboard" };

/**
 * Home composition (owner 2026-08-01 polish):
 *   1. Guilt-free this month (the IWT allocation)
 *   2. Recent transactions + needs-file highlight (categorization loop)
 *   3. Cash needed for cards (liquidity / timing — not a budget line)
 *   4. What needs you now + health banners
 * Analytics (Ask, top spending, trends, recurring, reminders, savings rate)
 * live on their own routes — not stacked here as clutter.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');

  const accountCount = await prisma.account.count({ where: { userId: session.user.id, OR: [{ currency: null }, { currency: 'USD' }] } });
  if (accountCount === 0) return <EmptyDashboard />;

  const requestedScope = (await searchParams).scope === 'household' ? 'household' : 'mine';

  const [data, coach, plan, recent, withheld, feedDropped, freshness, connectionAlerts, radar, nudgeDismissedKeys] =
    await Promise.all([
      getDashboardData(session.user.id, requestedScope),
      getCoachData(session.user.id),
      getSpendingPlan(session.user.id),
      getDashboardRecent(session.user.id),
      getWithheldAccountSummary(session.user.id),
      getFeedDroppedAccounts(session.user.id),
      getDataFreshness(session.user.id),
      getConnectionAlerts(session.user.id),
      getCashFlowRadar(session.user.id),
      getNudgeDismissedKeys(session.user.id),
    ]);

  const frozenDueRows = frozenNothingDueRows({
    cards: [...data.payInFull.cards, ...data.payInFull.unknownDueDateCards],
    loans: data.loanObligations,
    undatableLoans: data.undatableFrozenLoans,
    partnerLabel: data.accountOwnerLabel,
  });
  const nudgeInput = {
    today: radar.radar.today,
    reminders: data.reminders,
    radar: radar.radar,
    cashNeeded: data.payInFull,
    opportunities: coach.opportunities,
    unusualCharges: coach.unusualCharges,
    incomePauses: coach.incomePauses,
    runwayMonths: coach.runwayMonths,
    paymentAccountName: data.paymentAccountName,
    frozenDues: frozenDueRows,
  } as const;
  const nudgeFeed = buildNudgeFeed({ ...nudgeInput, dismissedKeys: nudgeDismissedKeys });
  const nudgeFeedAll = buildNudgeFeed({ ...nudgeInput, dismissedKeys: new Set<string>() });

  const returnMoment = await getReturnMoment(session.user.id, {
    today: radar.radar.today,
    review: coach.review,
    opportunities: coach.opportunities,
    radar: radar.radar,
  });

  const eligiblePaymentAccountIds = data.accounts
    .filter((a) => (PAYMENT_ACCOUNT_TYPES as readonly string[]).includes(a.type))
    .map((a) => a.id);
  const showOnboarding = needsOnboarding(
    { paymentAccountId: data.paymentAccountId },
    eligiblePaymentAccountIds,
  );

  const transferSource =
    data.accounts
      .filter((a) => a.type === 'SAVINGS')
      .sort((a, b) => b.currentBalanceCents - a.currentBalanceCents)
      .map((a) => ({ name: a.name, balanceCents: a.currentBalanceCents }))[0] ?? null;

  const cardIdentity = dashboardCardIdentity(
    [
      ...paintedHeroCards(data.payInFull).map((c) => ({ cardId: c.cardId, cardName: c.cardName })),
      ...data.reminders
        .filter((r) => r.obligationType === 'card')
        .map((r) => ({ cardId: r.accountId, cardName: r.accountName })),
    ],
    data.cardMask,
  );

  return (
    <div className="space-y-5">
      <h1 className="sr-only">Dashboard</h1>
      {showOnboarding && (
        <div className="space-y-0.5">
          <StepIndicator step={2} />
          <p className="text-xs text-muted-foreground">
            Using our best guess for which account pays your cards — confirm it below.
          </p>
        </div>
      )}
      {data.household?.hasPartners && (
        <HouseholdScopeToggle
          scope={data.scope}
          householdName={data.household.name}
          basePath="/dashboard"
          withheldCount={data.householdWithheldCount}
          duplicates={data.householdDuplicates}
        />
      )}

      {/* 1. Monthly allocation — income − savings dial − fixed */}
      <SafeToSpendCard plan={plan} disclosures={plan.disclosures} />

      {/* 2. Liquidity — cash for cards when due (not a guilt-free subtraction) */}
      <CashNeededCard
        result={data.payInFull}
        paymentAccountName={data.paymentAccountName}
        today={data.today}
        transferSource={transferSource}
        householdName={data.scope === 'household' ? data.household?.name ?? null : null}
        accountOwnerLabel={data.accountOwnerLabel}
        cardDuplicates={data.cardDuplicates}
        cardIdentity={cardIdentity}
      />

      {/* 3. Categorization loop — recent rows, needs-file highlighted */}
      <RecentTransactionsCard recent={recent} />

      <TodayFeedCard
        feed={nudgeFeed}
        feedAll={nudgeFeedAll}
        canManageIncomePause={session.user.id !== DEMO_USER_ID}
      />

      {returnMoment && <ReturnMomentCard moment={returnMoment} />}

      <CurrencyExclusionBanner summary={withheld} />
      <FeedDroppedBanner accounts={feedDropped} householdFrozenCount={data.householdFeedDroppedCount} />
      <StaleDataBanner summary={freshness} />
      <ConnectionAlertsCard alerts={connectionAlerts} />

      {showOnboarding && <OnboardingNudge />}

      <CashFlowRadarCard radar={radar.radar} paymentAccountName={radar.paymentAccountName} />

      <NetWorthCard current={data.netWorthCents} trend={data.netWorthTrend} runwayMonths={coach.runwayMonths} />
    </div>
  );
}
