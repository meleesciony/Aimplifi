'use client';

/**
 * Reports view (DECISIONS #67): income vs. expense over a trailing window the
 * reader picks (6 / 12 / 24 months) + this month's spending by category with
 * parent-group rollup. Recharts for the bars; inline bars for the category
 * breakdown (crisp, no axis clutter).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { CategoryBreakdownPanel } from '@/components/finance/category-breakdown-panel';
import {
  handoverDayAnswerNote,
  handoverDayUncountedNote,
  reportsNotCountedYetCopy,
  windowLabelSoFar,
} from '@/lib/engine/glass-box/category-breakdown';
import { MonthFlowPanel } from '@/components/finance/month-flow-panel';
import { CurrencyExclusionBanner } from '@/components/finance/currency-exclusion-banner';
import { CATEGORY_LINK_CLASS } from '@/lib/engine/transactions/links';
import { formatMonth } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import { withheldInlineNote, type WithheldAccountSummary } from '@/lib/providers/currency';
import { loanPaymentBasisSentence } from '@/server/loan-payment-basis';
import { REPORT_CHART_MONTHS, type ReportChartMonths } from '@/lib/engine/reports/chart-range';
import type { ReportsData } from '@/server/reports';
import { CHART_SERIES, CHART_POSITIVE, CHART_NEGATIVE } from '@/lib/ui/chart-colors';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7))] ?? ym}`;

// Palette cycled across categories/groups (kept consistent within a render).
const PALETTE = CHART_SERIES;

/** How many category rows render before the tail folds into "Everything else". */
const TOP_CATEGORY_ROWS = 12;

