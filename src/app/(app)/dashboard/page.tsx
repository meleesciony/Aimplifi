import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { SavingsRateCard } from '@/components/coach/savings-rate-card';
import { CashNeededCard } from '@/components/finance/cash-needed-card';
import { NetWorthCard } from '@/components/finance/net-worth-card';
import { OnboardingNudge } from '@/components/settings/onboarding-nudge';
import { PAYMENT_ACCOUNT_TYPES, needsOnboarding } from '@/lib/engine/settings/dials';
import { getCoachData } from '@/server/coach';
import { getDashboardData } from '@/server/finance';

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const [data, coach] = await Promise.all([
    getDashboardData(session.user.id),
    getCoachData(session.user.id),
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

      {/* headline parity: net worth and savings rate side by side */}
      <div className="grid gap-4 sm:grid-cols-2">
        <NetWorthCard current={data.netWorthCents} trend={data.netWorthTrend} />
        <SavingsRateCard flows={coach.flows} currentRateBps={coach.currentRateBps} />
      </div>
    </div>
  );
}
