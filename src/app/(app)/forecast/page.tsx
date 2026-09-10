import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { PAGE_STACK_CLASS } from '@/components/finance/page-chrome';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { ForecastView } from '@/components/finance/forecast-view';
import { SyncAllButton } from '@/components/finance/sync-all-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PushOptIn } from '@/components/settings/push-optin';
import { getCashFlowForecast } from '@/server/forecast';
import { getVapidPublicKey } from '@/lib/push';
import { prisma } from '@/lib/db';
import { isDemoUser } from '@/lib/demo-user';
import { formatISODate, isoDate } from '@/lib/dates';

export const metadata = { title: "Forecast" };

export default async function ForecastPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  if ((await prisma.account.count({ where: { userId, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyDashboard />;

  const [data, vapidPublicKey, bankConnected] = await Promise.all([
    getCashFlowForecast(userId),
    Promise.resolve(getVapidPublicKey()),
    Promise.all([
      prisma.simpleFinConnection.findUnique({
        where: { userId },
        select: { userId: true },
      }),
      prisma.plaidItem.count({ where: { userId } }),
    ]).then(([sf, plaidCount]) => sf !== null || plaidCount > 0),
  ]);

  const dipDate = data.forecast.firstNegativeDate;
  const canActOnDip = Boolean(dipDate) && !isDemoUser(userId);
  const dipMonth = dipDate ? dipDate.slice(0, 7) : null;

  return (
    <div className={PAGE_STACK_CLASS}>
      <ForecastView data={data} />

      {canActOnDip && dipDate && dipMonth ? (
        <Card data-testid="forecast-cash-dip-actions" className="mx-auto max-w-2xl border-rose-500/30">
          <CardHeader className="pb-2">
            <CardDescription>Cash dip</CardDescription>
            <CardTitle className="text-base">
              Projected below $0 on {formatISODate(isoDate(dipDate))}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Open that day on Calendar for the dated transfer instruction, or refresh bank feeds
              if balances look stale. Aimplifi never moves money.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Link
                href={`/calendar?month=${dipMonth}`}
                className="tap-target inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
                data-testid="forecast-cash-dip-calendar-link"
              >
                Open Calendar for {dipMonth}
              </Link>
              {bankConnected ? (
                <div className="min-w-[10rem]"><SyncAllButton connected flashKey="forecast" /></div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

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
