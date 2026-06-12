import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { FICard } from '@/components/coach/fi-card';
import { LifeEnergyCard } from '@/components/coach/life-energy-card';
import { SavingsRateCard } from '@/components/coach/savings-rate-card';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { formatCents } from '@/lib/money';
import { getCoachData } from '@/server/coach';

export default async function CoachPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const data = await getCoachData(session.user.id);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">FI Coach</h1>

      <div className="grid gap-4 lg:grid-cols-2">
        <SavingsRateCard flows={data.flows} currentRateBps={data.currentRateBps} />
        <FICard
          fiNumberCents={data.fi.fiNumberCents}
          annualExpensesCents={data.fi.annualExpensesCents}
          portfolioCents={data.fi.portfolioCents}
          monthlyIncomeCents={data.fi.monthlyIncomeCents}
          monthlySavingsCents={data.fi.monthlySavingsCents}
          monthsToFINow={data.fi.monthsToFI}
          swrBps={data.fi.swrBps}
          expectedReturnBps={data.fi.expectedReturnBps}
          coastIsCoast={data.fi.coastIsCoast}
          coastRequiredMonthlyCents={data.fi.coastRequiredMonthlyCents}
          coastTargetYears={data.fi.coastTargetYears}
        />
      </div>

      {/* Big wins, never latte shame */}
      <Card data-testid="opportunities-card">
        <CardHeader className="pb-2">
          <CardDescription>Savings opportunities — big wins first</CardDescription>
          <CardTitle className="text-base">
            Worth a look ({data.opportunities.length})
          </CardTitle>
          {data.moneyDials.length > 0 && (
            <p className="text-sm text-muted-foreground">{COACH_COPY.moneyDials(data.moneyDials)}</p>
          )}
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm" data-testid="opportunities-list">
            {data.opportunities.map((o, i) => (
              <li key={i} className="flex items-start gap-2">
                <Badge variant={o.isEstimate ? 'outline' : 'secondary'} className="mt-0.5 shrink-0">
                  {o.isEstimate ? 'est.' : formatCents(o.monthlyCents) + '/mo'}
                </Badge>
                <span>{COACH_COPY.opportunity(o, data.fi.expectedReturnBps)}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card data-testid="creep-card">
          <CardHeader className="pb-2">
            <CardDescription>Lifestyle creep</CardDescription>
            <CardTitle className="text-base">
              {data.creep.flagged ? 'Spending is outpacing income' : 'Tracking income'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm" data-testid="creep-verdict">
              {data.creep.flagged ? COACH_COPY.creepFlagged(data.creep) : COACH_COPY.creepClear(data.creep)}
            </p>
            <div className="flex h-14 items-end gap-1" role="img" aria-label="Monthly discretionary spend">
              {data.creep.monthlyDiscretionaryCents.map((m) => {
                const max = Math.max(...data.creep.monthlyDiscretionaryCents.map((x) => x.amountCents), 1);
                return (
                  <div
                    key={m.month}
                    className="flex-1 rounded-sm bg-amber-500/70"
                    style={{ height: `${Math.max(4, Math.round((m.amountCents / max) * 52))}px` }}
                    title={`${m.month}: ${formatCents(m.amountCents)}`}
                  />
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="runway-card">
          <CardHeader className="pb-2">
            <CardDescription>Room for error</CardDescription>
            <CardTitle className="text-2xl tabular-nums" data-testid="runway-months">
              {Number.isFinite(data.runwayMonths) ? `${data.runwayMonths} months` : 'no expenses yet'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{COACH_COPY.runway(data.runwayMonths)}</p>
          </CardContent>
        </Card>
      </div>

      <LifeEnergyCard items={data.lifeEnergy} hourlyWageCents={data.hourlyWageCents} />

      <Card data-testid="money-review-card">
        <CardHeader className="pb-2">
          <CardDescription>Monthly Money Review</CardDescription>
          <CardTitle className="text-base">{data.review.month}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p data-testid="review-improvement">📈 {data.review.improvement}</p>
          <p data-testid="review-creep">👀 {data.review.creep}</p>
          <p data-testid="review-next-action">✅ {data.review.nextAction}</p>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">{COACH_COPY.disclaimer()}</p>
    </div>
  );
}
