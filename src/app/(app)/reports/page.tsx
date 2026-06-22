import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { ReportsView } from '@/components/finance/reports-view';
import { getReports } from '@/server/reports';
import { prisma } from '@/lib/db';

export default async function ReportsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  if ((await prisma.account.count({ where: { userId } })) === 0) return <EmptyDashboard />;

  const data = await getReports(userId);
  return <ReportsView data={data} />;
}
