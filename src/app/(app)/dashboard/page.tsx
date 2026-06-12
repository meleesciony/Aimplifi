import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { SavingsRateCard } from '@/components/coach/savings-rate-card';
import { CashNeededCard } from '@/components/finance/cash-needed-card';
import { NetWorthCard } from '@/components/finance/net-worth-card';
import { getCoachData } from '@/server/coach';
import { getDashboardData } from '@/server/finance';

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const [data, coach] = await Promise.all([
    getDashboardData(session.user.id),
    getCoachData(session.user.id),
  ]);

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

      {/* headline parity: net worth and savings rate side by side */}
      <div className="grid gap-4 sm:grid-cols-2">
        <NetWorthCard current={data.netWorthCents} trend={data.netWorthTrend} />
        <SavingsRateCard flows={coach.flows} currentRateBps={coach.currentRateBps} />
      </div>
    </div>
  );
}
