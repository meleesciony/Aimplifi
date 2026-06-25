import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { SavingsRateCard } from '@/components/coach/savings-rate-card';
import { CashNeededCard } from '@/components/finance/cash-needed-card';
import { NetWorthCard } from '@/components/finance/net-worth-card';
import { PaymentRemindersCard } from '@/components/finance/payment-reminders-card';
import { RecurringSummaryCard } from '@/components/finance/recurring-summary-card';
import { AskAimplifiCard } from '@/components/finance/ask-aimplifi-card';
import { SafeToSpendCard } from '@/components/finance/safe-to-spend-card';
import { SpendingInsightsCard } from '@/components/finance/spending-insights-card';
import { TopSpendingCard } from '@/components/finance/top-spending-card';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { OnboardingNudge } from '@/components/settings/onboarding-nudge';
import { PAYMENT_ACCOUNT_TYPES, needsOnboarding } from '@/lib/engine/settings/dials';
import { prisma } from '@/lib/db';
import { getCoachData } from '@/server/coach';
import { getDashboardData } from '@/server/finance';
import { getRecurring } from '@/server/recurring';
import { getReports } from '@/server/reports';
import { getSpendingPlan } from '@/server/spending-plan';
import { getSpendingTrends } from '@/server/trends';

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');

  // Brand-new users have no accounts yet — the cash-needed engine needs some, so
  // show first-run onboarding instead of computing over nothing (DECISIONS #43).
  const accountCount = await prisma.account.count({ where: { userId: session.user.id } });
  if (accountCount === 0) return <EmptyDashboard />;

  const [data, coach, plan, reports, recurring, trends] = await Promise.all([
    getDashboardData(session.user.id),
    getCoachData(session.user.id),
    getSpendingPlan(session.user.id),
    getReports(session.user.id),
    getRecurring(session.user.id),
    getSpendingTrends(session.user.id),
  ]);

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

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Dashboard</h1>
      {/* THE answer — first thing on screen, zero navigation required */}
      <CashNeededCard
        result={data.payInFull}
        paymentAccountName={data.paymentAccountName}
        today={data.today}
        transferSource={transferSource}
      />

      {/* one-time setup nudge — only until a payment account is confirmed
          (dormant for the seeded demo user, who always has one) */}
      {showOnboarding && <OnboardingNudge />}

      {/* the flagship conversational surface — ask anything, grounded in your data */}
      <AskAimplifiCard />

      {/* at-a-glance summaries: this month's safe-to-spend + savings rate.
          Each links through to its full view (Plan / Coach). */}
      <div className="grid gap-4 sm:grid-cols-2">
        <SafeToSpendCard plan={plan} />
        <SavingsRateCard flows={coach.flows} currentRateBps={coach.currentRateBps} />
      </div>

      {/* net worth + trend, full width for the chart */}
      <NetWorthCard current={data.netWorthCents} trend={data.netWorthTrend} runwayMonths={coach.runwayMonths} />

      {/* spending analytics: this month's top categories + what changed (Trends) */}
      <div className="grid gap-4 sm:grid-cols-2">
        <TopSpendingCard breakdown={reports.breakdown} />
        <SpendingInsightsCard trends={trends} />
      </div>

      {/* monthly recurring / subscriptions (links to its view) */}
      <RecurringSummaryCard summary={recurring.summary} />

      {/* upcoming card payments (ROADMAP #6) — same obligations as the headline */}
      <PaymentRemindersCard reminders={data.reminders} today={data.today} />
    </div>
  );
}
