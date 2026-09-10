import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { PAGE_STACK_CLASS } from '@/components/finance/page-chrome';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { TrendsView } from '@/components/finance/trends-view';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { getSpendingTrends } from '@/server/trends';
import { getBalanceMove } from '@/server/balance-move';
import { getLinkableCategoryIds } from '@/server/categories';
import { loadDialCatalog, resolvedMoneyDialIds } from '@/server/money-dials';
import { prisma } from '@/lib/db';

export const metadata = { title: "Trends" };

export default async function TrendsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  if ((await prisma.account.count({ where: { userId, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyDashboard />;

  const [trends, user, linkableCategoryIds, dialCatalog] = await Promise.all([
    getSpendingTrends(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { moneyDials: true } }),
    // O.6: the register's own option list — the same fence /reports and /budgets
    // pass, so a hidden category renders its figure here without becoming a link
    // into a control that could not display it.
    getLinkableCategoryIds(userId),
    loadDialCatalog(userId),
  ]);
  const balanceMove = await getBalanceMove(userId, trends);
  return (
    <div className={PAGE_STACK_CLASS}>
      <TrendsView
        trends={trends}
        dials={resolvedMoneyDialIds(user?.moneyDials, dialCatalog)}
        balanceMove={balanceMove}
        linkableCategoryIds={linkableCategoryIds}
      />
      <Card data-testid="trends-transactions-export-card" className="mx-auto max-w-2xl">
        <CardHeader className="pb-2">
          <CardDescription>Take the register behind these trends with you</CardDescription>
          <CardTitle className="text-base">Export transactions</CardTitle>
        </CardHeader>
        <CardContent>
          <a
            href="/api/export?format=transactions-csv"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            data-testid="export-transactions-csv"
          >
            Transactions (CSV)
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
