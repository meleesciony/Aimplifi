import { ArrowDownRight, ArrowUpRight, LineChart, Sparkles } from 'lucide-react';
import { cents, formatCents } from '@/lib/money';
import {
  moverWindowLabel,
  paceAssumption,
  PACE_NO_SPEND_YET,
  paceBillsPhrase,
  paceDaysPhrase,
  paceDeltaRelation,
} from '@/lib/engine/trends/labels';
import type { SpendingTrends } from '@/lib/engine/trends/trends';
import { TrackedActedLink } from '@/components/engagement/tracked-acted-link';
import { SURFACE_LINK_CARD_CLASS } from '@/components/finance/surface-card-styles';

const money = (n: number) => formatCents(cents(n));

/**
 * Dashboard summary of spending trends (DECISIONS #74 / #387): this month's
 * pace plus the single biggest category mover, linking through to /trends.
 *
 * C.3 (CALC_AUDIT 2026-08-02): the pace line must name its day-count divisor
 * and state the projection assumption — /trends already did; this card did
 * not, though `daysElapsed` was on the object. The green/rose tint is gone:
 * colour was an evaluative claim on the least reliable figure on the page,
 * and `> 0` put an exact tie in the "less / green" branch. The top mover is
 * a completed-month fact and keeps its window label next to the name.
 *
 * C.2 changed what the projection IS — money counted, plus the bills the app can
 * see still due, plus the rest at the discretionary daily rate — so the card
 * names those bills and the assumption sentence describes all three parts. A
 * reader cannot divide spent-so-far by the day count and reproduce the figure
 * any more, which is precisely why the sentence has to say what it did.
 */
export function SpendingInsightsCard({ trends }: { trends: SpendingTrends }) {
  const { pace, movers, comparedYm, baselineMonths } = trends;
  const top = movers[0];
  const delta = pace ? paceDeltaRelation(pace.deltaVsPriorCents) : null;
  const billsPhrase = pace ? paceBillsPhrase(pace) : null;
  const moverWindow = moverWindowLabel(comparedYm, baselineMonths);

  return (
    <TrackedActedLink
      href="/trends"
      subjectKey="spending-insights"
      data-testid="dashboard-spending-insights"
      className={SURFACE_LINK_CARD_CLASS}
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

      {pace && delta ? (
        <div className="mt-3">
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-semibold tabular-nums">{money(pace.spentSoFarCents)}</span>
            <span className="text-xs text-muted-foreground">spent this month</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground" data-testid="dashboard-trends-pace-days">
            {paceDaysPhrase(pace.daysElapsed)}
            {delta.relation === 'same' ? (
              <> · on pace with last month</>
            ) : (
              <>
                {' '}
                · on pace for {money(delta.absCents)} {delta.relation} than last month
              </>
            )}
          </p>
          {/* C.2: the bills the projection ADDED, named. The owner's report was
              "$8,971.25 makes no sense since our mortgage is ~6200" — a figure is
              only as believable as its visible inputs, so the bill it now counts
              is on screen beside it rather than folded into one number. */}
          {billsPhrase && (
            <p className="mt-0.5 text-xs text-muted-foreground" data-testid="dashboard-trends-pace-bills">
              {billsPhrase}
            </p>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground" data-testid="dashboard-trends-pace-assumption">
            {paceAssumption(pace)}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground" data-testid="dashboard-trends-pace-empty">
          {PACE_NO_SPEND_YET}
        </p>
      )}

      {top && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t pt-2 text-xs">
          <span className="truncate text-muted-foreground">
            Biggest change
            {moverWindow ? (
              <>
                {' '}
                <span data-testid="dashboard-trends-mover-window">({moverWindow})</span>
              </>
            ) : null}
            : <span className="font-medium text-foreground">{top.name}</span>
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
