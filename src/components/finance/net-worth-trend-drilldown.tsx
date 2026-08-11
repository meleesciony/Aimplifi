'use client';

/**
 * The drilldown behind the net-worth trend (O.20d): a row of point chips —
 * one per month-end, plus "Today" — each opening the constituent panel behind
 * that point.
 *
 * The trend chart itself stays a passive picture; these chips are the
 * affordance the owner's "every single bar" request is about, and they work
 * for keyboard and phone alike (a Recharts point has no real hit target).
 *
 * The panel shows the point's CONSTITUENTS — the signed account balances the
 * engine summed in the same pass that produced the point (`netWorthSeries`
 * carries them), so Σ rows === the figure by construction and the panel's
 * "matched to the penny" sentence is a real check. Month-end points and the
 * live "today" point get DIFFERENT basis sentences: they are built from
 * different things (snapshots vs live balances incl. manual items), and the
 * sentences are engine-composed so a component cannot restate them wrongly.
 */
import { useState } from 'react';
import type { NetWorthSeriesPoint } from '@/lib/engine/networth/series';
import { netWorthLiveBasis, netWorthMonthEndBasis } from '@/lib/engine/networth/panel';
import { BreakdownPanel } from '@/components/finance/breakdown-panel';
import { cents, formatCents } from '@/lib/money';
import { formatISODate, isoDate } from '@/lib/dates';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function NetWorthTrendDrilldown({
  points,
  testIdPrefix,
}: {
  points: NetWorthSeriesPoint[];
  testIdPrefix: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const liveDate = points.length > 0 ? points[points.length - 1].date : null;
  const selectedPoint = points.find((p) => p.date === selected) ?? null;

  const chipLabel = (date: string) =>
    date === liveDate ? 'Today' : `${MONTHS[+date.slice(5, 7) - 1]} ${+date.slice(8, 10)}`;

  return (
    <>
      {points.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid={`${testIdPrefix}-points`}>
          {points.map((p) => {
            const isOpen = selected === p.date;
            const label = chipLabel(p.date);
            return (
              <button
                key={p.date}
                type="button"
                data-testid={`${testIdPrefix}-point-${p.date}`}
                data-open={isOpen ? 'true' : 'false'}
                aria-label={`${label}: net worth ${formatCents(cents(p.netWorthCents))}. Show the accounts it is made of.`}
                aria-expanded={isOpen}
                onClick={() => setSelected(isOpen ? null : p.date)}
                className={`rounded-full border px-2.5 py-1 text-xs transition hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  isOpen
                    ? 'border-ring bg-accent font-medium text-foreground'
                    : 'border-border text-muted-foreground'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {selectedPoint && (
        <BreakdownPanel
          // Remount on selection so `defaultOpen` re-applies: tapping a chip IS
          // the open gesture (the savings-rate precedent).
          key={selectedPoint.date}
          subject={{
            id: selectedPoint.date,
            name:
              selectedPoint.date === liveDate
                ? 'Net worth today'
                : `Net worth on ${formatISODate(isoDate(selectedPoint.date))}`,
            headlineCents: cents(selectedPoint.netWorthCents),
            rows: selectedPoint.constituents.map((c) => ({
              key: c.accountId,
              transactionId: null,
              date: selectedPoint.date,
              label: c.name,
              rawDescriptor: null,
              amountCents: cents(c.balanceCents),
              isPending: false,
            })),
            sumCents: cents(
              selectedPoint.constituents.reduce((s, c) => s + c.balanceCents, 0),
            ),
            // Re-review F2: `sumCents` already re-summed the rendered rows, but
            // a literal `true` here would still have printed "matched to the
            // penny" over two visibly different numbers. Compare them.
            reconciles:
              selectedPoint.constituents.reduce((s, c) => s + c.balanceCents, 0) ===
              selectedPoint.netWorthCents,
            clampedByNetRefund: false,
          }}
          emptyCopy="This point has no accounts behind it — nothing was snapshotted or live on that date."
          netRefundCopy=""
          basis={
            selectedPoint.date === liveDate
              ? netWorthLiveBasis(cents(selectedPoint.netWorthCents))
              : netWorthMonthEndBasis(
                  cents(selectedPoint.netWorthCents),
                  formatISODate(isoDate(selectedPoint.date)),
                )
          }
          testIdPrefix={`${testIdPrefix}-constituents`}
          hideRowDates
          defaultOpen
          rowNoun="account"
          onToggle={(o) => {
            if (!o) setSelected(null); // inner Hide clears the chip (critic P2-1)
          }}
        />
      )}
    </>
  );
}
