/**
 * Month-flow breakdowns — "tap a bar on the income-vs-spending chart, see the
 * transactions that bar is made of".
 *
 * Owner request, 2026-08-01: *"every single bar and collection of categories
 * needs to be immediately available … essentially you are filtering
 * transactions"*. The category TABLES on /reports, /trends and /budgets already
 * expand (`category-breakdown.ts`); the CHART above them did not, and it is the
 * first thing on the page.
 *
 * This is the sibling of `category-breakdown.ts` and obeys the identical rule:
 *
 *   **A breakdown never re-queries and never re-derives. It is built from the
 *   very array the surface summed, through the very predicate the surface
 *   summed with.**
 *
 * The predicate here is `monthlyFlows`', not `spendingByCategory`', and the
 * difference is not cosmetic — which is why this module exists rather than a
 * second caller of the category builder:
 *
 *   - `isSpendRow` (categories) COUNTS pending rows. `countsInFlows` (this
 *     chart) is POSTED-only. A panel that inherited the category basis sentence
 *     would tell a reader their pending charges are included in a bar that never
 *     saw them.
 *   - The chart splits one month into TWO figures by `isIncomeFlowRow`, so a
 *     row belongs to exactly one of the two panels for that month.
 *   - A refund is a negative CONTRIBUTION to spending here (`monthlyFlows` nets
 *     it down) and never income, unless it is filed to an Income-group category
 *     that is not the `refund` leaf.
 *
 * Both predicates are imported from the engine that owns them; nothing in this
 * file restates a clause. That is the whole guarantee: a change to what counts
 * in a flow moves the bar and the rows beneath it in the same commit.
 *
 * Pure: no I/O, no Date, integer cents only.
 */
import { type Cents, cents, formatCents, sumCents } from '@/lib/money';
import { countsInFlows, isIncomeFlowRow, type TxnLike } from '@/lib/engine/fi/insights';
import { handoverKey } from '@/lib/engine/account/reconcile-boundary';
import {
  breakdownHandoverDayCopy,
  breakdownNotCountedYetCopy,
  type BreakdownRow,
} from '@/lib/engine/glass-box/category-breakdown';

/** Which half of a month the reader tapped. */
export type MonthFlow = 'income' | 'expense';

/**
 * A source row, as `getReports` already holds it: the snapshot's transaction
 * plus the register's display name.
 *
 * Display fields are optional for the same reason the category builder's are —
 * a caller that cannot supply one degrades to a less specific LABEL, never to a
 * wrong figure, because none of them touches the arithmetic.
 */
export interface MonthFlowSourceTxn extends TxnLike {
  id?: string | null;
  /** The name the register prints for this row, so one charge reads the same in both. */
  merchantName?: string | null;
}

export interface MonthFlowBreakdown {
  /** "YYYY-MM" — the bar's month. */
  month: string;
  flow: MonthFlow;
  /** The figure the CHART renders — passed in, never recomputed here. */
  headlineCents: Cents;
  /** Every contributing row, oldest first, no cap. */
  rows: BreakdownRow[];
  /** Plain sum of `rows[].amountCents`. */
  sumCents: Cents;
  /** True iff `sumCents === headlineCents` exactly. */
  reconciles: boolean;
  /**
   * The month's returns exceeded its purchases and the bar is being held at zero.
   *
   * `monthlyFlows` clamps with `Math.max(0, expenses)` so a month cannot print
   * negative spending. Those rows genuinely do not sum to the figure, so
   * `reconciles` is false and stays false; this flag lets the panel name the
   * reason instead of reporting a defect. Cannot arise on the income side, whose
   * rows are all positive by `isIncomeFlowRow`.
   */
  clampedByNetRefund: boolean;
  /**
   * How many of `rows` fall on a released handover day (U.16) — counted off the
   * rows this panel LISTS, so its sentence can never describe money that is not
   * on screen. Zero for every reader with no combined accounts.
   */
  countedOnHandoverDays: number;
  /**
   * Money in this bar's month and flow that the CHART does not draw because it
   * is dated after `asOf` (C.26 critic cycle 1, P1-3/P1-4).
   *
   * The category family got this field first and the chart on the same page did
   * not, which produced two false sentences rather than one missing feature: an
   * empty expense bar printed "No posted spending in June 2026" over $400.00 of
   * posted June spending, and a bar the clamp had emptied down to a single
   * refund printed "Returns in June 2026 outran purchases", blaming the
   * reader's returns for money the date rule had removed. A basis constant that
   * enumerates its exclusions is false the moment a new one exists
   * (`closing-a-gap-shrinks-the-disclosure-that-described-it`), and every
   * sentence in this module interpolates a window label — so carrying the fact
   * lets the label say "so far" and the basis name the amount, in one place.
   */
  notCountedYetCents: Cents;
}

