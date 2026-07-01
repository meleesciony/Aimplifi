import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { CardsBreakdown } from '@/components/finance/cards-breakdown';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { prisma } from '@/lib/db';
import { getDashboardData } from '@/server/finance';

export const metadata = { title: "Credit cards" };

export default async function CardsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  // No accounts yet → first-run onboarding (the cash-needed engine needs accounts).
  if ((await prisma.account.count({ where: { userId: session.user.id, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyDashboard />;
  const data = await getDashboardData(session.user.id);

  if (data.payInFull.cards.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Credit cards</h1>
        <Card className="border-dashed" data-testid="cards-empty">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No credit cards yet. Add a card or connect a bank from the{' '}
            <a href="/accounts" className="underline hover:text-foreground">Accounts</a> page to get
            your “how much &amp; when to pay every card in full” plan here.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Credit cards</h1>
      <CardsBreakdown
        payInFull={data.payInFull}
        minimum={data.minimum}
        paymentAccountName={data.paymentAccountName}
        today={data.today}
      />
    </div>
  );
}
