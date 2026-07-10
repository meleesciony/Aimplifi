import { ArrowDownRight, ArrowUpRight, LineChart, Sparkles } from 'lucide-react';
import { cents, formatCents } from '@/lib/money';
import type { SpendingTrends } from '@/lib/engine/trends/trends';
import { TrackedActedLink } from '@/components/engagement/tracked-acted-link';

const money = (n: number) => formatCents(cents(n));

/**
 * Dashboard summary of spending trends (DECISIONS #74): this month's pace plus
 * the single biggest category mover, linking through to the full Trends view.
 * Tappable card; mirrors the Top-spending / Recurring dashboard cards.
 */
export function SpendingInsightsCard({ trends }: { trends: SpendingTrends }) {
  const { pace, movers } = trends;
  const top = movers[0];
  const paceUp = pace ? pace.deltaVsPriorCents > 0 : false;

  return (
    <TrackedActedLink
      href="/trends"
      subjectKey="spending-insights"
      data-testid="dashboard-spending-insights"
      className="block rounded-2xl border bg-card p-4 shadow-sm transition hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <LineChart className="size-3.5" aria-hidden /> Trends
        </div>
        {pace && (
          <span className="tabular-nums text-xs text-muted-foreground">
            {money(pace.projectedCents)} projected
          </span>
        )}
      </div>

      {pace ? (
        <div className="mt-3">
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-semibold tabular-nums">{money(pace.spentSoFarCents)}</span>
            <span className="text-xs text-muted-foreground">spent this month</span>
          </div>
          <p
            className={`mt-0.5 text-xs ${paceUp ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}
          >
            on pace for {money(Math.abs(pace.deltaVsPriorCents))} {paceUp ? 'more' : 'less'} than last month
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">Not enough activity yet to spot trends.</p>
      )}

      {top && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t pt-2 text-xs">
          <span className="truncate text-muted-foreground">
            Biggest change: <span className="font-medium text-foreground">{top.name}</span>
          </span>
          <span
            className={`flex shrink-0 items-center gap-1 font-medium tabular-nums ${
              top.direction === 'down'
                ? 'text-emerald-600 dark:text-emerald-400'
                : top.direction === 'new'
                  ? 'text-sky-600 dark:text-sky-400'
                  : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {top.direction === 'new' ? (
              <>
                <Sparkles className="size-3.5" aria-hidden /> New
              </>
            ) : (
              <>
                {top.direction === 'down' ? (
                  <ArrowDownRight className="size-3.5" aria-hidden />
                ) : (
                  <ArrowUpRight className="size-3.5" aria-hidden />
                )}
                {formatCents(cents(top.deltaCents), { signDisplay: 'always' })}
              </>
            )}
          </span>
        </div>
      )}
    </TrackedActedLink>
  );
}
