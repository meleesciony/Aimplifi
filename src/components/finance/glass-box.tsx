/**
 * Glass-Box number (DECISIONS #178) — tap a headline amount to see the rows
 * it is made of, reconciled to the penny. Pure display: every value comes
 * from a NumberTrace built by the engine layer (engine/glass-box/trace.ts);
 * nothing is recomputed here, and the shown Total is the trace's own row sum
 * displayed verbatim — never a clamped or prettified value.
 */
'use client';

import { useId, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { CardTitle } from '@/components/ui/card';
import { GlassBoxShare } from '@/components/finance/glass-box-share';
import type { NumberTrace } from '@/lib/engine/glass-box/trace';
import { formatISODate, isoDate } from '@/lib/dates';
import { formatCents } from '@/lib/money';

export function GlassBoxNumber({
  trace,
  amountTestId,
  amountClassName,
  children,
}: {
  trace: NumberTrace;
  amountTestId: string;
  amountClassName?: string;
  /** Caption rendered between the number and the (toggleable) panel. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <>
      <CardTitle className={amountClassName}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${formatCents(trace.headlineCents)} — show what this number is made of`}
          data-testid={amountTestId}
          className="cursor-pointer rounded-sm underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 transition hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {formatCents(trace.headlineCents)}
        </button>
      </CardTitle>
      {children}
      <div
        id={panelId}
        hidden={!open}
        role="region"
        aria-label="What this number is made of"
        data-testid="glass-box-panel"
        className="mt-2 rounded-xl border bg-muted/40 p-3"
      >
        <ul className="divide-y" data-testid="glass-box-rows">
          {trace.rows.map((r) => (
            <li key={r.id} className="py-1.5 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0">
                  <span className="font-normal">{r.label}</span>
                  {r.date && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      due {formatISODate(isoDate(r.date))}
                    </span>
                  )}
                  {(r.autopayCents ?? 0) > 0 && (
                    <span className="ml-1.5 text-xs text-muted-foreground">(autopay)</span>
                  )}
                  {r.isEstimated && (
                    <Badge variant="outline" className="ml-1.5 align-middle">
                      est.
                    </Badge>
                  )}
                </span>
                <span
                  className="whitespace-nowrap font-medium tabular-nums"
                  data-testid="glass-box-row-amount"
                >
                  {formatCents(r.amountCents)}
                </span>
              </div>
              {r.notes.map((n) => (
                <p key={n} className="mt-0.5 text-xs font-normal text-muted-foreground">
                  {n}
                </p>
              ))}
            </li>
          ))}
        </ul>
        <div className="mt-1 flex items-baseline justify-between gap-3 border-t pt-2 text-sm font-semibold">
          <span>Total</span>
          <span className="tabular-nums" data-testid="glass-box-sum">
            {formatCents(trace.sumCents)}
          </span>
        </div>
        {trace.reconciles ? (
          <p
            className="mt-1.5 text-xs font-normal text-muted-foreground"
            data-testid="glass-box-reconciled"
          >
            {trace.rows.length === 1 ? 'This row adds' : `These ${trace.rows.length} rows add`} up
            to exactly the number above — matched to the penny. Every amount is computed from your
            own data; nothing is invented.
          </p>
        ) : (
          <p className="mt-1.5 text-xs font-normal" data-testid="glass-box-mismatch">
            These rows don&apos;t add up to the number above exactly — we can&apos;t fully reconcile
            it right now, and we&apos;d rather say so than pretend.
          </p>
        )}
        {trace.basis.map((b) => (
          <p key={b} className="mt-1 text-xs font-normal text-muted-foreground">
            {b}
          </p>
        ))}
        <GlassBoxShare trace={trace} />
      </div>
    </>
  );
}
