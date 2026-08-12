'use client';

/**
 * The drilldown behind the net-worth trend (O.20d): a row of point chips —
 * one per recorded balance date, plus "Today" — each opening the constituent
 * panel behind that point.
 *
 * The trend chart itself stays a passive picture; these chips are the
 * affordance the owner's "every single bar" request is about, and they work
 * for keyboard and phone alike (a Recharts point has no real hit target).
 *
 * The panel shows the point's CONSTITUENTS — the signed account balances the
 * engine summed in the same pass that produced the point (`netWorthSeries`
 * carries them), so Σ rows === the figure by construction and the panel's
 * "matched to the penny" sentence is a real check. Recorded points and the
 * live "today" point get DIFFERENT basis sentences: they are built from
 * different things (snapshots vs live balances incl. manual items), and the
 * sentences are engine-composed so a component cannot restate them wrongly.
 *
 * The chip strip is CAPPED to the last 18 points (O.20f P2-f): the card is
 * documented as an "18-month trend", and one chip per snapshot ever is a wall
 * of pills on a 380px dashboard once a long-lived user has years of snapshots
 * (18 pills already wrap to three rows). The most recent 18 — with the live
 * point always last — is what the chart's own span calls useful; the chart
 * still draws the full history.
 */
import { useState } from 'react';
import type { NetWorthSeriesPoint } from '@/lib/engine/networth/series';
import { netWorthLiveBasis, netWorthPointBasis } from '@/lib/engine/networth/panel';
import { BreakdownPanel } from '@/components/finance/breakdown-panel';
import { usePanelToggleFocus } from '@/components/finance/use-panel-toggle-focus';
import { cents, formatCents } from '@/lib/money';
import { formatISODate, isoDate } from '@/lib/dates';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The chip strip's window: the card's own "18-month trend" span. */
const CHIP_WINDOW = 18;

export function NetWorthTrendDrilldown({
  points,
  testIdPrefix,
}: {
  points: NetWorthSeriesPoint[];
  testIdPrefix: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const { rememberOpener, restoreFocus } = usePanelToggleFocus();
  const liveDate = points.length > 0 ? points[points.length - 1].date : null;
  const selectedPoint = points.find((p) => p.date === selected) ?? null;
  // The live point is built from every account's CURRENT class (`netWorthSeries`
  // says so in its own comment), so it is the current-class source already in
  // this component's props — no new prop, no second query.
  const currentClassById = new Map(
    (points.length > 0 ? points[points.length - 1].constituents : []).map((c) => [
      c.accountId,
      c.isLiability,
    ]),
  );
  // The strip is the tap affordance for the RECENT trend; older points stay on
  // the chart. `slice(-N)` keeps the live point last by construction.
  const shown = points.slice(-CHIP_WINDOW);

  const chipLabel = (date: string) =>
    date === liveDate ? 'Today' : `${MONTHS[+date.slice(5, 7) - 1]} ${+date.slice(8, 10)}`;

  return (
    <>
      {points.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid={`${testIdPrefix}-points`}>
          {shown.map((p) => {
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
                onClick={(e) => {
                  rememberOpener(e);
                  setSelected(isOpen ? null : p.date);
                }}
                className={`tap-target rounded-full border px-2.5 py-1 text-xs transition hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 ${
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
            rows: selectedPoint.constituents.map((c, i) => ({
              // Index-suffixed: the engine blesses two same-account snapshots
              // on one date as two constituents, and `accountId` alone would
              // collide on the React key (O.20f P2-e).
              key: `${c.accountId}:${i}`,
              transactionId: null,
              date: selectedPoint.date,
              // U.6: a point counts each account as the class it was RECORDED
              // under, so a reclassified account appears here with the opposite
              // sign to the one it has today — a credit card rendered positive
              // inside a sum the basis sentence calls "assets minus
              // liabilities". The live point (always last) carries every
              // account's current class, so the disagreement is nameable
              // without a new prop, and the fact rides the row that carries the
              // money rather than a sentence below the list.
              label:
                currentClassById.get(c.accountId) !== undefined &&
                currentClassById.get(c.accountId) !== c.isLiability
                  ? `${c.name} · counted here as money you ${c.isLiability ? 'owed' : 'owned'}`
                  : c.name,
              rawDescriptor: null,
              amountCents: cents(c.balanceCents),
              isPending: false,
              // U.16: a BALANCE, not a transaction. U.13 verified this
              // deliberately — net worth reads only snapshots and current
              // balances, with no transaction input at all, so the released
              // handover day cannot reach these constituents. A same-date pair
              // here is the F3 snapshot rule's business (U.9/U.12), not this
              // field's.
              onHandoverDay: false,
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
              : netWorthPointBasis(cents(selectedPoint.netWorthCents), isoDate(selectedPoint.date))
          }
          testIdPrefix={`${testIdPrefix}-constituents`}
          hideRowDates
          defaultOpen
          rowNoun="account"
          onToggle={(o) => {
            if (!o) setSelected(null); // inner Hide clears the chip (critic P2-1)
            restoreFocus(o); // …and puts focus back on the chip (O.20f P2-d)
          }}
        />
      )}
    </>
  );
}
