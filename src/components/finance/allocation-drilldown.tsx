'use client';

/**
 * The allocation bar with every segment tappable (O.20d) — a client island
 * inside the server-rendered /investments page.
 *
 * Segments are built by the pure `allocationSegments` engine from the SAME
 * per-account positions the page renders: grouped by symbol, each carrying the
 * per-account rows summed in the same pass (Σ rows === segment value by
 * construction — the panel's "matched to the penny" sentence is a real check).
 * The bar drawn here is a picture of those segments; the legend and the panel
 * are the affordances.
 *
 * Colors are stable by segment INDEX (first-appearance order, same as the
 * legend) — a reordering of the segments would repaint the bar and the legend
 * in the same commit.
 */
import { useState } from 'react';
import { PieChart } from 'lucide-react';
import { allocationPanelBasis, type AllocationSegment } from '@/lib/engine/investments/panel';
import { cents } from '@/lib/money';
import { BreakdownPanel } from '@/components/finance/breakdown-panel';
import { CHART_SERIES } from '@/lib/ui/chart-colors';

const ALLOC_COLORS = CHART_SERIES;

export function AllocationDrilldown({ segments }: { segments: AllocationSegment[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const selectedSegment = segments.find((s) => s.symbol === selected) ?? null;
  // Whole-percent when exact, one decimal otherwise — a sub-0.5% position must
  // not announce "0% of the portfolio" (critic P2-5); matches the legend.
  const pct = (w: number) => {
    const v = w * 100;
    return Number.isInteger(v) ? `${v}` : v.toFixed(1);
  };

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <PieChart className="size-3.5" aria-hidden /> Allocation
      </div>
      <div
        className="mt-1.5 flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="group"
        aria-label="Portfolio allocation by symbol — select a segment to see the accounts holding it"
        data-testid="investments-allocation"
      >
        {segments.map((s, i) => {
          const isOpen = selected === s.symbol;
          return (
            <button
              key={s.symbol}
              type="button"
              data-testid={`allocation-segment-${s.symbol}`}
              data-open={isOpen ? 'true' : 'false'}
              aria-label={`${s.symbol}: ${pct(s.weight)}% of the portfolio. Show the accounts holding it.`}
              aria-expanded={isOpen}
              onClick={() => setSelected(isOpen ? null : s.symbol)}
              className="cursor-pointer overflow-hidden rounded-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring first:rounded-l-full last:rounded-r-full"
              style={{ width: `${Math.max(0, s.weight * 100)}%` }}
            >
              {/* The whole segment is the hit target, not just this painted
                  bar: a 2% position draws ~2px, and a 2px tap target is the
                  affordance being missing again in a smaller way. */}
              <span
                className={`block h-full w-full ${isOpen ? '' : 'opacity-80'}`}
                style={{ background: ALLOC_COLORS[i % ALLOC_COLORS.length] }}
                aria-hidden
              />
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {segments.map((s, i) => (
          <span key={s.symbol} className="inline-flex items-center gap-1">
            <span
              className="size-2 rounded-full"
              style={{ background: ALLOC_COLORS[i % ALLOC_COLORS.length] }}
              aria-hidden
            />
            {s.symbol} {pct(s.weight)}%
          </span>
        ))}
      </div>

      {selectedSegment && (
        <BreakdownPanel
          // Remount on selection so `defaultOpen` re-applies: tapping the
          // segment IS the open gesture.
          key={selectedSegment.symbol}
          subject={{
            id: selectedSegment.symbol,
            name: `${selectedSegment.symbol} holdings`,
            headlineCents: selectedSegment.marketValueCents,
            rows: selectedSegment.rows,
            // Re-review F2: passing the headline as its own sum made "matched to
            // the penny" a sentence about itself — the panel could not detect a
            // row/figure divergence even in principle, and BreakdownPanel's
            // documented mismatch branch was dead code here. Σ of the rows the
            // reader is actually shown, compared against the figure.
            sumCents: cents(selectedSegment.rows.reduce((s, r) => s + r.amountCents, 0)),
            reconciles:
              selectedSegment.rows.reduce((s, r) => s + r.amountCents, 0) ===
              selectedSegment.marketValueCents,
            clampedByNetRefund: false,
          }}
          emptyCopy={`No holdings filed under ${selectedSegment.symbol}.`}
          netRefundCopy=""
          basis={allocationPanelBasis(
            selectedSegment.symbol,
            selectedSegment.marketValueCents,
            selectedSegment.accountCount,
          )}
          testIdPrefix="allocation"
          hideRowDates
          defaultOpen
          rowNoun="account"
          onToggle={(o) => {
            if (!o) setSelected(null); // inner Hide clears the segment (critic P2-1)
          }}
        />
      )}
    </div>
  );
}
