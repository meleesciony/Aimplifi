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
import type { BreakdownRow } from '@/lib/engine/glass-box/category-breakdown';

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
 * from totals. What follows those four is the flow SPLIT, and it was got wrong
 * twice before it was got right, because the split is not the rule it looks
 * like:
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
): Record<string, MonthFlowBreakdown> {
  const wanted = new Set(headlines.map((h) => h.month));
  const collected = new Map<string, BreakdownRow[]>();

  for (const t of txns) {
    // The predicate, not a copy of it.
    if (!countsInFlows(t)) continue;
    const month = t.date.slice(0, 7);
    if (!wanted.has(month)) continue;
    const income = isIncomeFlowRow(t);
    const key = `${month}:${income ? 'income' : 'expense'}`;
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
      };
    }
  }
  return out;
}
