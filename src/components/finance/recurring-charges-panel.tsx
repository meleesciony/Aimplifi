'use client';

/**
 * The expandable half of a /recurring row — "show me the charges this is
 * classified from" (O.18c, the owner's every-table-expandable ask).
 *
 * Same interaction as `BreakdownPanel` (the O.18 idiom this page was the last
 * holdout of): a toggle whose visible label spells out what is behind it, rows
 * mounted on FIRST open and then kept, and the copy contract printed
 * underneath — except the contract here is the INVERSE of the glass-box one.
 * A category panel's rows add up to the figure above it and says so; these
 * rows are the EVIDENCE, not a sum, and the first sentence (composed in
 * `recurring/panel.ts`, never here) says the amount above is the typical one,
 * not the total of these charges. No total is rendered — a cumulative sum of
 * N months of charges would read like a bill that size.
 *
 * The rows come from the very array the detector summed (`occurrenceRows`,
 * carried out of `detectRecurring`): expanding cannot show a different set
 * than the series was detected from.
 */
import { useId, useState } from 'react';
import type { RecurringOccurrence } from '@/lib/engine/recurring/detect';
import type { PanelNoun } from '@/lib/engine/recurring/panel';
import { formatISODate, isoDate } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';

export function RecurringChargesPanel({
  merchantCanonical,
  noun,
  rows,
  basis,
}: {
  merchantCanonical: string;
  noun: PanelNoun;
  /** The charges the series was detected from, oldest first (engine order). */
  rows: readonly RecurringOccurrence[];
  /** REQUIRED and NON-EMPTY: the copy contract, composed in the engine — a
   *  component that passes `[]` here would typecheck and render a money panel
   *  with no disclosure at all (the `basis` lesson). */
  basis: readonly [string, ...string[]];
}) {
  const [open, setOpen] = useState(false);
  /**
   * Rows are mounted on FIRST open and then kept, so a collapsed row costs an
   * empty `<div>` instead of its whole charge list — the /recurring page
   * renders every series at once, and a reader may open none of them.
   * (The container stays mounted so `aria-controls` always resolves.)
   */
  const [everOpened, setEverOpened] = useState(false);
  const panelId = useId();
  const count = rows.length;
  const nounPlural = `${noun}${count === 1 ? '' : 's'}`;
  const visibleLabel = open ? 'Hide' : `Show ${count} ${nounPlural}`;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setEverOpened(true);
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-controls={panelId}
        // WCAG 2.5.3: the accessible name must CONTAIN the visible string.
        aria-label={`${merchantCanonical}: ${visibleLabel}`}
        data-testid="recurring-charges-toggle"
        className="mt-1.5 inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <span aria-hidden="true" className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>
          ›
        </span>
        <span>{visibleLabel}</span>
      </button>

      <div
        id={panelId}
        hidden={!open}
        role="region"
        aria-label={`${nounPlural} behind ${merchantCanonical}`}
        data-testid="recurring-charges-panel"
        className="mt-1.5 rounded-xl border bg-muted/40 p-2.5"
      >
        {!everOpened ? null : (
          <>
            <ul className="divide-y" data-testid="recurring-charges-rows">
              {/* Newest first — the most recent charge, the one the figure above
                  quotes, is the first row a reader checks against it. */}
              {[...rows].reverse().map((r, i) => (
                <li
                  key={`${r.date}:${r.amountCents}:${i}`}
                  className="flex items-baseline justify-between gap-3 py-1.5 text-sm"
                >
                  <span className="min-w-0 break-words">
                    <span className="text-xs text-muted-foreground">{formatISODate(isoDate(r.date))}</span>
                    {/* The bank's own text — the exact string the detector read
                        when it grouped this charge into the series. */}
                    {r.descriptor && (
                      <span className="ml-1.5 break-words text-xs text-muted-foreground/80">{r.descriptor}</span>
                    )}
                  </span>
                  <span
                    className="shrink-0 whitespace-nowrap tabular-nums"
                    data-testid="recurring-charges-row-amount"
                  >
                    {formatCents(cents(r.amountCents))}
                  </span>
                </li>
              ))}
            </ul>
            {basis.map((b) => (
              <p
                key={b}
                className="mt-1.5 text-xs font-normal text-muted-foreground"
                data-testid="recurring-charges-basis"
              >
                {b}
              </p>
            ))}
          </>
        )}
      </div>
    </>
  );
}
