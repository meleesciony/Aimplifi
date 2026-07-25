import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { SavingsRateCard } from '@/components/coach/savings-rate-card';
import { CashNeededCard } from '@/components/finance/cash-needed-card';
import { paintedHeroCards } from '@/lib/engine/account/card-duplicate-view';
import { dashboardCardIdentity } from '@/components/finance/card-identity-view';
import { CurrencyExclusionBanner } from '@/components/finance/currency-exclusion-banner';
import { FeedDroppedBanner } from '@/components/finance/feed-dropped-banner';
import { NetWorthCard } from '@/components/finance/net-worth-card';
import { PaymentRemindersCard } from '@/components/finance/payment-reminders-card';
import { RecurringSummaryCard } from '@/components/finance/recurring-summary-card';
import { AskAimplifiCard } from '@/components/finance/ask-aimplifi-card';
import { CashFlowRadarCard } from '@/components/finance/cash-flow-radar-card';
import { SafeToSpendCard } from '@/components/finance/safe-to-spend-card';
import { SpendingInsightsCard } from '@/components/finance/spending-insights-card';
import { StaleDataBanner } from '@/components/finance/stale-data-banner';
import { ConnectionAlertsCard } from '@/components/finance/connection-alerts-card';
import { TopSpendingCard } from '@/components/finance/top-spending-card';
import { HouseholdScopeToggle } from '@/components/dashboard/household-scope-toggle';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { StepIndicator } from '@/components/onboarding/step-indicator';
import { OnboardingNudge } from '@/components/settings/onboarding-nudge';
import { PAYMENT_ACCOUNT_TYPES, needsOnboarding } from '@/lib/engine/settings/dials';
import { undatedCardsWithBalance } from '@/lib/engine/cash-needed/types';
import { prisma } from '@/lib/db';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { getCoachData } from '@/server/coach';
import { getDashboardData } from '@/server/finance';
import { getFeedDroppedAccounts, getWithheldAccountSummary } from '@/server/transactions';
import { getConnectionAlerts, getDataFreshness } from '@/server/connection-health';
import { getCashFlowRadar } from '@/server/radar';
import { getRecurring } from '@/server/recurring';
import { getReturnMoment } from '@/server/return-moment';
import { ReturnMomentCard } from '@/components/dashboard/return-moment-card';
import { TodayFeedCard } from '@/components/dashboard/today-feed-card';
import { getNudgeDismissedKeys } from '@/server/nudge';
import { buildNudgeFeed } from '@/lib/engine/nudge/select';
import { getReports } from '@/server/reports';
import { getSpendingPlan } from '@/server/spending-plan';
import { getSpendingTrends } from '@/server/trends';

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');

  // Brand-new users have no accounts yet — the cash-needed engine needs some, so
  // show first-run onboarding instead of computing over nothing (DECISIONS #43).
  const accountCount = await prisma.account.count({ where: { userId: session.user.id, OR: [{ currency: null }, { currency: 'USD' }] } });
  if (accountCount === 0) return <EmptyDashboard />;

  // Joint cash-needed scope toggle (TASKS 4.2 slice 4) — a plain searchParam so
  // the toggle is a Link, no client JS. `getDashboardData` re-derives the
  // EFFECTIVE scope (falls back to 'mine' without live partners), so a stale
  // `?scope=household` link never errors, just silently degenerates.
  const requestedScope = (await searchParams).scope === 'household' ? 'household' : 'mine';

  const [data, coach, plan, reports, recurring, trends, withheld, feedDropped, freshness, connectionAlerts, radar, nudgeDismissedKeys] = await Promise.all([
    getDashboardData(session.user.id, requestedScope),
    getCoachData(session.user.id),
    getSpendingPlan(session.user.id),
    getReports(session.user.id),
    getRecurring(session.user.id),
    getSpendingTrends(session.user.id),
    getWithheldAccountSummary(session.user.id),
    getFeedDroppedAccounts(session.user.id),
    getDataFreshness(session.user.id),
    getConnectionAlerts(session.user.id),
    getCashFlowRadar(session.user.id),
    getNudgeDismissedKeys(session.user.id),
  ]);

  // "Today" nudge feed (NUDGE_PLAN slice 2): a ranked digest built by the pure
  // buildNudgeFeed engine over the SAME source rows the cards below already show —
  // no re-fetch, no new money math. `feed` applies the user's persisted dismissals;
  // `feedAll` (empty dismissedKeys) is what the card's "show everything" reveals. The
  // dismissed set feeds ONLY buildNudgeFeed — never selectPaymentReminders' upstream
  // filter (which the dashboard/cron call with no dismissedKeys), so a push candidate
  // can never be dropped from the feed's input (NUDGE_PLAN slice-2 guardrail).
  const nudgeInput = {
    today: radar.radar.today,
    reminders: data.reminders,
    radar: radar.radar,
    cashNeeded: data.payInFull,
    opportunities: coach.opportunities,
    // Unusual Charge Radar (#249): per-merchant median+MAD flags computed inside
    // getCoachData over the same fetched rows — verbatim into the feed.
    unusualCharges: coach.unusualCharges,
    // Income-Pause Radar (#251): lapsed income series (confirmed pauses already
    // filtered inside getCoachData) + the coach's own runway figure, both verbatim —
    // the runway rides along as display context for the income_pause copy only.
    incomePauses: coach.incomePauses,
    runwayMonths: coach.runwayMonths,
  } as const;
  const nudgeFeed = buildNudgeFeed({ ...nudgeInput, dismissedKeys: nudgeDismissedKeys });
  const nudgeFeedAll = buildNudgeFeed({ ...nudgeInput, dismissedKeys: new Set<string>() });

  // Return moment (TASKS 1.1): "since you were away" greeting for a user back after
  // a >7-day gap. Composes ALREADY-fetched pieces (coach review + opportunities,
  // radar) — no re-fetch, no new money math — and stamps today as last-seen. Null
  // (no card) for first visits, active users, and the fixed-today demo user.
  const returnMoment = await getReturnMoment(session.user.id, {
    today: radar.radar.today,
    review: coach.review,
    opportunities: coach.opportunities,
    radar: radar.radar,
  });

  // Single source of truth: the dashboard snapshot already carries the stored
  // payment-account id and every account, so the nudge needs no extra read.
  // A stored id that no longer maps to an owned checking/savings account
  // (deleted/ineligible) re-fires onboarding instead of silently falling back.
  const eligiblePaymentAccountIds = data.accounts
    .filter((a) => (PAYMENT_ACCOUNT_TYPES as readonly string[]).includes(a.type))
    .map((a) => a.id);
  const showOnboarding = needsOnboarding(
    { paymentAccountId: data.paymentAccountId },
    eligiblePaymentAccountIds,
  );

  // the real account the transfer advice can draw from (largest savings balance)
  const transferSource =
    data.accounts
      .filter((a) => a.type === 'SAVINGS')
      .sort((a, b) => b.currentBalanceCents - a.currentBalanceCents)
      .map((a) => ({ name: a.name, balanceCents: a.currentBalanceCents }))[0] ?? null;

  // ONE identity pass for the whole page (TASKS L.8). The cash-needed hero and the payment
  // reminders below it both name cards, and `cardIdentityLabels` numbers by position in the list it
  // is given — so a pass per component numbers each from 1 and "1." means a different account in
  // the two cards. That is the #299 residual, which a fresh-context critic reproduced here across
  // components rather than sections. Order is the page's own: the hero's cards, then any reminder
  // row it did not already cover.
  //
  // CARD rows only. A loan reminder carries a real `Account.mask`, but the module's fallback string
  // is "no card number on file", which on a mortgage row is the wrong noun.
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
      {/* THE answer — first thing on screen, zero navigation required. Step 2 of the
          guided first-run flow (Gap 3 §3) for a user who hasn't confirmed a payment
          account yet — the SAME showOnboarding gate as OnboardingNudge below (which
          is Step 3), so the two badges always agree on whether onboarding is still
          open AND read in numeric order top-to-bottom (critic-caught: numbering this
          "3" read backwards above a "Step 2" nudge that renders below it). The number
          itself is never fabricated (resolvePaymentAccount always grounds it in a
          real account), but which account is a best guess until Step 3 confirms it —
          stated inline per the coaching guardrail, not left implicit. */}
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

      {/* "Today" nudge feed (NUDGE_PLAN slice 2) — the one thing that needs you now,
          ranked, with a collapsed rest and everything autopay handles kept quiet. A
          reshape of the cards below; detail still lives in each source card. */}
      <TodayFeedCard
        feed={nudgeFeed}
        feedAll={nudgeFeedAll}
        canManageIncomePause={session.user.id !== DEMO_USER_ID}
      />

      {/* "Since you were away" greeting (TASKS 1.1) — sits right under THE answer.
          Present only for a genuine return (>7-day gap); silent otherwise. */}
      {returnMoment && <ReturnMomentCard moment={returnMoment} />}

      {/* currency-guard disclosure (#135 residual): withheld non-USD accounts must not
          vanish silently. Renders nothing for all-USD users (the overwhelming case). */}
      <CurrencyExclusionBanner summary={withheld} />

      {/* TASKS L.14 — an account whose bank has stopped sharing it. Its last balance is STILL in
          every figure on this page, deliberately (only the user knows whether the account still
          exists), so the one thing that must not happen is silence. Renders nothing when no
          account is affected, which is every demo and every healthy user. */}
      <FeedDroppedBanner accounts={feedDropped} householdFrozenCount={data.householdFeedDroppedCount} />

      {/* linked-feed staleness heads-up (Gap 1 §3–4): shows only when the auto-synced
          feed has gone quiet. Silent for fresh feeds, manual-only, and the demo user. */}
      <StaleDataBanner summary={freshness} />

      {/* broken-connection alert (Gap 1 §4): a sync that actually FAILED — more urgent
          than staleness, so it sits here at the top. Driven only by a persisted failure
          signal, so it's silent for healthy feeds and the demo user (never a false alarm). */}
      <ConnectionAlertsCard alerts={connectionAlerts} />

      {/* one-time setup nudge — only until a payment account is confirmed
          (dormant for the seeded demo user, who always has one) */}
      {showOnboarding && <OnboardingNudge />}

      {/* Cash Flow Radar (Gap 2 §1): the forward warning system — committed-only
          90-day walk, first dip, colliding card, minimum timed cover-transfer */}
      <CashFlowRadarCard radar={radar.radar} paymentAccountName={radar.paymentAccountName} />

      {/* the flagship conversational surface — ask anything, grounded in your data */}
      <AskAimplifiCard />

      {/* at-a-glance summaries: this month's safe-to-spend + savings rate.
          Each links through to its full view (Plan / Coach). */}
      <div className="grid gap-5 sm:grid-cols-2">
        <SafeToSpendCard plan={plan} />
        <SavingsRateCard flows={coach.flows} currentRateBps={coach.currentRateBps} />
      </div>

      {/* net worth + trend, full width for the chart */}
      <NetWorthCard current={data.netWorthCents} trend={data.netWorthTrend} runwayMonths={coach.runwayMonths} />

      {/* spending analytics: this month's top categories + what changed (Trends) */}
      <div className="grid gap-5 sm:grid-cols-2">
        <TopSpendingCard breakdown={reports.breakdown} />
        <SpendingInsightsCard trends={trends} />
      </div>

      {/* monthly recurring / subscriptions (links to its view) */}
      <RecurringSummaryCard summary={recurring.summary} />

      {/* upcoming card payments (ROADMAP #6) — same obligations as the headline.
          accountOwnerLabel (slice-8 critic F-1): at household scope a partner's
          card/loan renders owner-attributed, never "you pay". */}
      <PaymentRemindersCard
        reminders={data.reminders}
        today={data.today}
        accountOwnerLabel={data.accountOwnerLabel}
        undatedCardCount={undatedCardsWithBalance(data.payInFull).length}
        cardDuplicates={data.cardDuplicates}
        cardIdentity={cardIdentity}
      />
    </div>
  );
}
