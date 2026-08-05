import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { cents, formatCents } from '@/lib/money';
import { SavingsRateCard } from '@/components/coach/savings-rate-card';
import { CashNeededCard } from '@/components/finance/cash-needed-card';
import { paintedHeroCards } from '@/lib/engine/account/card-duplicate-view';
import { dashboardCardIdentity } from '@/components/finance/card-identity-view';
import { CurrencyExclusionBanner } from '@/components/finance/currency-exclusion-banner';
import { FeedDroppedBanner } from '@/components/finance/feed-dropped-banner';
import { NetWorthCard } from '@/components/finance/net-worth-card';
import { CashFlowRadarCard } from '@/components/finance/cash-flow-radar-card';
import { SafeToSpendCard } from '@/components/finance/safe-to-spend-card';
import { SpendingInsightsCard } from '@/components/finance/spending-insights-card';
import { StaleDataBanner } from '@/components/finance/stale-data-banner';
import { ConnectionAlertsCard } from '@/components/finance/connection-alerts-card';
import { TopSpendingCard } from '@/components/finance/top-spending-card';
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
import { eligibleTransferSources } from '@/lib/engine/radar/radar';
import { getReturnMoment } from '@/server/return-moment';
import { ReturnMomentCard } from '@/components/dashboard/return-moment-card';
import { TodayFeedCard } from '@/components/dashboard/today-feed-card';
import { getNudgeDismissedKeys } from '@/server/nudge';
import { buildNudgeFeed } from '@/lib/engine/nudge/select';
import { getReports } from '@/server/reports';
import { getSpendingPlan } from '@/server/spending-plan';
import { getSpendingTrends } from '@/server/trends';
import { frozenNothingDueRows } from '@/lib/engine/account/feed-dropped-view';

export const metadata = { title: "Dashboard" };

/**
 * Home (owner 2026-08-01 polish, revised): guilt-free + cash needed + recent
 * activity first; keep the useful charts (top spending, trends, savings rate,
 * net worth). Cut verbose coaching copy and menu-redundant reminder stacks —
 * not the visualizations.
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

  const [data, coach, plan, recent, reports, trends, withheld, feedDropped, freshness, connectionAlerts, radar, nudgeDismissedKeys] =
    await Promise.all([
      getDashboardData(session.user.id, requestedScope),
      getCoachData(session.user.id),
      getSpendingPlan(session.user.id),
      getDashboardRecent(session.user.id),
      getReports(session.user.id),
      getSpendingTrends(session.user.id),
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
    // C.9 (#405) — the runway's average expenses divide by the REAL window; the
    // income-pause line's basis sentence names it. Verbatim from the coach.
    runwayWindowMonths: coach.fi.monthlySavingsMonths,
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

  // C.7 (CALC_AUDIT P0-2): this used to filter on `type === 'SAVINGS'` and sort
  // by balance, applying NONE of the four guards `radar.ts` applies on this very
  // page — so a frozen account, whose stale balance reads high and therefore
  // sorts first, could be named inside "Transfer $X from <name> ($Y available)".
  // The eligible-source rule now has one home and this surface obtains it there.
  // A frozen account withheld here is not withheld silently: `FeedDroppedBanner`
  // names every dropped account on this same page (invariant D9).
  const transferSource =
    eligibleTransferSources(data.accounts, data.paymentAccountId).map((a) => ({
      name: a.name,
      balanceCents: a.currentBalanceCents,
    }))[0] ?? null;

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

      <SafeToSpendCard plan={plan} disclosures={plan.disclosures} />

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

      {/* C.25 (#403, critic P2-B): the savings-rate, top-spending and pace
          cards below all read flows the exclusion moved — name what left, or
          say nothing when nothing did. Same words /coach uses (one helper). */}
      {coach.loanPaymentExclusions.map((e, i) => (
        <p key={`${e.payee}:${e.loanName}:${e.paymentCents}:${i}`} className="text-xs text-muted-foreground" data-testid="dashboard-loan-payment-basis">
          Payments to {e.payee} at {formatCents(cents(e.paymentCents))}/mo are counted on{' '}
          {e.loanName}, not in these cards — loan payments are not spending. A payment at
          another amount counts normally.
        </p>
      ))}

      {/* Charts + savings dial — keep; cut redundant how-to, not visualizations. */}
      <div className="grid gap-5 sm:grid-cols-2">
        <SavingsRateCard
          flows={coach.flows}
          currentRateBps={coach.currentRateBps}
          monthFlows={coach.monthFlows}
        />
        <TopSpendingCard
          breakdown={reports.breakdown}
          breakdowns={reports.breakdowns}
          ym={reports.ym}
          notCountedYetCents={reports.notCountedYetCents}
        />
      </div>

      <SpendingInsightsCard trends={trends} />

      <NetWorthCard current={data.netWorthCents} trend={data.netWorthTrend} runwayMonths={coach.runwayMonths} />
    </div>
  );
}