/**
 * What each panel includes and excludes, in one sentence, keyed by the flow it
 * describes.
 *
 * It lives here beside the predicate rather than in the component, and the panel
 * prints whatever the breakdown carries — a disclosure a call site has to
 * remember is one a call site can forget.
 *
 * The enumeration is COMPLETE against `countsInFlows`, whose four clauses are,
 * in order: not a transfer, POSTED only, not a split container, and not excluded
 * from totals. (C.25/#403 adds an optional fifth — a caller-supplied set of
 * loan-payment row ids carried elsewhere — which this builder threads through
 * untouched: an excluded row never enters the enumeration either.) What
 * follows those clauses is the flow SPLIT, and it was got wrong twice before
 * it was got right, because the split is not the rule it looks like:
 *
 *   `isIncomeFlowRow = amountCents > 0 && (!categoryId || (categoryId !== 'refund' && group === 'Income'))`
 *
 * Three consequences, each of which puts a row on screen that a "refunds are
 * netted against spending" sentence describes falsely:
 *
 *   1. A positive row with NO category at all counts as INCOME (`!categoryId` —
 *      a live population, see `server/backfill.ts:94`).
 *   2. A positive row filed to `uncategorized` does NOT, because that category's
 *      group is 'Transfers & Other' — so an unidentified deposit lands in
 *      SPENDING as a negative row. Two unfiled inflows that look identical to a
 *      reader therefore land on opposite sides; the sentences name both cases
 *      rather than pretending the app has one rule for "unfiled".
 *   3. A NEGATIVE row filed to an income category is spending (a payroll
 *      clawback adds to the spending bar), because the split tests the sign
 *      first.
 *
 * Two independent critics found this, from opposite directions and each with
 * half of it. Derive this set by running the predicate over its whole domain —
 * never by editing the previous sentence to add the case you just heard about.
 *
 * Note the deliberate disagreement with `BREAKDOWN_BASIS` one module over: that
 * one says pending charges ARE counted, because they are, in the figures it
 * describes. Two panels on one page may state different bases as long as each
 * states its own — one question answered differently across pages is the sin;
 * two different questions each naming its basis is not.
 */
export const MONTH_FLOW_BASIS: Record<MonthFlow, string> = {
  expense:
    'Posted spending only — transfers between your own accounts, charges still pending, ' +
    'split containers (the pieces they were split into are counted instead) and anything ' +
    'you excluded from totals are all left out. Money going out counts here even when it ' +
    'sits in an income category, and money coming in counts against this total as a ' +
    'negative row unless it counts as income — so a return filed to what it was bought ' +
    'from, or a deposit still sitting in Uncategorized, reduces this figure.',
  income:
    'Posted income only — transfers between your own accounts, deposits still pending, ' +
    'split containers (the pieces they were split into are counted instead) and anything ' +
    'you excluded from totals are all left out. Money coming in counts here when its ' +
    'category is an income one, and also when it carries no category at all; a return ' +
    'filed to what it was bought from counts against that month’s spending instead.',
};

/**
 * The sentence for a month whose bar is zero and whose panel is therefore empty.
 *
 * Makes no POSITIONAL claim. The first draft said "on the basis above" and the
 * basis paragraph renders *below* this one — and in the empty branch there is
 * nothing above it at all. Where a sentence sits relative to another is a fact
 * about the component, not about the engine, so this one states the rule
 * without pointing (`a-disclosure-written-for-a-page-is-false-in-an-email`).
 */
export function monthFlowEmptyCopy(flow: MonthFlow, windowLabel: string): string {
  return flow === 'income'
    ? `No posted income in ${windowLabel} once the rules below are applied.`
    : `No posted spending in ${windowLabel} once the rules below are applied.`;
}