export function ReportsView({
  data,
  withheld,
  months,
}: {
  data: ReportsData;
  withheld: WithheldAccountSummary;
  /** Trailing length of the income/spending series (6 / 12 / 24 months). The
   *  page validated `?months=` against the same vocabulary before passing it. */
  months: ReportChartMonths;
}) {
  const router = useRouter();
  // C.26 (critic cycle 1, P1-1): the linkable fence and the C.25 refusals both
  // moved into `getReports`, with the window, because all three decide the same
  // thing — whether this figure may become a link and where it points — and a
  // decision split across a loader and a component is one a component can get
  // wrong. `data.categoryHrefs` is the whole answer, already made.
  const chartData = data.months.map((m) => ({
    name: monthLabel(m.month),
    // Carried on the datum so a bar click knows which month it is, without the
    // handler re-deriving one from an axis label that prints no year.
    month: m.month,
    income: m.incomeCents / 100,
    expense: m.expensesCents / 100,
  }));
  /**
   * Which bar the reader tapped (owner, 2026-08-01: *"every single bar … needs
   * to be immediately available"*).
   *
   * The chart is an SVG and its rectangles are not focusable, so the bar click
   * is an ACCELERATOR, never the only way in: the month buttons below the chart
   * are real buttons and reach the same panels. That keeps the feature usable
   * from a keyboard and from a screen reader, which a click handler bolted onto
   * a `<path>` would not.
   */
  /**
   * How far the chart's bar for THIS month sits from the category card's total
   * for the same month — 0 when they agree, which is the common case.
   *
   * Both numbers are already on the page and both are the ones the reader sees,
   * so this is a comparison of painted figures rather than a third derivation
   * that could be wrong on its own. The chart may not draw the current month at
   * all (a brand-new account), in which case there is nothing to compare and the
   * sentence stays silent.
   */
  const currentMonthBar = data.months.find((m) => m.month === data.ym);
  const basisGapCents = currentMonthBar
    ? data.breakdown.totalCents - currentMonthBar.expensesCents
    : 0;
  /**
   * The chart draws no bar at all for the current month while the card below
   * still prints a total for it.
   *
   * `monthlyFlows` emits only months containing a qualifying row, so a month
   * whose posted activity is entirely transfers, split containers or excluded
   * rows — or one with nothing posted yet, which is a just-linked account —
   * produces no entry, no bar and no month button. The first draft called that
   * "nothing to compare" and went silent, which is the largest disagreement the
   * page can show: one surface says the month has a total, the other says the
   * month does not exist.
   */
  const currentMonthMissingFromChart = !currentMonthBar && data.breakdown.totalCents !== 0;
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [autoOpenFlow, setAutoOpenFlow] = useState<'income' | 'expense' | null>(null);
  /**
   * Increments on EVERY bar tap, and is part of the tapped panel's key.
   *
   * Without it, tapping the same bar twice sets both pieces of state to values
   * they already hold, React bails out, the key is unchanged and no remount
   * happens — so after a reader taps a bar, presses Hide, and taps that same bar
   * again, nothing at all occurs. The chart's most obviously interactive element
   * goes inert, which is the "an affordance the reader cannot recognise is
   * indistinguishable from one that was never built" failure this panel's own
   * comment was written about.
   */
  const [barTapSeq, setBarTapSeq] = useState(0);
  const selectBar = (month: string | undefined, flow: 'income' | 'expense') => {
    if (!month) return; // a click that carried no datum selects nothing
    setSelectedMonth(month);
    setAutoOpenFlow(flow);
    setBarTapSeq((n) => n + 1);
  };
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
  // U.21: released-day rows in categories this page dropped (net <= 0). Summed
  // here rather than read as a length — the array is one entry per CATEGORY and
  // the sentence counts TRANSACTIONS.
  const uncountedHandoverRows = data.breakdown.uncountedOnHandoverDays.reduce((s, u) => s + u.count, 0);
  const [showRest, setShowRest] = useState(false);
  const tailId = useId();
  const panelsId = useId();
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
    // C.26 (critic cycle 1, P1-1): the href is BUILT BY `getReports`, from the
    // same window object it summed the figure with. This view no longer names a
    // window, so it cannot name a different one — the defect that reached
    // production here (a clamped $120.00 opening an unclamped $520.00) is now
    // unwritable at this call site rather than merely tested somewhere else.
    const href = data.categoryHrefs[c.categoryId] ?? null;
    return (
      <div key={c.categoryId}>
        {/* O.5: the figure is the link. The href carries THIS card's window
            (`data.window`, applied by `getReports`) so the register it lands on
            nets to exactly the amount
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
            // C.26 (critic cycle 1, P2-3): the window in the accessible name is
            // the FIGURE's, not the month's — "in Jun" was false on a figure
            // that stops at today, and this string is the whole label a screen
            // reader hears (it replaces the visible text).
            aria-label={`${c.name} · ${c.group}: ${formatCents(cents(c.amountCents))} in ${windowLabelSoFar(monthLabel(data.ym), data.notCountedYetCents)} — view these transactions`}
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Income vs. spending</h2>
            {/* Trailing-window picker (owner request 2026-08-04: "why are we
                only pulling 6 months of data?"). The chart always showed six
                months because nothing could ask for more; the selector commits
                `?months=` and the page re-derives the series at that length.
                The choice is limited to what history can actually feed — a
                reader whose bank was linked last month can still pick 24, and
                the chart simply draws the months that exist (monthlyFlows emits
                only months with qualifying rows), so a wider pick degrades to
                the truth instead of an error. */}
            <select
              aria-label="Chart range"
              value={months}
              onChange={(e) => router.push(`/reports?months=${e.target.value}`)}
              data-testid="reports-range"
              className="h-7 rounded-md border border-input bg-background px-1.5 text-xs text-foreground"
            >
              {REPORT_CHART_MONTHS.map((m) => (
                <option key={m} value={m}>
                  Last {m} months
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-positive-400" /> Income
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
                {/* Wider windows thin the labels so they cannot collide: every
                    month at 6, every 2nd at 12, every 3rd at 24 (the axis keeps
                    its month names; the tooltip and month buttons below always
                    carry the full "Mon 'YY"). */}
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  interval={months === 6 ? 0 : months === 12 ? 1 : 2}
                />
                <Tooltip
                  cursor={{ fillOpacity: 0.06 }}
                  formatter={(v) => formatCents(cents(Math.round(Number(v) * 100)))}
                  contentStyle={{ borderRadius: 8, fontSize: 12 }}
                />
                <Bar
                  dataKey="income"
                  fill={CHART_POSITIVE}
                  radius={[3, 3, 0, 0]}
                  className="cursor-pointer"
                  onClick={(d: { payload?: { month?: string } }) => selectBar(d?.payload?.month, 'income')}
                />
                <Bar
                  dataKey="expense"
                  fill={CHART_NEGATIVE}
                  radius={[3, 3, 0, 0]}
                  className="cursor-pointer"
                  onClick={(d: { payload?: { month?: string } }) => selectBar(d?.payload?.month, 'expense')}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="py-6 text-center">
            <p className="text-sm text-muted-foreground" data-testid="income-expense-empty">
              No income or spending recorded in the last {months} months.
            </p>
            {/* O.18e-FU2: the figureless state. The claim above is the
                surface's "silence means nothing did" — but a loan payment the
                figures drop is money that DID move, so an empty exclusion set
                is the only honest silence. The figureless scope says so
                without claiming a figure this branch does not render. */}
            {data.loanPaymentExclusions.map((e, i) => (
              <p
                key={`${e.payee}:${e.loanName}:${e.paymentCents}:${i}`}
                className="mt-1 text-xs text-muted-foreground"
                data-testid="reports-loan-payment-basis-empty"
              >
                {loanPaymentBasisSentence(e, 'figureless')}
              </p>
            ))}
          </div>
        )}

        {/* Every bar on the chart above opens the rows it is made of. The chart
            itself is an SVG, so these buttons — not the rectangles — are the
            accessible path to the same panels; tapping a bar just pre-selects
            one. Both land on `data.monthFlows`, which was built from the array
            the bars were summed from. */}
        {hasFlows && (
          <div className="mt-3 border-t pt-3" data-testid="month-flow-picker">
            {/* The two paths do DIFFERENT things and the sentence has to say so:
                a bar tap opens that bar's rows, a month button shows the month's
                two figures with their rows one press away. An earlier draft
                promised "the transactions behind it" for both, which the month
                path does not deliver — and "it" named one thing where a month
                yields two. */}
            <p className="text-xs text-muted-foreground">
              Tap a bar to open the transactions behind it, or pick a month to see both its
              figures.
            </p>
            {/* Two bases now sit on one page, and this drill-down is what invites
                the comparison: the bars are POSTED-only (`countsInFlows`) while
                "Spending by category" below counts pending charges too
                (`isSpendRow`). Each panel states its own basis, but a reader who
                adds up one and looks at the other would find a gap with nothing
                naming it.

                Gated on the COUNTERFACTUAL: it speaks only when the two figures
                a reader can actually see disagree, and stays silent when they
                don't.

                It names NO mechanism. An earlier draft said the difference was
                pending charges; a critic proved that false in both directions —
                at least five rules separate the two figures (pending, the
                Income-group rows the card cannot see, the card's per-category
                net-refund floor against the bar's global netting, income-group
                outflows, and `transfer`-categorised rows carrying no transfer
                flag), so a month with no pending rows at all can still show a
                gap, and the gap can run either way. The wrong mechanism is the
                dangerous half of a disclosure, so this states the DIRECTION,
                which is computed, and points at the two panels that each name
                their own rules. */}
            {basisGapCents !== 0 && (
              <p className="mt-1 text-xs text-muted-foreground" data-testid="reports-basis-gap">
                This chart and “Spending by category” below count on different rules — each
                says which underneath. For {formatMonth(data.ym)} the list below is{' '}
                {formatCents(cents(Math.abs(basisGapCents)))}{' '}
                {basisGapCents > 0 ? 'higher' : 'lower'} than this month’s bar.
              </p>
            )}
            {currentMonthMissingFromChart && (
              <p className="mt-1 text-xs text-muted-foreground" data-testid="reports-basis-no-bar">
                This chart has no bar for {formatMonth(data.ym)} — nothing posted there counts
                on its rules yet — while “Spending by category” below totals{' '}
                {formatCents(cents(data.breakdown.totalCents))} for the month. Each says what it
                counts underneath.
              </p>
            )}
            {/* C.25 (#403): the money this page does NOT count as spending,
                named — a loan payment carried elsewhere is counted on the
                committed side, so the figures here drop it in every month,
                not just the months the bank's settlement timing paired it.
                The claim is scoped to these figures (O.18e-FU). Speaks only
                when something moved; silence means nothing did. (When NOTHING
                counts but a payment did move — the chart's empty branch —
                the figureless scope speaks there instead; O.18e-FU2.) */}
            {data.loanPaymentExclusions.map((e, i) => (
              <p
                key={`${e.payee}:${e.loanName}:${e.paymentCents}:${i}`}
                className="mt-1 text-xs text-muted-foreground"
                data-testid="reports-loan-payment-basis"
              >
                {loanPaymentBasisSentence(e, 'page-figures')}
              </p>
            ))}
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {data.months.map((m) => {
                const active = selectedMonth === m.month;
                return (
                  <button
                    key={m.month}
                    type="button"
                    onClick={() => {
                      setSelectedMonth(active ? null : m.month);
                      setAutoOpenFlow(null);
                    }}
                    aria-pressed={active}
                    // The panels container is ALWAYS mounted (hidden when
                    // nothing is picked) so this reference always resolves —
                    // the same rule the panel component keeps for its own
                    // toggle.
                    aria-controls={panelsId}
                    aria-expanded={active}
                    data-testid={`month-flow-month-${m.month}`}
                    className={`min-h-7 rounded-md border px-2 py-0.5 text-xs transition focus-visible:outline-2 focus-visible:outline-offset-2 ${
                      active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    }`}
                  >
                    {formatMonth(m.month, 'short')}
                  </button>
                );
              })}
            </div>

            <div
              id={panelsId}
              hidden={!selectedMonth}
              className="mt-2 space-y-3"
              data-testid="month-flow-panels"
            >
              {selectedMonth && (
                <>
                {(['expense', 'income'] as const).map((flow) => {
                  const breakdown = data.monthFlows[`${selectedMonth}:${flow}`];
                  if (!breakdown) return null;
                  const windowLabel = formatMonth(selectedMonth);
                  return (
                    <div key={flow}>
                      {/* min-w-0 on the label, shrink-0 on the number: the rule
                          every other money row here follows, and the one the
                          iOS-Safari truncation lesson prescribes. The page-level
                          overflow gate cannot see this row — it renders only
                          after a tap — so it does not get to be the thing that
                          catches a 7-figure amount. */}
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate font-medium">
                          {flow === 'income' ? 'Income' : 'Spending'} · {windowLabel}
                        </span>
                        <span
                          className="shrink-0 whitespace-nowrap tabular-nums"
                          data-testid={`month-flow-headline-${selectedMonth}-${flow}`}
                        >
                          {formatCents(cents(breakdown.headlineCents))}
                        </span>
                      </div>
                      {/* The key carries this panel's OWN open-intent, never the
                          other's: tapping the income bar must not remount — and
                          so silently collapse — a spending panel the reader had
                          open, along with their scroll position in a long list.
                          `barTapSeq` is included only on the panel being opened,
                          so a repeat tap on the same bar still re-applies
                          `defaultOpen` after the reader pressed Hide. */}
                      <MonthFlowPanel
                        key={
                          autoOpenFlow === flow
                            ? `${selectedMonth}-${flow}-open-${barTapSeq}`
                            : `${selectedMonth}-${flow}-idle`
                        }
                        breakdown={breakdown}
                        windowLabel={windowLabel}
                        defaultOpen={autoOpenFlow === flow}
                      />
                    </div>
                  );
                })}
                </>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Spending by category */}
      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Spending by category</h2>
          <span className="text-xs text-muted-foreground" data-testid="reports-category-total">
            {monthLabel(data.ym)}
            {data.notCountedYetCents > 0 ? ' so far' : ''} ·{' '}
            {formatCents(cents(data.breakdown.totalCents))} total
          </span>
        </div>
        {/* C.26 (critic cycle 1, P1-5): the page-level statement of what this
            window held back. It sits ABOVE the table rather than inside a
            category panel because the case it exists for is the one where there
            is no panel — a reader whose only charge this month is dated ahead
            gets an empty table, and the per-category sentence cannot render. */}
        {data.notCountedYetCents > 0 ? (
          <p className="mb-2 text-xs text-muted-foreground" data-testid="reports-not-counted-yet">
            {reportsNotCountedYetCopy(formatCents(cents(data.notCountedYetCents)))}
          </p>
        ) : null}
        {currencyNote ? (
          <p className="mb-2 text-xs text-muted-foreground" data-testid="reports-currency-note">
            {currencyNote}
          </p>
        ) : null}
        {/* U.22: the figure a reader reads FIRST. Until now the only handover
            disclosure on this page was behind a per-category tap, so the total
            above — the number the eye lands on, and the one the month's other
            surfaces are compared against — carried none. Same argument C.26 used
            to hang `reportsNotCountedYetCopy` on the page total rather than only
            on the panels, and the field has been on this payload since U.16.

            The ANSWER wording, not the panel's: no transaction rows sit beside
            this total and no penny-match is printed under it, so the panel
            sentence's "N rows here" and its tally clause would both be false. */}
        {data.breakdown.countedOnHandoverDays > 0 ? (
          <p className="mb-2 text-xs text-muted-foreground" data-testid="reports-handover-total">
            {handoverDayAnswerNote(data.breakdown.countedOnHandoverDays)}
          </p>
        ) : null}
        {/* U.21 on this page, rescoped in the critic cycle: rendered whether or
            not the table is empty. "No spending this month yet." is the same
            affirmative claim Ask's zero branches make — but a doubled return
            that drops ONE category while others survive leaves this page
            printing a positive total that silently lost a category, which is
            the more reachable shape (money critic P1-1). The counted note
            above cannot cover either case: it is summed from the SURVIVING
            categories. */}
        {uncountedHandoverRows > 0 ? (
          <p className="mb-2 text-xs text-muted-foreground" data-testid="reports-handover-none">
            {handoverDayUncountedNote(uncountedHandoverRows)}
          </p>
        ) : null}
        {top.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {data.notCountedYetCents > 0
              ? 'Nothing counted yet this month — see above.'
              : 'No spending this month yet.'}
          </p>
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
