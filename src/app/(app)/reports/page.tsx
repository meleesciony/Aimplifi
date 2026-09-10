import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { PAGE_STACK_CLASS } from '@/components/finance/page-chrome';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { ReportsView } from '@/components/finance/reports-view';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { REPORT_CHART_MONTHS, parseReportYear, type ReportChartMonths } from '@/lib/engine/reports/chart-range';
import { getReports } from '@/server/reports';
import { getProvider } from '@/lib/providers/demo';
import { getWithheldAccountSummary } from '@/server/transactions';
import { getTaxYears } from '@/server/tax';
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

  // Trailing-series length, or a named calendar year (DECISIONS #567). Validated
  // against the same vocabulary the selector renders, so an edited URL can only
  // ever pick a window the page knows how to draw; anything else reads as the
  // default (last 6 months + this month's category table).
  const sp = await searchParams;
  const today = getProvider().today(userId);
  const yearRaw = Array.isArray(sp.year) ? (sp.year[0] ?? '') : (sp.year ?? '');
  const year = parseReportYear(yearRaw, today);
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
  const [data, withheld, taxYears] = await Promise.all([
    getReports(userId, months, { year }),
    getWithheldAccountSummary(userId),
    getTaxYears(userId),
  ]);
  // withheld threads into the view (the #141/#145 convention; a plain {count,currencies}
  // crosses to the client ReportsView fine) — banner inside the view's own max-w-2xl column,
  // no redundant wrapper, all-USD DOM byte-identical.
  return (
    <div className={PAGE_STACK_CLASS}>
      <ReportsView data={data} withheld={withheld} months={months} />
      <Card data-testid="reports-tax-export-card" className="mx-auto max-w-2xl">
        <CardHeader className="pb-2">
          <CardDescription>Download what you tagged — not tax advice</CardDescription>
          <CardTitle className="text-base">Tax year export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2" data-testid="tax-export">
          <p className="text-xs text-muted-foreground">
            Everything you or your rules tagged — medical, child care, charitable and the rest —
            grouped by category with a total for each. It&apos;s a record of your own tagging, not
            tax advice, and Aimplifi decides nothing about what you can claim.
          </p>
          {taxYears.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="tax-export-empty">
              Nothing tagged yet. Open any transaction&apos;s tag on the{' '}
              <Link href="/transactions" className="underline underline-offset-2">
                transactions page
              </Link>{' '}
              to file it under a tax category — or give a{' '}
              <Link href="/rules" className="underline underline-offset-2">
                rule
              </Link>{' '}
              a tax tag and it tags matching transactions for you. The years you tag will appear
              here.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {taxYears.map((year) => (
                <a
                  key={year}
                  href={`/api/export?format=tax-year-csv&year=${year}`}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  data-testid="export-tax-year"
                  data-year={year}
                >
                  {year} taxes (CSV)
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
