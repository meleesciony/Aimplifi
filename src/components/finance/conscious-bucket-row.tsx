/**
 * One Conscious Spending legend row, expandable (O.18b — the owner's "every
 * table" gesture applied to the one bar that could not honestly expand to
 * transactions). A bucket is a set of PLAN TERMS, not a transaction list, so
 * the panel behind each amount is the plan's own rows for that bucket — built
 * by `traceConsciousBuckets` from the safe-to-spend identity's rows and
 * reconciled against the very figure this row prints. The panel body is the
 * shared Glass-Box markup (`GlassBoxPanelBody`), so rows, total, penny-match
 * copy and basis sentences cannot drift from the app's other trace panels.
 *
 * The toggle is the AMOUNT, dotted-underlined — "tap a number, see the rows
 * it's made of" is the app's one gesture for this (#178), and this surface
 * must not invent a second one.
 */
'use client';

import { useId, useState, type ReactNode } from 'react';
import { GlassBoxPanelBody } from '@/components/finance/glass-box';
import type { NumberTrace } from '@/lib/engine/glass-box/trace';
import { formatCents } from '@/lib/money';

export function ConsciousBucketRow({
  label,
  swatchClass,
  textClass,
  shareLabel,
  trace,
  testIdPrefix,
}: {
  label: string;
  swatchClass: string;
  textClass: string;
  /** "· 32% (target 50–60%)" — authored by the strip (a server component may
   *  pass rendered JSX to a client prop), printed verbatim. */
  shareLabel: ReactNode;
  trace: NumberTrace;
  /** e.g. "conscious-fixed" — three of these panels share one page. */
  testIdPrefix: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <li>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 font-medium ${textClass}`}>
          <span className={`size-2 rounded-full ${swatchClass}`} aria-hidden />
          {label}
        </span>
        <span className="tabular-nums text-muted-foreground">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`${label} ${formatCents(trace.headlineCents)} — show what this number is made of`}
            data-testid={`${testIdPrefix}-toggle`}
            className="cursor-pointer rounded-sm tabular-nums underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 transition hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {formatCents(trace.headlineCents)}
          </button>{' '}
          {shareLabel}
        </span>
      </div>
      <div
        id={panelId}
        hidden={!open}
        role="region"
        aria-label={`What the ${label} figure is made of`}
        data-testid={`${testIdPrefix}-panel`}
        className="mt-1.5 rounded-xl border bg-muted/40 p-3 text-left"
      >
        <GlassBoxPanelBody trace={trace} testIdPrefix={testIdPrefix} />
      </div>
    </li>
  );
}
