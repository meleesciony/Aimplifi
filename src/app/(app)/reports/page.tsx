import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { ReportsView } from '@/components/finance/reports-view';
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

  const sp = await searchParams;
  const raw = sp.category;
  const categoryId = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : null;

  const [data, withheld] = await Promise.all([
    getReports(userId, { categoryId }),
    getWithheldAccountSummary(userId),
  ]);
  // withheld threads into the view (the #141/#145 convention; a plain {count,currencies}
  // crosses to the client ReportsView fine) — banner inside the view's own max-w-2xl column,
  // no redundant wrapper, all-USD DOM byte-identical.
  return <ReportsView data={data} withheld={withheld} />;
}
