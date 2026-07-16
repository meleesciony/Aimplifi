import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { TrendsView } from '@/components/finance/trends-view';
import { getSpendingTrends } from '@/server/trends';
import { getBalanceMove } from '@/server/balance-move';
import { parseStoredDials } from '@/lib/engine/settings/dials';
import { prisma } from '@/lib/db';

export const metadata = { title: "Trends" };

export default async function TrendsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  if ((await prisma.account.count({ where: { userId, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyDashboard />;

  const [trends, user] = await Promise.all([
    getSpendingTrends(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { moneyDials: true } }),
  ]);
  const balanceMove = await getBalanceMove(userId, trends);
  return <TrendsView trends={trends} dials={parseStoredDials(user?.moneyDials)} balanceMove={balanceMove} />;
}
