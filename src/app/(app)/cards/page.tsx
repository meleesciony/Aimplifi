import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { CardsBreakdown } from '@/components/finance/cards-breakdown';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { prisma } from '@/lib/db';
import { getDashboardData } from '@/server/finance';

export default async function CardsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  // No accounts yet → first-run onboarding (the cash-needed engine needs accounts).
  if ((await prisma.account.count({ where: { userId: session.user.id } })) === 0) return <EmptyDashboard />;
  const data = await getDashboardData(session.user.id);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Credit cards</h1>
      <CardsBreakdown
        payInFull={data.payInFull}
        minimum={data.minimum}
        paymentAccountName={data.paymentAccountName}
        today={data.today}
      />
    </div>
  );
}
