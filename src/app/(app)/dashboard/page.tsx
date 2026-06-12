import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { CashNeededCard } from '@/components/finance/cash-needed-card';
import { NetWorthCard } from '@/components/finance/net-worth-card';
import { buttonVariants } from '@/components/ui/button';
import { formatISODate, isoDate } from '@/lib/dates';
import { getDashboardData } from '@/server/finance';

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const data = await getDashboardData(session.user.id);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Demo data as of {formatISODate(isoDate(data.today), 'long')}
      </p>

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

      <NetWorthCard current={data.netWorthCents} trend={data.netWorthTrend} />
    </div>
  );
}
