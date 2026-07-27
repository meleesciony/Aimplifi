import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { ReportsView } from '@/components/finance/reports-view';
import { getReports } from '@/server/reports';
import { getLinkableCategoryIds } from '@/server/categories';
import { getWithheldAccountSummary } from '@/server/transactions';
import { prisma } from '@/lib/db';

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  if ((await prisma.account.count({ where: { userId, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyDashboard />;

  const [data, withheld, linkableCategoryIds] = await Promise.all([
    getReports(userId),
    getWithheldAccountSummary(userId),
    // O.5: the exact option list the register's category <select> is built from
    // (transactions/page.tsx:100 flattens the same call), so a breakdown row can
    // only become a link when the destination's control can display the filter it
    // would arrive under. Hidden categories and the `uncategorized` placeholder
    // are both absent from this list, and both still render a figure here.
    // O.6: the flatten moved into `getLinkableCategoryIds` when /trends and
    // /budgets became linkable too — one author for the fence, three readers.
    getLinkableCategoryIds(userId),
  ]);
  // withheld threads into the view (the #141/#145 convention; a plain {count,currencies}
  // crosses to the client ReportsView fine) — banner inside the view's own max-w-2xl column,
  // no redundant wrapper, all-USD DOM byte-identical.
  return <ReportsView data={data} withheld={withheld} linkableCategoryIds={linkableCategoryIds} />;
}
