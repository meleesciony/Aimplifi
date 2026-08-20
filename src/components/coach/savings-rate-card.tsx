import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { pooledSavingsRateBps } from '@/lib/engine/fi/fi';
import type { MonthlyFlow } from '@/lib/engine/fi/insights';
import type { MonthFlowBreakdown } from '@/lib/engine/glass-box/month-flow-breakdown';
import { SavingsRateChart } from '@/components/coach/savings-rate-chart';
import type { SavingsStreakResult } from '@/lib/engine/fi/savings-streak';
import {
  formatSavingsRateBps,
  showsAverageComparison,
} from '@/components/coach/savings-rate-format';
import { formatMonth } from '@/lib/dates';
import { cents } from '@/lib/money';

/**
 * Savings rate — the headline metric, displayed with the same prominence as
 * net worth (savings rate, not returns, drives years-to-FI).
 */
export function SavingsRateCard({
  flows,
  streak,
  currentRateBps,
  monthFlows,
}: {
  flows: MonthlyFlow[];
  /**
   * The streak/personal-best claim over ALL complete months, computed by the
   * server — never re-derived here from the 12-month chart slice (audit P2:
   * "personal best so far" over 12 months is false when an older month beats it).
   */
  streak: SavingsStreakResult;
  currentRateBps: number | null;
  /** Rows behind each bar, keyed `YYYY-MM:income` / `YYYY-MM:expense` — see `CoachData`. */
  monthFlows: Record<string, MonthFlowBreakdown>;
}) {
  const recent = flows.slice(-12);
  // The 40% goal line/caption belong on a chart that has something to aspire FROM —
  // painting "aim for 40%" across an all-red bleeding history reads as a rebuke, not a
  // reference. Show it only once at least one month actually saved. (The old `max >= 1500`
  // guard did this incidentally via a data-driven scale; the fixed scale made it dead code.)
  const hasPositiveMonth = recent.some((f) => (f.savingsRateBps ?? 0) > 0);
  // POOLED, not the mean of monthly rates — averaging ratios lets a near-zero-income month
  // blow the figure up to hundreds of thousands of percent (the owner's "−855105.8%").
  const pooled = pooledSavingsRateBps(recent);
  const avgBps = pooled?.rateBps ?? null;
  const avgMonths = pooled?.months ?? 0;
  // the headline figure is the last FULL month — say so, never "this month"
  const monthLabel = recent.length ? formatMonth(recent[recent.length - 1].month) : '';
  // the unspent gap of that same month — Housel's "invisible wealth"
  const lastFlow = recent.length ? recent[recent.length - 1] : null;
  const savedGapCents = lastFlow ? lastFlow.incomeCents - lastFlow.expensesCents : 0;

  return (
    <Card data-testid="savings-rate-card">
      <CardHeader className="pb-2">
        <CardDescription>Savings rate (after-tax) · {monthLabel}</CardDescription>
        <CardTitle as="div" className="text-2xl tabular-nums sm:text-3xl" data-testid="savings-rate-amount">
          {currentRateBps === null ? '—' : formatSavingsRateBps(currentRateBps)}
        </CardTitle>
        {showsAverageComparison(currentRateBps, avgBps, avgMonths) && (
          <p className="text-xs text-muted-foreground" data-testid="savings-rate-context">
            {currentRateBps! > avgBps! ? 'above' : currentRateBps! < avgBps! ? 'below' : 'matching'} your{' '}
            {avgMonths}-month average of {formatSavingsRateBps(avgBps!)}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {currentRateBps === null
            ? COACH_COPY.savingsRateNoIncome(monthLabel)
            : COACH_COPY.savingsRateHeadline(currentRateBps, monthLabel)}
        </p>
        {savedGapCents > 0 && (
          <p className="text-xs text-positive-600 dark:text-positive-400" data-testid="invisible-wealth">
            {COACH_COPY.invisibleWealth(cents(savedGapCents), monthLabel)}
          </p>
        )}
        {streak.streakMonths >= 2 && streak.latestRateBps !== null && (
          <p className="text-xs text-positive-600 dark:text-positive-400" data-testid="savings-rate-streak">
            {COACH_COPY.savingsStreak(streak.streakMonths, streak.latestRateBps)}
          </p>
        )}
        {streak.isPersonalBest && streak.latestRateBps !== null && monthLabel && (
          <p className="text-xs text-muted-foreground" data-testid="savings-rate-personal-best">
            {COACH_COPY.savingsPersonalBest(streak.latestRateBps, monthLabel)}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <SavingsRateChart recent={recent} monthFlows={monthFlows} hasPositiveMonth={hasPositiveMonth} />
        {hasPositiveMonth && (
          <p className="mt-1 text-[10px] text-muted-foreground" data-testid="fifteen-pct-ref">
            {COACH_COPY.fifteenPercentReference()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
