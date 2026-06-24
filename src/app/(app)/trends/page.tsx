import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { TrendsView } from '@/components/finance/trends-view';
import { getSpendingTrends } from '@/server/trends';
import { prisma } from '@/lib/db';

export const metadata = { title: "Trends" };

export default async function TrendsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  if ((await prisma.account.count({ where: { userId } })) === 0) return <EmptyDashboard />;

  const trends = await getSpendingTrends(userId);
  return <TrendsView trends={trends} />;
}
