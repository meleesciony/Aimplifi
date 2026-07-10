import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import type { MonthlyFlow } from '@/lib/engine/fi/insights';
import { computeSavingsStreak } from '@/lib/engine/fi/savings-streak';
import { formatMonth } from '@/lib/dates';
import { cents } from '@/lib/money';

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
  const max = Math.max(1, ...recent.map((f) => Math.abs(f.savingsRateBps ?? 0)));
  const rates = recent.map((f) => f.savingsRateBps).filter((r): r is number => r !== null);
  const avgBps = rates.length ? Math.round(rates.reduce((s, r) => s + r, 0) / rates.length) : null;
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
          {currentRateBps === null ? '—' : `${(currentRateBps / 100).toFixed(1)}%`}
        </CardTitle>
        {currentRateBps !== null && avgBps !== null && (
          <p className="text-xs text-muted-foreground" data-testid="savings-rate-context">
            {currentRateBps > avgBps ? 'above' : currentRateBps < avgBps ? 'below' : 'matching'} your{' '}
            {rates.length}-month average of {(avgBps / 100).toFixed(1)}%
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
              const h = Math.max(4, Math.round((Math.abs(v) / max) * 72));
              return (
                <div key={f.month} className="flex flex-1 flex-col items-center gap-0.5">
                  <div
                    className={`w-full rounded-sm ${v >= 0 ? 'bg-emerald-500/80' : 'bg-red-500/70'}`}
                    style={{ height: `${h}px` }}
                    title={`${f.month}: ${(v / 100).toFixed(1)}%`}
                  />
                </div>
              );
            })}
          </div>
          {/* 15% savings-rate reference (Ramsey BS4) — shown only when it falls within the chart range */}
          {max >= 1500 && (
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
        {max >= 1500 && (
          <p className="mt-1 text-[10px] text-muted-foreground" data-testid="fifteen-pct-ref">
            {COACH_COPY.fifteenPercentReference()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
