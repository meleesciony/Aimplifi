import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { ReportsView } from '@/components/finance/reports-view';
import { REPORT_CHART_MONTHS, type ReportChartMonths } from '@/lib/engine/reports/chart-range';
import { getReports } from '@/server/reports';
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

  // C.26 (critic cycle 1, P1-1): the O.5 linkable fence moved INSIDE
  // `getReports`, which now returns a built href per category. The fence itself
  // is unchanged — `getLinkableCategoryIds` is still its one author, and /trends
  // and /budgets still read it directly — but the /reports link is assembled
  // beside the figure it points at, where the window that decides its `to` date
  // lives.
  const [data, withheld] = await Promise.all([
    getReports(userId, months),
    getWithheldAccountSummary(userId),
  ]);
  // withheld threads into the view (the #141/#145 convention; a plain {count,currencies}
  // crosses to the client ReportsView fine) — banner inside the view's own max-w-2xl column,
  // no redundant wrapper, all-USD DOM byte-identical.
  return <ReportsView data={data} withheld={withheld} months={months} />;
}
