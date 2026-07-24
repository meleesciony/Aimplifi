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
import { computeSavingsStreak } from '@/lib/engine/fi/savings-streak';
import {
  formatSavingsRateBps,
  showsAverageComparison,
} from '@/components/coach/savings-rate-format';
import { formatMonth } from '@/lib/dates';
import { cents } from '@/lib/money';

// Savings rate is unbounded below (a month whose income is a fraction of its spending is
// a genuine −100,000% month), so the bar chart is scaled against a fixed ±100% window
// rather than the data's own max — otherwise ONE pathological month flattens every other
// bar to an invisible sliver, which is exactly what the owner's screenshot showed. The
// per-bar tooltip still reports each month's true rate; only the drawn HEIGHT is clamped.
const CHART_SCALE_BPS = 10_000;

/**
 * Savings rate — the headline metric, displayed with the same prominence as
 * net worth (savings rate, not returns, drives years-to-FI).
 */
export function SavingsRateCard({
  flows,
  currentRateBps,
}: {
  flows: MonthlyFlow[];
  currentRateBps: number | null;
}) {
  const recent = flows.slice(-12);
  // Fixed scale (see CHART_SCALE_BPS) so a single near-zero-income month can't flatten the
  // rest of the chart. A bar past ±100% is clamped to full height and keeps its true tooltip.
  const max = CHART_SCALE_BPS;
  // The 15% aspiration line/caption belong on a chart that has something to aspire FROM —
  // painting "aim for 15%" across an all-red bleeding history reads as a rebuke, not a
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
  const streak = computeSavingsStreak(recent);

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
          <p className="text-xs text-emerald-600 dark:text-emerald-400" data-testid="invisible-wealth">
            {COACH_COPY.invisibleWealth(cents(savedGapCents), monthLabel)}
          </p>
        )}
        {streak.streakMonths >= 2 && streak.latestRateBps !== null && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400" data-testid="savings-rate-streak">
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
        <div className="relative">
          <div className="flex h-20 items-end gap-1" role="img" aria-label="Monthly savings rate, last 12 months">
            {recent.map((f) => {
              const v = f.savingsRateBps ?? 0;
              // Clamp the DRAWN height to the fixed scale; the tooltip keeps the true value.
              const h = Math.max(4, Math.round((Math.min(Math.abs(v), max) / max) * 72));
              return (
                <div key={f.month} className="flex flex-1 flex-col items-center gap-0.5">
                  <div
                    className={`w-full rounded-sm ${v >= 0 ? 'bg-emerald-500/80' : 'bg-red-500/70'}`}
                    style={{ height: `${h}px` }}
                    title={`${f.month}: ${formatSavingsRateBps(v)}`}
                  />
                </div>
              );
            })}
          </div>
          {/* 15% savings-rate reference (Ramsey BS4). Fixed scale, so it always fits; shown
              only when the history has a saving month to reference against. */}
          {hasPositiveMonth && (
            <div
              className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted-foreground/40"
              style={{ bottom: `${(1500 / max) * 72}px` }}
              aria-hidden
            />
          )}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>{recent[0] ? formatMonth(recent[0].month, 'short') : ''}</span>
          <span>
            {recent.length > 1 ? formatMonth(recent[recent.length - 1].month, 'short') : ''}
          </span>
        </div>
        {hasPositiveMonth && (
          <p className="mt-1 text-[10px] text-muted-foreground" data-testid="fifteen-pct-ref">
            {COACH_COPY.fifteenPercentReference()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
