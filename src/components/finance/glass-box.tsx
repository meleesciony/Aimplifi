/**
 * Glass-Box number (DECISIONS #178) — tap a headline amount to see the rows
 * it is made of, reconciled to the penny. Pure display: every value comes
 * from a NumberTrace built by the engine layer (engine/glass-box/trace.ts);
 * nothing is recomputed here, and the shown Total is the trace's own row sum
 * displayed verbatim — never a clamped or prettified value.
 */
'use client';

import Link from 'next/link';
import { useId, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { CardTitle } from '@/components/ui/card';
import { GlassBoxShare } from '@/components/finance/glass-box-share';
import type { NumberTrace } from '@/lib/engine/glass-box/trace';
import { formatISODate, isoDate } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { logEngagement } from '@/server/engagement-actions';
import type { EngagementSubjectKey } from '@/lib/engine/engagement/event';

export function GlassBoxNumber({
  trace,
  amountTestId,
  amountClassName,
  engagementSubjectKey,
  children,
}: {
  trace: NumberTrace;
  amountTestId: string;
  amountClassName?: string;
  /** When set, opening the panel records an `expanded` engagement event (TASKS 3.1). */
  engagementSubjectKey?: EngagementSubjectKey;
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
          onClick={() => {
            setOpen((o) => {
              const next = !o;
              if (next && engagementSubjectKey) {
                void logEngagement({
                  surface: 'dashboard',
                  verb: 'expanded',
                  subjectKey: engagementSubjectKey,
                });
              }
              return next;
            });
          }}
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
        <GlassBoxPanelBody trace={trace} />
      </div>
    </>
  );
}

/**
 * The panel's contents, extracted (O.18b) so the Conscious Spending strip's
 * per-bucket expanders render the IDENTICAL rows/total/reconciliation/basis
 * markup rather than a second copy that could drift. `testIdPrefix` defaults
 * to the ids this panel has always had — existing consumers and their e2e
 * locators are byte-identical — and the strip passes its own prefix because
 * three of these panels share a page there, where duplicate testids would
 * break strict-mode locators.
 */
export function GlassBoxPanelBody({
  trace,
  testIdPrefix = 'glass-box',
}: {
  trace: NumberTrace;
  testIdPrefix?: string;
}) {
  return (
    <>
      <ul className="divide-y" data-testid={`${testIdPrefix}-rows`}>
        {trace.rows.map((r) => (
          <li key={r.id} className="py-1.5 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0">
                <span className="font-normal">{r.label}</span>
                {/* The control a "you have not set this up" zero carries (L.29).
                    The ENGINE decides which rows have one; this body used to
                    drop it, which left the dashboard hero's savings $0 naming a
                    control the panel then failed to offer. In the label cell,
                    never the amount cell — amounts are parsed as money. */}
                {r.action && (
                  <Link
                    href={r.action.href}
                    className="ml-1.5 whitespace-nowrap text-xs underline underline-offset-2 hover:text-foreground"
                    data-testid={`${testIdPrefix}-row-action`}
                  >
                    {r.action.label}
                  </Link>
                )}
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
                data-testid={`${testIdPrefix}-row-amount`}
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
        <span className="tabular-nums" data-testid={`${testIdPrefix}-sum`}>
          {formatCents(trace.sumCents)}
        </span>
      </div>
      {trace.reconciles ? (
        <p
          className="mt-1.5 text-xs font-normal text-muted-foreground"
          data-testid={`${testIdPrefix}-reconciled`}
        >
          {trace.rows.length === 1 ? 'This row adds' : `These ${trace.rows.length} rows add`} up
          to exactly the number above — matched to the penny. Every amount is computed from your
          own data; nothing is invented.
        </p>
      ) : (
        <p className="mt-1.5 text-xs font-normal" data-testid={`${testIdPrefix}-mismatch`}>
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
    </>
  );
}
