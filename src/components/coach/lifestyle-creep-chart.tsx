'use client';

/**
 * The lifestyle-creep bar strip, with every bar tappable (O.20d).
 *
 * The creep card's strip was twelve inert `<div>`s with a `title` tooltip —
 * the hover-only affordance that does not exist on the phone the owner uses
 * (the exact failure savings-rate-chart.tsx documents). Each bar is now the
 * same gesture the savings-rate bars have: tap it, and the month's panel opens
 * showing the discretionary purchases the figure was summed from.
 *
 * What a bar expands into: the ROWS `detectLifestyleCreep` carried out of the
 * same loop that summed the figure (Σ rows === the figure by construction —
 * the panel's "matched to the penny" sentence is a real check), the
 * engine-composed basis sentence, and a link to that month in the activity
 * list where the reader can re-file any row.
 */
import { useState } from 'react';
import type { CreepResult } from '@/lib/engine/fi/insights';
import { creepPanelBasis } from '@/lib/engine/fi/insights';
import { BreakdownPanel } from '@/components/finance/breakdown-panel';
import { usePanelToggleFocus } from '@/components/finance/use-panel-toggle-focus';
import { monthRegisterHref } from '@/lib/engine/transactions/links';
import { cents, formatCents } from '@/lib/money';
import { formatMonth } from '@/lib/dates';

export function LifestyleCreepChart({ creep }: { creep: CreepResult }) {
  const [selected, setSelected] = useState<string | null>(null);
  const { rememberOpener, restoreFocus } = usePanelToggleFocus();
  const months = creep.monthlyDiscretionaryCents;
  const max = Math.max(...months.map((m) => m.amountCents), 1);
  const selectedEntry = selected ? months.find((m) => m.month === selected) : undefined;
  const selectedLabel = selectedEntry ? formatMonth(selectedEntry.month) : '';
  // Summed ONCE (U.16): the panel prints this, checks the headline against it,
  // and the handover sentence's "these still add up" clause is gated on the
  // same check — three readers of one number, which must not be three reduces
  // that could drift apart.
  const selectedSumCents = cents(selectedEntry ? selectedEntry.rows.reduce((s, r) => s + r.amountCents, 0) : 0);
  const selectedReconciles = selectedEntry ? selectedSumCents === selectedEntry.amountCents : false;

  return (
    <>
      <div
        className="flex h-14 items-end gap-1"
        role="group"
        aria-label={`Monthly discretionary spend, last ${months.length} months — select a month to see the purchases behind it`}
      >
        {months.map((m) => {
          const isOpen = selected === m.month;
          const label = formatMonth(m.month);
          return (
            <button
              key={m.month}
              type="button"
              data-testid={`creep-bar-${m.month}`}
              data-open={isOpen ? 'true' : 'false'}
              // The accessible name carries the month AND its amount, because
              // the bar height is data-scaled and colour is the only other cue.
              aria-label={`${label}: ${formatCents(m.amountCents)} of discretionary spending. Show the purchases behind it.`}
              aria-expanded={isOpen}
              title={`${label}: ${formatCents(m.amountCents)}`}
              onClick={(e) => {
                rememberOpener(e);
                setSelected(isOpen ? null : m.month);
              }}
              className={`flex w-full cursor-pointer items-end justify-center rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                isOpen ? 'ring-2 ring-ring ring-offset-1' : ''
              }`}
              // The whole 56px column is the hit target, not just the drawn
              // bar: a near-zero month draws 4px, and a 4px tap target is the
              // affordance being missing again in a smaller way.
              style={{ height: '56px', alignItems: 'flex-end' }}
            >
              <span
                className={`block w-full rounded-sm ${isOpen ? 'bg-amber-500' : 'bg-amber-500/70'}`}
                style={{ height: `${Math.max(4, Math.round((m.amountCents / max) * 52))}px` }}
                aria-hidden
              />
            </button>
          );
        })}
      </div>

      <div className="flex justify-between text-[10px] text-muted-foreground" data-testid="creep-axis">
        <span>
          {formatMonth(months[0].month, 'short')} · {formatCents(months[0].amountCents)}
        </span>
        <span>
          {formatMonth(months[months.length - 1].month, 'short')} ·{' '}
          {formatCents(months[months.length - 1].amountCents)}
        </span>
      </div>

      {selectedEntry && (
        <div className="border-t pt-2">
          <BreakdownPanel
            // Remount on selection so `defaultOpen` re-applies: tapping the
            // bar IS the open gesture.
            key={selectedEntry.month}
            subject={{
              id: selectedEntry.month,
              name: `${selectedLabel} discretionary spend`,
              headlineCents: selectedEntry.amountCents,
              rows: selectedEntry.rows,
              sumCents: selectedSumCents,
              // Re-review F2: the sum above is a real reduce, but a literal
              // `true` still asserted the match rather than checking it.
              reconciles: selectedReconciles,
              clampedByNetRefund: false,
            }}
            emptyCopy={`No discretionary purchases were filed in ${selectedLabel} — a $0.00 month is a real answer.`}
            netRefundCopy=""
            basis={creepPanelBasis(
              selectedLabel,
              selectedEntry.amountCents,
              selectedEntry.hasDiscretionaryRefunds,
              selectedEntry.countedOnHandoverDays,
              // The panel only PRINTS a tally when it has more than one row.
              selectedReconciles && selectedEntry.rows.length > 1,
            )}
            registerHref={monthRegisterHref(selectedEntry.month)}
            registerLabel={`Open ${selectedLabel} in your activity, where you can re-file one →`}
            testIdPrefix="creep-bar"
            defaultOpen
            onToggle={(o) => {
              if (!o) setSelected(null); // inner Hide clears the bar (critic P2-1)
              restoreFocus(o); // …and puts focus back on the bar (O.20f P2-d)
            }}
          />
        </div>
      )}
    </>
  );
}
