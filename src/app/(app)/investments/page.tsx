import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { InvestmentsView } from '@/components/finance/investments-view';
import { getInvestments } from '@/server/investments';
import { prisma } from '@/lib/db';

export const metadata = { title: 'Investments' };

export default async function InvestmentsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  if ((await prisma.account.count({ where: { userId } })) === 0) return <EmptyDashboard />;

  const data = await getInvestments();
  return <InvestmentsView data={data} />;
}
