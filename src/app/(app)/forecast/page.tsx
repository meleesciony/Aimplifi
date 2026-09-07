import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { ForecastView } from '@/components/finance/forecast-view';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PushOptIn } from '@/components/settings/push-optin';
import { getCashFlowForecast } from '@/server/forecast';
import { getVapidPublicKey } from '@/lib/push';
import { prisma } from '@/lib/db';

export const metadata = { title: "Forecast" };

export default async function ForecastPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  if ((await prisma.account.count({ where: { userId, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyDashboard />;

  const [data, vapidPublicKey] = await Promise.all([
    getCashFlowForecast(userId),
    Promise.resolve(getVapidPublicKey()),
  ]);
  return (
    <div className="space-y-4">
      <ForecastView data={data} />
      {vapidPublicKey ? (
        <Card data-testid="forecast-notifications-card" className="mx-auto max-w-2xl">
          <CardHeader className="pb-2">
            <CardDescription>Proactive heads-ups</CardDescription>
            <CardTitle className="text-base">Notifications</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Get a push when a card payment is due within a few days or your checking is on track to
              dip below $0 — the same risks this forecast is projecting. Aimplifi never moves money.
            </p>
            <PushOptIn publicKey={vapidPublicKey} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
