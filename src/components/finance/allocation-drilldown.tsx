'use client';

/**
 * The allocation bar with every segment tappable (O.20d) — a client island
 * inside the server-rendered /investments page.
 *
 * Segments are built by the pure `allocationSegments` engine from the SAME
 * per-account positions the page renders: grouped by symbol, each carrying the
 * per-account rows summed in the same pass (Σ rows === segment value by
 * construction — the panel's "matched to the penny" sentence is a real check).
 *
 * The bar drawn here is a PICTURE of those segments — the LEGEND entries are
 * the affordances (O.20f): a segment's painted bar is its weight in the row,
 * so a 2% position draws ~2px and a 2px-wide tap target is the affordance
 * being missing in miniature (the demo's NVDA segment was a 34×10px target,
 * and a portfolio priced at 0 drew every segment 0px — nothing tappable at
 * all). The legend buttons carry the symbol, the swatch, the percent and the
 * full 44px `.tap-target` floor; the bar stays a picture.
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
import { allocationPercent } from '@/components/finance/allocation-format';
import { usePanelToggleFocus } from '@/components/finance/use-panel-toggle-focus';

const ALLOC_COLORS = CHART_SERIES;

export function AllocationDrilldown({ segments }: { segments: AllocationSegment[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const selectedSegment = segments.find((s) => s.symbol === selected) ?? null;
  const { rememberOpener, restoreFocus } = usePanelToggleFocus();
  const pct = (w: number) => allocationPercent(w);

  return (
    <div data-testid="investments-allocation">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <PieChart className="size-3.5" aria-hidden /> Allocation
      </div>
      {/* The picture: the legend below carries the labels AND the controls
          (O.20f) — a segment painted to its weight is rarely finger-sized. */}
      <div
        className="mt-1.5 flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`Portfolio allocation by symbol: ${segments
          .map((s) => `${s.symbol} ${pct(s.weight)}%`)
          .join(', ')}`}
        data-testid="investments-allocation-bar"
      >
        {segments.map((s, i) => (
          <span
            key={s.symbol}
            className={`block h-full ${i === 0 ? 'rounded-l-full' : i === segments.length - 1 ? 'rounded-r-full' : ''}`}
            style={{ width: `${Math.max(0, s.weight * 100)}%`, background: ALLOC_COLORS[i % ALLOC_COLORS.length] }}
            aria-hidden
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {segments.map((s, i) => {
          const isOpen = selected === s.symbol;
          const pctLabel = `${s.symbol} ${pct(s.weight)}%`;
          return (
            <button
              key={s.symbol}
              type="button"
              data-testid={`allocation-segment-${s.symbol}`}
              data-open={isOpen ? 'true' : 'false'}
              // The visible text is a PREFIX of the accessible name (WCAG 2.5.3).
              aria-label={`${pctLabel} of the portfolio. Show the accounts holding it.`}
              aria-expanded={isOpen}
              onClick={(e) => {
                rememberOpener(e);
                setSelected(isOpen ? null : s.symbol);
              }}
              className={`tap-target inline-flex items-center gap-1 rounded-full border px-2.5 py-1 transition hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 ${
                isOpen
                  ? 'border-ring bg-accent font-medium text-foreground'
                  : 'border-border text-muted-foreground'
              }`}
            >
              <span
                className="size-2 rounded-full"
                style={{ background: ALLOC_COLORS[i % ALLOC_COLORS.length] }}
                aria-hidden
              />
              {pctLabel}
            </button>
          );
        })}
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
            restoreFocus(o); // …and puts focus back on the legend button (O.20f P2-d)
          }}
        />
      )}
    </div>
  );
}
