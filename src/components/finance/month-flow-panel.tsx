'use client';

/**
 * The expandable half of a bar on the income-vs-spending chart.
 *
 * Owner request, 2026-08-01: *"every single bar and collection of categories
 * needs to be immediately available … essentially you are filtering
 * transactions"*. The category table below this chart has expanded since O.18;
 * the chart itself — the first thing on /reports — did not.
 *
 * A thin wrapper over `BreakdownPanel`, exactly as `CategoryBreakdownPanel` is.
 * What it owns is the wording, and the wording is where the two differ: this
 * panel's rows were selected by the FLOWS predicate (posted-only, refunds netted
 * against spending), so it states `MONTH_FLOW_BASIS` rather than the category
 * sentence, which says the opposite about pending rows.
 */
import {
  MONTH_FLOW_BASIS,
  monthFlowEmptyCopy,
  monthFlowNetRefundCopy,
  type MonthFlowBreakdown,
} from '@/lib/engine/glass-box/month-flow-breakdown';
import { BreakdownPanel } from '@/components/finance/breakdown-panel';
import { monthRegisterHref } from '@/lib/engine/transactions/links';

export function MonthFlowPanel({
  breakdown,
  /** The bar's month as the reader would say it ("Jun 2026") — required, because
   *  the chart draws six of them and no sentence here may say "this month". */
  windowLabel,
  testIdPrefix = 'month-flow',
  /** True when the reader reached this panel by tapping its bar — see `BreakdownPanel`. */
  defaultOpen = false,
}: {
  breakdown: MonthFlowBreakdown;
  windowLabel: string;
  testIdPrefix?: string;
  defaultOpen?: boolean;
}) {
  const isIncome = breakdown.flow === 'income';
  return (
    <BreakdownPanel
      subject={{
        // Colons are legal in a test id but awkward in every selector that reads
        // one, so the key the engine uses becomes a dash here.
        id: `${breakdown.month}-${breakdown.flow}`,
        name: `${isIncome ? 'Income' : 'Spending'} in ${windowLabel}`,
        headlineCents: breakdown.headlineCents,
        rows: breakdown.rows,
        sumCents: breakdown.sumCents,
        reconciles: breakdown.reconciles,
        clampedByNetRefund: breakdown.clampedByNetRefund,
      }}
      emptyToggleLabel="Nothing counted here — see why"
      emptyCopy={monthFlowEmptyCopy(breakdown.flow, windowLabel)}
      // Passes CENTS: the copy takes the magnitude itself, so this call site
      // cannot reintroduce the sign bug both critics found.
      netRefundCopy={monthFlowNetRefundCopy(breakdown.sumCents, windowLabel)}
      basis={[MONTH_FLOW_BASIS[breakdown.flow]]}
      registerHref={monthRegisterHref(breakdown.month)}
      // Claims the WINDOW, never the rows — see `monthRegisterHref`, which
      // explains why no register filter can express one half of a month.
      registerLabel={`Open all of ${windowLabel} in your activity list →`}
      testIdPrefix={testIdPrefix}
      defaultOpen={defaultOpen}
    />
  );
}
