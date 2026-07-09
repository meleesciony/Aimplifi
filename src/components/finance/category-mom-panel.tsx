'use client';

/**
 * Category month-over-month drill-down panel (DECISIONS #171). Pure presentation
 * of CategorySpendSeries — no recomputation. Register deep-link uses the same
 * month bounds helper the engine tests pin. Omits type=expense so refunds that
 * net into the MoM total still appear in the register (critic P1).
 */
import Link from 'next/link';
import { formatMonth, monthDateBounds } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import type { CategorySpendSeries } from '@/lib/engine/reports/reports';

function registerHref(categoryId: string, ym: string): string {
  const { from, to } = monthDateBounds(ym);
  // No type=expense: MoM nets refunds into the category total, so the register
  // must include inflows filed to the same category for the user to reconcile.
  const q = new URLSearchParams({
    category: categoryId,
    from,
    to,
  });
  return `/transactions?${q.toString()}`;
}

function formatDelta(deltaCents: number, pctChange: number | null): string {
  const sign = deltaCents > 0 ? '+' : deltaCents < 0 ? '−' : '';
  const abs = formatCents(cents(Math.abs(deltaCents)));
  if (pctChange === null) {
    return deltaCents === 0 ? 'unchanged vs prior month' : `${sign}${abs} vs prior month (new)`;
  }
  const pct = Math.round(Math.abs(pctChange) * 100);
  const dir = deltaCents > 0 ? 'up' : deltaCents < 0 ? 'down' : 'unchanged';
  if (deltaCents === 0) return 'unchanged vs prior month';
  return `${dir} ${sign}${abs} (${pct}%) vs prior month`;
}

export function CategoryMomPanel({ series }: { series: CategorySpendSeries }) {
  const max = Math.max(1, ...series.months.map((m) => m.amountCents));
  const priorYm =
    series.months.length >= 2 ? series.months[series.months.length - 2]!.ym : null;
  const endYm = series.months[series.months.length - 1]!.ym;
  const summary = series.months
    .map((m) => `${formatMonth(m.ym, 'short')}: ${formatCents(cents(m.amountCents))}`)
    .join('; ');

  return (
    <section
      className="rounded-2xl border bg-card p-5 shadow-sm"
      data-testid="category-mom-panel"
      aria-labelledby="category-mom-heading"
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 id="category-mom-heading" className="text-sm font-semibold">
          {series.name}
          <span className="ml-1 text-xs font-normal text-muted-foreground">· {series.group}</span>
        </h2>
        <Link
          href="/reports"
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline"
          data-testid="category-mom-clear"
        >
          All categories
        </Link>
      </div>
      <p className="mb-3 text-xs text-muted-foreground" data-testid="category-mom-delta">
        {formatCents(cents(series.currentCents))} this month ·{' '}
        {formatDelta(series.deltaCents, series.pctChange)}
        {priorYm ? ` (${formatMonth(priorYm, 'short')})` : ''}
      </p>
      <p className="mb-2 text-[11px] text-muted-foreground">
        Net spend by month — same definition as the category list (refunds netted; includes
        pending when present). Calendar months ending {formatMonth(endYm, 'short')}.
      </p>
      {/* Text summary for AT — the visual bars alone are not enough (critic P1 a11y). */}
      <p className="sr-only" data-testid="category-mom-summary">
        {series.name} net spend: {summary}.
      </p>
      <div className="flex items-end gap-1.5" data-testid="category-mom-bars" aria-hidden="true">
        {series.months.map((m) => (
          <div key={m.ym} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {m.amountCents > 0 ? formatCents(cents(m.amountCents)) : '—'}
            </span>
            <div className="flex h-24 w-full items-end justify-center rounded-sm bg-muted/40">
              <div
                className="w-full max-w-[2rem] rounded-t-sm bg-sky-400/90"
                style={{ height: `${(m.amountCents / max) * 100}%`, minHeight: m.amountCents > 0 ? 4 : 0 }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">{formatMonth(m.ym, 'short')}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-xs">
        <Link
          href={registerHref(series.categoryId, endYm)}
          className="font-medium text-foreground underline-offset-2 hover:underline"
          data-testid="category-mom-register-link"
        >
          See {formatMonth(endYm, 'short')} transactions →
        </Link>
        {series.categoryId === 'uncategorized' ? (
          <Link href="/triage" className="text-muted-foreground underline-offset-2 hover:underline">
            Review in Inbox →
          </Link>
        ) : null}
      </div>
    </section>
  );
}
