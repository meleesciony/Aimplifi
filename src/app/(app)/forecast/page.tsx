import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { ForecastView } from '@/components/finance/forecast-view';
import { getCashFlowForecast } from '@/server/forecast';
import { prisma } from '@/lib/db';

export const metadata = { title: "Forecast" };

export default async function ForecastPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  if ((await prisma.account.count({ where: { userId } })) === 0) return <EmptyDashboard />;

  const data = await getCashFlowForecast(userId);
  return <ForecastView data={data} />;
}
