import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { InvestmentsView } from '@/components/finance/investments-view';
import { getInvestments, getRetirementOutlook } from '@/server/investments';
import { getWithheldAccountSummary } from '@/server/transactions';
import { prisma } from '@/lib/db';

export const metadata = { title: 'Investments' };

export default async function InvestmentsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  if ((await prisma.account.count({ where: { userId, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyDashboard />;

  const [data, outlook, withheld] = await Promise.all([
    getInvestments(),
    getRetirementOutlook(),
    getWithheldAccountSummary(userId),
  ]);
  return <InvestmentsView data={data} outlook={outlook} withheld={withheld} />;
}
