import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { SavingsRateCard } from '@/components/coach/savings-rate-card';
import { CashNeededCard } from '@/components/finance/cash-needed-card';
import { NetWorthCard } from '@/components/finance/net-worth-card';
import { buttonVariants } from '@/components/ui/button';
import { getCoachData } from '@/server/coach';
import { getDashboardData } from '@/server/finance';

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const [data, coach] = await Promise.all([
    getDashboardData(session.user.id),
    getCoachData(session.user.id),
  ]);

  return (
    <div className="space-y-4">
      {/* THE answer — first thing on screen, zero navigation required */}
      <CashNeededCard result={data.payInFull} paymentAccountName={data.paymentAccountName} />

      <div className="flex justify-end">
        <Link
          href="/cards"
          data-testid="see-card-breakdown"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          Per-card breakdown →
        </Link>
      </div>

      {/* headline parity: net worth and savings rate side by side */}
      <div className="grid gap-4 sm:grid-cols-2">
        <NetWorthCard current={data.netWorthCents} trend={data.netWorthTrend} />
        <SavingsRateCard flows={coach.flows} currentRateBps={coach.currentRateBps} />
      </div>
    </div>
  );
}
