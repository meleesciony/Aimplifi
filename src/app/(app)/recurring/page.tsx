import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { RecurringView } from '@/components/finance/recurring-view';
import { getRecurring } from '@/server/recurring';
import { prisma } from '@/lib/db';

export default async function RecurringPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  if ((await prisma.account.count({ where: { userId } })) === 0) return <EmptyDashboard />;

  const data = await getRecurring(userId);
  return <RecurringView data={data} />;
}
