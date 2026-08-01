'use client';

/**
 * Reports view (DECISIONS #67): income vs. expense over 6 months + this month's
 * spending by category with parent-group rollup. Recharts for the bars; inline
 * bars for the category breakdown (crisp, no axis clutter).
 */
import Link from 'next/link';
import { useId, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { CategoryBreakdownPanel } from '@/components/finance/category-breakdown-panel';
import { CurrencyExclusionBanner } from '@/components/finance/currency-exclusion-banner';
import { CATEGORY_LINK_CLASS, categoryMonthRegisterHref } from '@/lib/engine/transactions/links';
import { formatMonth } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import { withheldInlineNote, type WithheldAccountSummary } from '@/lib/providers/currency';
import type { ReportsData } from '@/server/reports';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7))] ?? ym}`;

// Palette cycled across categories/groups (kept consistent within a render).
const PALETTE = ['#34d399', '#60a5fa', '#fbbf24', '#f87171', '#a78bfa', '#fb923c', '#22d3ee', '#f472b6', '#4ade80', '#94a3b8'];

/** How many category rows render before the tail folds into "Everything else". */
const TOP_CATEGORY_ROWS = 12;

export function ReportsView({
  data,
  withheld,
  linkableCategoryIds,
}: {
  data: ReportsData;
  withheld: WithheldAccountSummary;
  /**
   * Ids the register's category control can display (see `categoryRegisterHref`).
   * Required, not defaulted: an omitted set would silently render every row
   * unlinked, which looks like the feature was never built rather than like a bug.
   */
  linkableCategoryIds: string[];
}) {
  const linkable = new Set(linkableCategoryIds);
  const chartData = data.months.map((m) => ({
    name: monthLabel(m.month),
    income: m.incomeCents / 100,
    expense: m.expensesCents / 100,
  }));
  // O.19 (owner report 2026-07-31, with screenshots): the header beside this
  // list prints `totalCents`, which the engine sums over EVERY category — so a
  // list that silently stopped at 12 rows put "$28,253.04 total" above rows
  // summing to ~$19k, and the reader was right that the page's own numbers do
  // not add up. The cap stays (the ranking is what this card is for), but the
  // tail becomes a visible ROW: `restCents` is summed from the exact elements
  // the header total summed, same array, so the on-screen identity
  // `top rows + Everything else = total` holds by construction.
  const top = data.breakdown.byCategory.slice(0, TOP_CATEGORY_ROWS);
  const rest = data.breakdown.byCategory.slice(TOP_CATEGORY_ROWS);
  const restCents = rest.reduce((s, c) => s + c.amountCents, 0);
  const [showRest, setShowRest] = useState(false);
  const tailId = useId();
  // O.19 critic P1-1 (the label-in-name class this file already documents at
  // its category links): ONE string is the visible label AND the tail of the
  // accessible name, so they cannot diverge again.
  const restToggleLabel = showRest
    ? 'Hide'
    : `Show ${rest.length} more categor${rest.length === 1 ? 'y' : 'ies'}`;
  const max = Math.max(1, ...top.map((c) => c.amountCents));
  const hasFlows = data.months.some((m) => m.incomeCents !== 0 || m.expensesCents !== 0);
  // #135 residual 25: state the currency-exclusion assumption at the totals (null when
  // all-USD → renders nothing → byte-identical). The banner announces it once at the top;
  // this restates it where the spending total is shown.
  const currencyNote = withheldInlineNote(withheld);

  // One renderer for top and tail rows (O.19): the tail must be the IDENTICAL
  // row — link/refusal rules, bars, expander panels — never a second copy that
  // could drift. Palette index continues through the tail (i + TOP_CATEGORY_ROWS)
  // so expanding cannot recolor the rows already on screen.
  const renderRow = (c: ReportsData['breakdown']['byCategory'][number], i: number) => {
    const href = categoryMonthRegisterHref(
      { categoryId: c.categoryId, month: data.ym, amountCents: c.amountCents },
      linkable,
    );
    return (
      <div key={c.categoryId}>
        {/* O.5: the figure is the link. The href carries THIS card's window
            (data.ym) so the register it lands on nets to exactly the amount
            printed here — a landing page summing to a different number would
            be worse than no link.

            EXCEPT the uncategorized bucket. The register would filter those
            rows correctly, but its category <select> deliberately omits the
            placeholder (categorize/assign.ts:19 — "uncategorized" is the
            absence of a decision, not a filing target), so the control would
            read "All categories" over a filtered list, and the reader's next
            filter change would silently drop the category. That bucket
            already has the better destination — the inbox that drains it. */}
        {href === null ? (
          <div className="flex items-baseline justify-between text-sm">
            <span className="min-w-0 truncate">
              {c.name} <span className="text-xs text-muted-foreground">· {c.group}</span>
              {/* #166: "Uncategorized" topping the list with no path to fix it
                  reads as broken — link straight to the inbox that drains it.
                  OUTSIDE the truncating span: inside it, `overflow:hidden` +
                  `nowrap` clipped ~45px of this 98px link at 380px (O.5 critic
                  F-6), hiding the arrow and half the words — and it is the only
                  affordance this row has, now that the row itself is not a link. */}
            </span>
            <span className="ml-2 flex shrink-0 items-baseline gap-2">
              {c.categoryId === 'uncategorized' && (
                <Link
                  href="/triage"
                  className="whitespace-nowrap text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  review in Inbox →
                </Link>
              )}
              <span className="tabular-nums">{formatCents(cents(c.amountCents))}</span>
            </span>
          </div>
        ) : (
          <Link
            href={href}
            data-testid={`category-link-${c.categoryId}`}
            // Includes the group so the accessible name CONTAINS the visible
            // text (WCAG 2.5.3) — an aria-label replaces it, and dropping
            // "· Food & Dining" made voice control unable to match on it.
            aria-label={`${c.name} · ${c.group}: ${formatCents(cents(c.amountCents))} in ${monthLabel(data.ym)} — view these transactions`}
            // Owner-reported 2026-07-31 ("you didn't fix this and all bar
            // charts"): the BAR was a sibling of this anchor, so the widest,
            // most obviously chart-like thing on the card was the one part of
            // the row that did not respond to a tap. `block` + an inner flex
            // keeps the row's layout byte-identical and puts the bar inside
            // the same target. No new claim — same href, same figure.
            className="block rounded-sm text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <span className="flex items-baseline justify-between">
              <span className="min-w-0 truncate">
                {c.name} <span className="text-xs text-muted-foreground">· {c.group}</span>
              </span>
              {/* O.6 critic P1-1: the affordance rides the FIGURE, not the whole
                  row — a dotted underline stretched across a space-between flex
                  would underline the gap. Same constant the other two surfaces
                  use, so the "money you can tap" cue is one gesture app-wide;
                  previously this row's only cue was `hover:underline`, which a
                  phone does not have. */}
              <span className={`ml-2 shrink-0 tabular-nums ${CATEGORY_LINK_CLASS}`}>
                {formatCents(cents(c.amountCents))}
              </span>
            </span>
            <span className="mt-1 block h-2 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-2 rounded-full"
                style={{ width: `${(c.amountCents / max) * 100}%`, backgroundColor: PALETTE[i % PALETTE.length] }}
              />
            </span>
          </Link>
        )}
        {href === null && (
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-2 rounded-full"
              style={{ width: `${(c.amountCents / max) * 100}%`, backgroundColor: PALETTE[i % PALETTE.length] }}
            />
          </div>
        )}
        {/* Deliberately a SIBLING of the row anchor, never inside it: an
            interactive control nested in an anchor is invalid HTML and
            the anchor swallows its clicks (the same constraint /budgets
            records about its Clear button). The row keeps its whole-row
            tap target; the expander is its own. */}
        <CategoryBreakdownPanel
          breakdown={data.breakdowns[c.categoryId]}
          categoryName={c.name}
          windowLabel={formatMonth(data.ym)}
          registerHref={href}
          testIdPrefix="reports-breakdown"
        />
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* currency-guard disclosure (#135 residual): withheld non-USD accounts must not
          vanish silently. Renders nothing for all-USD users (the overwhelming case). */}
      <CurrencyExclusionBanner summary={withheld} />
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Reports</h1>
        <Link href="/trends" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          See trends →
        </Link>
      </div>

      {/* Income vs Expense */}
      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Income vs. spending</h2>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-emerald-400" /> Income
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-rose-400" /> Spending
            </span>
          </div>
        </div>
        {hasFlows ? (
          <div className="h-48" data-testid="income-expense-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeOpacity={0.15} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} />
                <Tooltip
                  cursor={{ fillOpacity: 0.06 }}
                  formatter={(v) => formatCents(cents(Math.round(Number(v) * 100)))}
                  contentStyle={{ borderRadius: 8, fontSize: 12 }}
                />
                <Bar dataKey="income" fill="#34d399" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expense" fill="#fb7185" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground" data-testid="income-expense-empty">
            No income or spending recorded in the last 6 months.
          </p>
        )}
      </section>

      {/* Spending by category */}
      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Spending by category</h2>
          <span className="text-xs text-muted-foreground">
            {monthLabel(data.ym)} · {formatCents(cents(data.breakdown.totalCents))} total
          </span>
        </div>
        {currencyNote ? (
          <p className="mb-2 text-xs text-muted-foreground" data-testid="reports-currency-note">
            {currencyNote}
          </p>
        ) : null}
        {top.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No spending this month yet.</p>
        ) : (
          <div className="space-y-2.5" data-testid="category-breakdown">
            {top.map((c, i) => renderRow(c, i))}
            {/* O.19: the tail's subtotal is a row, so the list visibly recomposes
                the header total in BOTH states. No bar: a sum of many categories
                drawn against single-category bars would invite a comparison the
                chart does not mean. Not a link either: this is not one category,
                and O.5 refuses an href whose destination cannot display the
                filter. "more", never "smaller" (critic P2-1): a rank-13 amount
                can TIE rank-12 to the penny, and "more" is exactly true. The
                subtotal sits ABOVE the tail it controls (critic P2-2): disclosure
                content follows its trigger in reading order, and the target
                stays mounted so `aria-controls` always resolves — the same rule
                the sibling panel component records. */}
            {rest.length > 0 && (
              <div data-testid="reports-everything-else">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="min-w-0 truncate">
                    Everything else{' '}
                    <span className="text-xs text-muted-foreground">
                      · {rest.length} more categor{rest.length === 1 ? 'y' : 'ies'}
                    </span>
                  </span>
                  <span
                    className="ml-2 shrink-0 tabular-nums"
                    data-testid="reports-everything-else-amount"
                  >
                    {formatCents(cents(restCents))}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRest((o) => !o)}
                  aria-expanded={showRest}
                  aria-controls={tailId}
                  // WCAG 2.5.3 (critic P1-1, the label-in-name class this file
                  // already documents on its category links): the accessible
                  // name CONTAINS the visible label because they are ONE string.
                  aria-label={`Everything else: ${restToggleLabel}`}
                  data-testid="reports-everything-else-toggle"
                  className="mt-1 inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <span aria-hidden="true" className={`inline-block transition-transform ${showRest ? 'rotate-90' : ''}`}>
                    ›
                  </span>
                  <span>{restToggleLabel}</span>
                </button>
              </div>
            )}
            <div
              id={tailId}
              hidden={!showRest}
              className="space-y-2.5"
              data-testid="reports-everything-else-rows"
            >
              {rest.map((c, i) => renderRow(c, i + TOP_CATEGORY_ROWS))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
