import { redirect } from 'next/navigation';
import { CheckCircle2, Eye, TrendingUp } from 'lucide-react';
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
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { formatMonth } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { prisma } from '@/lib/db';
import { getCoachData } from '@/server/coach';

export const metadata = { title: "Coach" };

export default async function CoachPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  // No accounts yet → first-run onboarding (the FI/cash engine needs accounts).
  if ((await prisma.account.count({ where: { userId: session.user.id } })) === 0) return <EmptyDashboard />;
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
          latestMonthRateBps={data.currentRateBps}
          latestMonthLabel={
            data.flows.length ? formatMonth(data.flows[data.flows.length - 1].month) : undefined
          }
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
          <ul className="space-y-3 text-sm" data-testid="opportunities-list">
            {data.opportunities.map((o, i) => (
              <li key={i} className="space-y-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{o.merchant}</span>
                  <Badge variant={o.isEstimate ? 'outline' : 'secondary'} className="shrink-0">
                    {o.isEstimate ? `~${formatCents(o.monthlyCents)}/mo est.` : `${formatCents(o.monthlyCents)}/mo`}
                  </Badge>
                </div>
                {i === 0 && (
                  <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400" data-testid="biggest-lever">
                    {COACH_COPY.biggestLever()}
                  </p>
                )}
                {/* the actionable line first; the compounding math in a quiet second line */}
                <p className="text-xs text-muted-foreground">
                  {COACH_COPY.opportunity(o, data.fi.expectedReturnBps)}
                </p>
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
            {(() => {
              const series = data.creep.monthlyDiscretionaryCents;
              const first = series[0];
              const last = series[series.length - 1];
              if (!first || !last) return null;
              return (
                <div className="flex justify-between text-[10px] text-muted-foreground" data-testid="creep-axis">
                  <span>
                    {formatMonth(first.month, 'short')} · {formatCents(first.amountCents)}
                  </span>
                  <span>
                    {formatMonth(last.month, 'short')} · {formatCents(last.amountCents)}
                  </span>
                </div>
              );
            })()}
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
          <CardTitle className="text-base">{formatMonth(data.review.month)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="flex items-start gap-2" data-testid="review-improvement">
            <TrendingUp className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden />
            <span>{data.review.improvement}</span>
          </p>
          <p className="flex items-start gap-2" data-testid="review-creep">
            <Eye className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
            <span>{data.review.creep}</span>
          </p>
          <p className="flex items-start gap-2" data-testid="review-next-action">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden />
            <span>{data.review.nextAction}</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