/**
 * The sentence for a month whose returns outran its purchases.
 *
 * Takes CENTS, not a preformatted label, and takes the magnitude itself.
 *
 * The caller always holds a NEGATIVE `sumCents` — that is what
 * `clampedByNetRefund` means — and "outran purchases by −$80.00" is a double
 * negative asserting the opposite of the truth. Both critics found that
 * independently. Doing the `Math.abs` here rather than at the call site makes
 * the sign impossible to get wrong from the outside: a fence by construction
 * beats a correct argument at one call site, because the next call site is
 * where the argument gets forgotten. The sentence supplies the direction in
 * words. (The sibling module can safely take a signed label because its
 * sentence is phrased as an identity — "these rows come to −$80.00" — rather
 * than as a magnitude after "by".)
 *
 * Names the MONTH rather than "this month" (the chart draws six) and rather
 * than "that bar" (the reader may have arrived from the month button, having
 * tapped no bar at all), and makes no claim about where anything sits on screen.
 */
export function monthFlowNetRefundCopy(sumCents: number, windowLabel: string): string {
  return (
    `Returns in ${windowLabel} outran purchases by ${formatCents(cents(Math.abs(sumCents)))}, ` +
    `so the chart holds ${windowLabel} at $0.00 rather than drawing a negative bar. ` +
    `These are the rows it saw.`
  );
}

/**
 * The basis sentences a MONTH-FLOW panel prints (C.26 critic cycle 1, P1-4).
 *
 * `MONTH_FLOW_BASIS` above claims a COMPLETE enumeration of `countsInFlows`,
 * and C.26 gave the chart a date rule that constant does not mention. Unlike
 * the category constant — which is shared with /budgets, where the clause would
 * be FALSE — this one is rendered only by /reports' chart, so the clause could
 * have been folded into the constant. It is a separate, amount-gated sentence
 * anyway, for the reason the sibling module gives: an unconditional clause
 * tells every reader about a rule that never touched their money, while this
 * one names the amount that is actually waiting.
 */
export function monthFlowPanelBasis(
  breakdown: Pick<
    MonthFlowBreakdown,
    'flow' | 'notCountedYetCents' | 'countedOnHandoverDays' | 'reconciles' | 'rows'
  >,
): [string, ...string[]] {
  return [
    MONTH_FLOW_BASIS[breakdown.flow],
    ...(breakdown.notCountedYetCents > 0
      ? [
          breakdownNotCountedYetCopy(
            formatCents(breakdown.notCountedYetCents),
            breakdown.flow === 'income' ? 'income' : 'spending',
          ),
        ]
      : []),
    // U.16, and the SAME sentence the category panel prints — one author for one
    // fact. This panel is a second surface where the released handover day is
    // both counted and penny-matched, and a reader comparing a bar's panel with
    // a category's panel must not meet two different accounts of one rule. The
    // enumeration in `MONTH_FLOW_BASIS` is unaffected: a handover row is not
    // EXCLUDED from the bar, it is counted by it, possibly more than once.
    ...(breakdown.countedOnHandoverDays > 0
      ? [breakdownHandoverDayCopy(breakdown.countedOnHandoverDays, breakdown.reconciles && breakdown.rows.length > 1)]
      : []),
  ];
}

function labelFor(t: MonthFlowSourceTxn): string {
  const name = t.merchantName?.trim();
  if (name) return name;
  const raw = t.rawDescriptor?.trim();
  return raw || '—';
}

/**
 * One breakdown per (month, flow) the chart draws, keyed `"YYYY-MM:flow"`.
 *
 * `headlines` is the caller's own rendered figures — the same objects it hands
 * the chart — so `reconciles` is a real check rather than a decoration: there is
 * no parallel derivation here that could make it false on a correct number.
 *
 * Every month in `headlines` gets an entry, including a zero one, because a bar
 * a reader can tap must open something; an empty panel that says why is an
 * answer, and silence is not.
 */
