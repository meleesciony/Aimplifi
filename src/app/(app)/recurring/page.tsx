import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { RecurringView } from '@/components/finance/recurring-view';
import { getRecurring } from '@/server/recurring';
import { getWithheldAccountSummary } from '@/server/transactions';
import { prisma } from '@/lib/db';

export const metadata = { title: "Recurring" };

export default async function RecurringPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  if ((await prisma.account.count({ where: { userId, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyDashboard />;

  const [data, withheld] = await Promise.all([
    getRecurring(userId),
    getWithheldAccountSummary(userId),
  ]);
  // withheld threads into the view (the #141/#145 convention) so the banner sits inside
  // the view's own max-w-xl column — no redundant wrapper, all-USD DOM byte-identical.
  return <RecurringView data={data} withheld={withheld} />;
}
