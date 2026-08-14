'use client';

/**
 * The savings-rate bar chart, with every bar tappable.
 *
 * Owner request, 2026-08-02: *"if i want to know why and where cash come from
 * that caused greater savings for a specific month, i should be able to click on
 * the graph itself"*. /reports' income-vs-spending chart has had this since
 * O.20; this chart — the headline metric on /coach — was twelve inert divs with
 * a `title` tooltip, which is a hover affordance that does not exist on a phone.
 *
 * What a bar expands into, and why it is two panels rather than one: a savings
 * rate is a RATIO, and a ratio has no rows. Its two inputs do. So tapping May
 * opens May's income rows and May's spending rows — the two figures the rate was
 * computed from — each reconciling against the very number this page summed.
 * Nothing here re-queries or re-derives; `buildMonthFlowBreakdowns` was handed
 * the same array `monthlyFlows` summed, keyed by the same months the chart draws.
 *
 * The DRAWN height stays clamped to ±100% (a near-zero-income month is a genuine
 * −855105.8% and would flatten every other bar); the clamp is a property of the
 * picture and never of the panel, whose rows are the month's real ones.
 */
import { useState } from 'react';
import type { MonthlyFlow } from '@/lib/engine/fi/insights';
import type { MonthFlowBreakdown } from '@/lib/engine/glass-box/month-flow-breakdown';
import { MonthFlowPanel } from '@/components/finance/month-flow-panel';
import { formatSavingsRateBps } from '@/components/coach/savings-rate-format';
import { formatMonth } from '@/lib/dates';

// Savings rate is unbounded below (a month whose income is a fraction of its spending is
// a genuine −100,000% month), so the chart is scaled against a fixed ±100% window rather
// than the data's own max — otherwise ONE pathological month flattens every other bar to
// an invisible sliver, which is exactly what the owner's screenshot showed. Each bar's
// accessible name and title still report its true rate; only the drawn HEIGHT is clamped,
// and the rows a bar opens are the month's real ones either way.
const CHART_SCALE_BPS = 10_000;

export function SavingsRateChart({
  recent,
  monthFlows,
  hasPositiveMonth,
}: {
  recent: MonthlyFlow[];
  monthFlows: Record<string, MonthFlowBreakdown>;
  hasPositiveMonth: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  const max = CHART_SCALE_BPS;
  const income = selected ? monthFlows[`${selected}:income`] : undefined;
  const expense = selected ? monthFlows[`${selected}:expense`] : undefined;
  const selectedLabel = selected ? formatMonth(selected) : '';
  const selectedFlow = selected ? recent.find((f) => f.month === selected) : undefined;

  return (
    <>
      <div className="relative">
        <div
          className="flex h-20 items-end gap-1"
          role="group"
          aria-label="Monthly savings rate, last 12 months — select a month to see the income and spending behind it"
        >
          {recent.map((f) => {
            const v = f.savingsRateBps ?? 0;
            // Clamp the DRAWN height to the fixed scale; the label keeps the true value.
            const h = Math.max(4, Math.round((Math.min(Math.abs(v), max) / max) * 72));
            const isOpen = selected === f.month;
            const label = formatMonth(f.month);
            return (
              <div key={f.month} className="flex flex-1 flex-col items-center gap-0.5">
                <button
                  type="button"
                  data-testid={`savings-rate-bar-${f.month}`}
                  data-open={isOpen ? 'true' : 'false'}
                  // The accessible name carries the month AND its rate, because the
                  // bar's height is clamped and its colour is the only other cue —
                  // neither is available to a screen reader.
                  aria-label={`${label}: savings rate ${formatSavingsRateBps(v)}. Show the income and spending behind it.`}
                  aria-expanded={isOpen}
                  title={`${label}: ${formatSavingsRateBps(v)}`}
                  onClick={() => setSelected(isOpen ? null : f.month)}
                  className={`flex w-full cursor-pointer items-end justify-center rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                    isOpen ? 'ring-2 ring-ring ring-offset-1' : ''
                  }`}
                  // The whole 72px column is the hit target, not just the drawn
                  // bar: a −0.2% month draws 4px, and a 4px tap target on a phone
                  // is the affordance being missing again in a smaller way.
                  style={{ height: '72px', alignItems: 'flex-end' }}
                >
                  <span
                    className={`block w-full rounded-sm ${v >= 0 ? 'bg-positive-500/80' : 'bg-red-500/70'}`}
                    style={{ height: `${h}px` }}
                    aria-hidden
                  />
                </button>
              </div>
            );
          })}
        </div>
        {/* 15% savings-rate reference (Ramsey BS4). Fixed scale, so it always fits;
            shown only when the history has a saving month to reference against. */}
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
        <span>{recent.length > 1 ? formatMonth(recent[recent.length - 1].month, 'short') : ''}</span>
      </div>

      {selected && (
        <div className="mt-3 border-t pt-3" data-testid="savings-rate-month-detail">
          <p className="text-xs text-muted-foreground" data-testid="savings-rate-month-detail-intro">
            {/* Names both halves and refuses to call either one "the rate": the rate
                is the relationship between them, and only these two figures have
                rows. `savingsRateBps` is null when the month had no income, and
                that is a different sentence from a rate of 0%. */}
            {selectedFlow && selectedFlow.savingsRateBps === null
              ? `${selectedLabel} counted no income, so it has no savings rate — here is what it did count.`
              : `What ${selectedLabel}'s rate was computed from — the income counted that month, and the spending.`}
          </p>
          {income && (
            <div className="mt-2">
              <MonthFlowPanel
                breakdown={income}
                windowLabel={selectedLabel}
                testIdPrefix="savings-rate-income"
                defaultOpen
              />
            </div>
          )}
          {expense && (
            <div className="mt-2">
              <MonthFlowPanel
                breakdown={expense}
                windowLabel={selectedLabel}
                testIdPrefix="savings-rate-expense"
                defaultOpen
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}