export function buildMonthFlowBreakdowns(
  txns: readonly MonthFlowSourceTxn[],
  headlines: readonly { month: string; incomeCents: number; expensesCents: number }[],
  // C.25 (#403): the SAME set the bars were summed with, so the rows a bar
  // opens cannot name money the bar itself does not show — one predicate,
  // two surfaces, no drift (this file's own doctrine).
  excludedFlowIds?: ReadonlySet<string>,
  /**
   * C.26: the day the CHART stops counting at, when its caller clamped
   * (`getReports` does; nothing else calls this). Taken here rather than
   * applied by the caller to the array it passes — which is what cycle 1
   * shipped — because a pre-filtered array leaves this module unable to tell an
   * empty bar from a bar whose money is dated ahead, and it printed the wrong
   * sentence for both. Omitted = every row counts, the pre-C.26 behaviour.
   */
  asOf?: string | null,
  // U.16: the days the boundary released to BOTH sides of a combined pair
  // (`getReconciliationHandoverDates`). Passed in rather than inferred — the
  // boundary's own rule is the only honest detector. Empty = the truth for a
  // reader with no combined accounts, so an existing caller changes nothing.
  handoverKeys: ReadonlySet<string> = new Set<string>(),
): Record<string, MonthFlowBreakdown> {
  const wanted = new Set(headlines.map((h) => h.month));
  const collected = new Map<string, BreakdownRow[]>();
  const notYet = new Map<string, number>();

  for (const t of txns) {
    // The predicate, not a copy of it.
    if (!countsInFlows(t, excludedFlowIds)) continue;
    const month = t.date.slice(0, 7);
    if (!wanted.has(month)) continue;
    const income = isIncomeFlowRow(t, excludedFlowIds);
    const key = `${month}:${income ? 'income' : 'expense'}`;
    // Dated ahead: not in the bar, and counted as the money the bar does not
    // draw. Oriented exactly as the row would have contributed, so the figure
    // the sentence names is the one the bar would have grown by.
    if (asOf && t.date > asOf) {
      notYet.set(key, (notYet.get(key) ?? 0) + (income ? t.amountCents : -t.amountCents));
      continue;
    }
    const rows = collected.get(key) ?? [];
    const label = labelFor(t);
    const raw = t.rawDescriptor?.trim() ?? '';
    rows.push({
      key: `${key}:${rows.length}:${t.date}`,
      transactionId: t.id ?? null,
      date: t.date,
      label,
      rawDescriptor: raw && raw !== label ? raw : null,
      // Oriented so the rows sum to the POSITIVE figure the chart draws: income
      // keeps the row's own sign (all positive by `isIncomeFlowRow`), spending
      // is negated, which makes a refund — a positive row in a non-income
      // category — a visibly negative contribution, exactly as `monthlyFlows`
      // nets it.
      amountCents: cents(income ? t.amountCents : -t.amountCents),
      // Always false: `countsInFlows` admits POSTED rows only. Kept because the
      // shared row type carries it and the panel prints a marker from it — a
      // field that silently disappeared would be a lie by omission if the flows
      // predicate ever widened.
      isPending: t.status === 'PENDING',
      // U.16: a fact about the row's DATE — this bar counts it, and counts it
      // once per connection that reported it.
      onHandoverDay: handoverKeys.has(handoverKey(t.accountId, t.date)),
    });
    collected.set(key, rows);
  }

  const out: Record<string, MonthFlowBreakdown> = {};
  for (const h of headlines) {
    for (const flow of ['income', 'expense'] as const) {
      const key = `${h.month}:${flow}`;
      const rows = collected.get(key) ?? [];
      // Oldest first — a reader scanning "when did this start" reads down the
      // way a statement does. Ties keep collection order, which is the caller's.
      rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const sum = sumCents(rows.map((r) => r.amountCents));
      const headline = flow === 'income' ? h.incomeCents : h.expensesCents;
      out[key] = {
        month: h.month,
        flow,
        headlineCents: cents(headline),
        rows,
        sumCents: sum,
        reconciles: sum === headline,
        // No `flow === 'expense'` guard: it was dead. Income rows are all
        // positive by `isIncomeFlowRow`, so an income panel can never have
        // `sum < 0`, and a test asserting the guard could not fail (a critic
        // proved it by deleting the clause). A dead branch is a claim that
        // something is handled, so the claim is stated here instead.
        clampedByNetRefund: headline === 0 && sum < 0,
        // Floored at zero for the category family's reason: a later-dated
        // refund is not "money not counted yet", and naming it as such would
        // tell a reader a scheduled return is spending waiting to land.
        notCountedYetCents: cents(Math.max(0, notYet.get(key) ?? 0)),
        // U.16: off the LISTED rows, so the sentence cannot name money the
        // panel does not show. A row dated ahead of `asOf` already `continue`d
        // above and is not in `rows` — it is not in the bar either, so it is
        // correctly not described as counted twice.
        countedOnHandoverDays: rows.reduce((n, r) => (r.onHandoverDay ? n + 1 : n), 0),
      };
    }
  }
  return out;
}
