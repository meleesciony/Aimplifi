import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { PAGE_STACK_CLASS } from '@/components/finance/page-chrome';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { InvestmentsView } from '@/components/finance/investments-view';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { getInvestments, getRetirementOutlook } from '@/server/investments';
import { getWithheldAccountSummary } from '@/server/transactions';
import { prisma } from '@/lib/db';
import { isDemoUser } from '@/lib/demo-user';

export const metadata = { title: 'Investments' };

export default async function InvestmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  if ((await prisma.account.count({ where: { userId, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyDashboard />;

  // ?account=<id> (#160): the /accounts INVESTMENT row-link (#159) narrows this page to one
  // account. A repeated param (string[]) or absence → undefined → the full portfolio view.
  const { account } = await searchParams;
  const scopedAccountId = typeof account === 'string' ? account : undefined;

  const [data, outlook, withheld] = await Promise.all([
    getInvestments(),
    getRetirementOutlook(),
    getWithheldAccountSummary(userId),
  ]);
  return (
    <div className={PAGE_STACK_CLASS}>
      <InvestmentsView
        data={data}
        outlook={outlook}
        withheld={withheld}
        scopedAccountId={scopedAccountId}
        canWrite={!isDemoUser(userId)}
      />
      <Card data-testid="investments-net-worth-export-card">
        <CardHeader className="pb-2">
          <CardDescription>Take your net worth with you</CardDescription>
          <CardTitle className="text-base">Net worth export</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <a
            href="/api/export?format=net-worth-csv"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            data-testid="export-net-worth-csv"
          >
            Net worth (CSV)
          </a>
          <a
            href="/api/export?format=net-worth-pdf"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            data-testid="export-net-worth-pdf"
          >
            Net worth report (PDF)
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
