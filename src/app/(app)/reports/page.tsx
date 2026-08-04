import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { ReportsView } from '@/components/finance/reports-view';
import { REPORT_CHART_MONTHS, type ReportChartMonths } from '@/lib/engine/reports/chart-range';
import { getReports } from '@/server/reports';
import { getLinkableCategoryIds } from '@/server/categories';
import { getWithheldAccountSummary } from '@/server/transactions';
import { prisma } from '@/lib/db';

export const metadata = { title: "Reports" };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  if ((await prisma.account.count({ where: { userId, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyDashboard />;

  // Trailing-series length (owner request 2026-08-04). Validated against the
  // same vocabulary the selector renders, so an edited URL can only ever pick a
  // window the page knows how to draw; anything else reads as the default.
  const sp = await searchParams;
  const monthsRaw = Array.isArray(sp.months) ? (sp.months[0] ?? '') : (sp.months ?? '');
  const monthsParsed = Number(monthsRaw);
  const months: ReportChartMonths = (REPORT_CHART_MONTHS as readonly number[]).includes(monthsParsed)
    ? (monthsParsed as ReportChartMonths)
    : 6;

  const [data, withheld, linkableCategoryIds] = await Promise.all([
    getReports(userId, months),
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
  return <ReportsView data={data} withheld={withheld} linkableCategoryIds={linkableCategoryIds} months={months} />;
}
