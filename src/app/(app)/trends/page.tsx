import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { TrendsView } from '@/components/finance/trends-view';
import { getSpendingTrends } from '@/server/trends';
import { getBalanceMove } from '@/server/balance-move';
import { getLinkableCategoryIds } from '@/server/categories';
import { parseStoredDials } from '@/lib/engine/settings/dials';
import { prisma } from '@/lib/db';

export const metadata = { title: "Trends" };

export default async function TrendsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  if ((await prisma.account.count({ where: { userId, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyDashboard />;

  const [trends, user, linkableCategoryIds] = await Promise.all([
    getSpendingTrends(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { moneyDials: true } }),
    // O.6: the register's own option list — the same fence /reports and /budgets
    // pass, so a hidden category renders its figure here without becoming a link
    // into a control that could not display it.
    getLinkableCategoryIds(userId),
  ]);
  const balanceMove = await getBalanceMove(userId, trends);
  return (
    <TrendsView
      trends={trends}
      dials={parseStoredDials(user?.moneyDials)}
      balanceMove={balanceMove}
      linkableCategoryIds={linkableCategoryIds}
    />
  );
}
