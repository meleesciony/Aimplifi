/**
 * Glass-Box Assistant trace engine (docs/GLASSBOX_PLAN.md, slice 1) — "tap a
 * number in an Ask answer, see the transaction rows it reconciles to."
 *
 * Scope: the six ROW-SUM intents only (spend_by_category, spend_total,
 * top_categories, merchant_spend, income, largest_purchases) — literal sums of
 * filtered snapshot transactions. Derivation-chain intents (net_worth,
 * cash_needed, forecast, …) are NOT row sums; offering them one would be
 * dishonest, so they return a `not_row_sum` marker and the UI never renders
 * their figures as tappable.
 *
 * Cardinal design rule (same as engine/glass-box/trace.ts): a trace never
 * re-derives a headline with its own logic. Headlines come from the SAME pure
 * engines the answer used (spendingByCategory, merchantSpend, monthlyFlows,
 * largestPurchases), and rows are selected with those engines' own exported
 * predicates (isSpendRow / spendRowCategoryId / spendContributionCents,
 * isIncomeFlowRow) or lifted from their results verbatim (merchant items,
 * largest rows). `sum(rows) === headline` therefore holds by construction —
 * and it is still CHECKED at runtime, so genuine drift is reported
 * (reconciled: false → the UI shows an honest "can't reconcile" fallback,
 * never a wrong number in either direction).
 *
 * Pure: no I/O, no Date, integer cents only.
 */
import {
  isSpendRow,
  spendContributionCents,
  spendRowCategoryId,
  spendingByCategory,
  type ReportTxn,
  type SpendingBreakdown,
} from '@/lib/engine/reports/reports';
import { isIncomeFlowRow, monthlyFlows, type MonthlyFlow, type TxnLike } from '@/lib/engine/fi/insights';
import type { CategoryMeta } from '@/lib/engine/categorize/categories';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import type { LargestTxn } from '@/lib/engine/trends/trends';
import {
  largestPurchases,
  merchantSpend,
  toPurchaseRows,
  type MerchantSpendResult,
} from './answer';
import type { AssistantIntent, SpendTarget, Timeframe } from './intent';

// ─── types ───────────────────────────────────────────────────────────────────

/** A raw snapshot transaction as the trace reads it — the same shape the
 *  answer engines consume (ReportTxn ∪ TxnLike ∪ SnapshotTxnLike). */
export interface TraceTxn {
  /** DB row id — REQUIRED (slice 2b): the correction chip's write path needs to
   *  name the exact row, and an optional id that silently vanished would make the
   *  chip disappear without a test noticing (the slice-1 optional-`meta` lesson:
   *  optional inputs that silently degrade are traps). Snapshot rows always have it. */
  id: string;
  date: string; // YYYY-MM-DD
  amountCents: number; // signed; negative = spend
  rawDescriptor: string;
  accountId: string;
  status: string;
  isTransfer: boolean;
  isSplitParent?: boolean;
  categoryId?: string | null;
}

/** One cited transaction row. The plain sum of a trace's rows IS its headline. */
export interface TraceRow {
  date: string;
  /** Canonical merchant (normalized from the raw descriptor, or the engine
   *  result's own name) — display label only, never part of the math. */
  merchant: string;
  categoryId?: string;
  /** Signed contribution to the headline (a refund cites negative). */
  contributionCents: number;
  /** The underlying transaction's DB id — set ONLY on spend-family rows
   *  (spendRowsFor), where the correction chip is offered: a category
   *  correction visibly moves those figures. merchant_spend / income /
   *  largest rows are reshaped from engine results whose figures a category
   *  change does not move the same way, so they carry no id and no chip
   *  (slice 2b scope — never offer a correction whose effect we can't show). */
  txnId?: string;
}

/** A per-category bucket inside a hierarchical trace (spend_total & friends):
 *  `amountCents` is the breakdown's own figure and `rows` sum to it exactly. */
export interface TraceGroup {
  key: string; // categoryId
  label: string; // display name
  amountCents: number;
  rows: TraceRow[];
}

export type RowSumKind =
  | 'spend_by_category'
  | 'spend_total'
  | 'top_categories'
  | 'merchant_spend'
  | 'income'
  | 'largest_purchases';

export interface RowSumTrace {
  kind: 'row_sum';
  intentKind: RowSumKind;
  /** The number in the answer's headline sentence, exactly as the engine returned it. */
  headlineCents: number;
  /** The rows behind headlineCents; their plain sum is `sumCents`. */
  rows: TraceRow[];
  /** Per-category buckets when the headline is hierarchical (each fact tappable later). */
  groups?: TraceGroup[];
  /** Plain sum of rows[].contributionCents — computed here, displayed verbatim. */
  sumCents: number;
  /** True iff sumCents === headlineCents AND every group reconciles internally. */
  reconciled: boolean;
  /** What the rows include/exclude, stated inline (assumption transparency). */
  basis: string[];
}

/** The honest answer for derivation-chain intents: no fake row-sum offered. */
export interface NotRowSumTrace {
  kind: 'not_row_sum';
  intentKind: AssistantIntent['kind'];
}

export type AnswerTrace = RowSumTrace | NotRowSumTrace;

/** The intent kinds whose figures are traceable to rows — the UI renders ONLY
 *  these as tappable (GLASSBOX_PLAN: never offer a reconciliation we can't honor). */
export const ROW_SUM_KINDS: ReadonlySet<AssistantIntent['kind']> = new Set<AssistantIntent['kind']>([
  'spend_by_category',
  'spend_total',
  'top_categories',
  'merchant_spend',
  'income',
  'largest_purchases',
]);

// ─── shared row selection (the lockstep core) ────────────────────────────────

const NET_SPEND_BASIS =
  'Purchases only — transfers, credit-card payments, and income are excluded; refunds count against their category.';
const DROPPED_CATEGORY_BASIS =
  'Categories whose refunds exceed their purchases this period are left out, matching your reports view.';

/** All rows `spendingByCategory` counted into bucket `id` for this window —
 *  selected with the engine's own exported predicate, never re-derived. */
function spendRowsFor(
  txns: readonly TraceTxn[],
  tf: Timeframe,
  meta: ReadonlyMap<string, CategoryMeta>,
  id: string,
): TraceRow[] {
  return txns
    .filter((t) => isSpendRow(t, tf, meta) && spendRowCategoryId(t) === id)
    .map((t) => ({
      date: t.date,
      merchant: normalizeMerchant(t.rawDescriptor).canonical,
      categoryId: id,
      contributionCents: spendContributionCents(t),
      txnId: t.id,
    }));
}

/** Build the per-category groups for a set of breakdown entries. Only
 *  categories PRESENT in the breakdown are cited — a net-refund category is
 *  dropped from the headline, so citing its rows would break reconciliation. */
function groupsFor(
  cats: readonly { categoryId: string; name: string; amountCents: number }[],
  txns: readonly TraceTxn[],
  tf: Timeframe,
  meta: ReadonlyMap<string, CategoryMeta>,
): TraceGroup[] {
  return cats.map((c) => ({
    key: c.categoryId,
    label: c.name,
    amountCents: c.amountCents,
    rows: spendRowsFor(txns, tf, meta, c.categoryId),
  }));
}

const sumRows = (rows: readonly TraceRow[]) => rows.reduce((s, r) => s + r.contributionCents, 0);
const groupReconciles = (g: TraceGroup) => sumRows(g.rows) === g.amountCents;

/** Assemble + CHECK: the reconciliation is asserted at runtime, so a drifted
 *  predicate or a doctored input is reported, never papered over. */
function assemble(
  intentKind: RowSumKind,
  headlineCents: number,
  rows: TraceRow[],
  basis: string[],
  groups?: TraceGroup[],
): RowSumTrace {
  const sum = sumRows(rows);
  const groupsOk = !groups || groups.every(groupReconciles);
  return {
    kind: 'row_sum',
    intentKind,
    headlineCents,
    rows,
    ...(groups ? { groups } : {}),
    sumCents: sum,
    reconciled: sum === headlineCents && groupsOk,
    basis,
  };
}

// ─── per-kind traces ─────────────────────────────────────────────────────────

/**
 * spend_total is HIERARCHICAL: total → per-category → rows. The byCategory
 * breakdown IS the reconciliation (net-refund categories are dropped from the
 * total, so a naïve flat sum of all spend rows would NOT reconcile — the
 * plan's decisive design point).
 */
export function traceSpendTotal(
  breakdown: SpendingBreakdown,
  txns: readonly TraceTxn[],
  tf: Timeframe,
  meta: ReadonlyMap<string, CategoryMeta>,
): RowSumTrace {
  const groups = groupsFor(breakdown.byCategory, txns, tf, meta);
  return assemble(
    'spend_total',
    breakdown.totalCents,
    groups.flatMap((g) => g.rows),
    [NET_SPEND_BASIS, DROPPED_CATEGORY_BASIS],
    groups,
  );
}

/** spend_by_category: cite the target's rows — single category, umbrella set,
 *  or group — resolving the headline exactly as answerSpendByCategory does. */
export function traceSpendByCategory(
  breakdown: SpendingBreakdown,
  target: SpendTarget,
  txns: readonly TraceTxn[],
  tf: Timeframe,
  meta: ReadonlyMap<string, CategoryMeta>,
): RowSumTrace {
  let amount = 0;
  let cited: { categoryId: string; name: string; amountCents: number }[] = [];
  if (target.type === 'category') {
    const c = breakdown.byCategory.find((x) => x.categoryId === target.categoryId);
    amount = c?.amountCents ?? 0;
    cited = c ? [c] : [];
  } else if (target.type === 'categories') {
    const ids = new Set(target.categoryIds);
    cited = breakdown.byCategory.filter((c) => ids.has(c.categoryId));
    amount = cited.reduce((s, c) => s + c.amountCents, 0);
  } else {
    const g = breakdown.byGroup.find((x) => x.group === target.group);
    amount = g?.amountCents ?? 0;
    cited = g?.categories ?? [];
  }
  const groups = groupsFor(cited, txns, tf, meta);
  return assemble(
    'spend_by_category',
    amount,
    groups.flatMap((g) => g.rows),
    [NET_SPEND_BASIS, DROPPED_CATEGORY_BASIS],
    groups.length > 1 ? groups : undefined,
  );
}

/** top_categories: the headline figure is the TOP category's amount, so `rows`
 *  are its rows; every listed category rides along as a reconciled group. */
export function traceTopCategories(
  breakdown: SpendingBreakdown,
  limit: number,
  txns: readonly TraceTxn[],
  tf: Timeframe,
  meta: ReadonlyMap<string, CategoryMeta>,
): RowSumTrace {
  const top = breakdown.byCategory.slice(0, limit);
  const groups = groupsFor(top, txns, tf, meta);
  return assemble(
    'top_categories',
    top[0]?.amountCents ?? 0,
    groups[0]?.rows ?? [],
    [NET_SPEND_BASIS, DROPPED_CATEGORY_BASIS],
    groups,
  );
}

/** merchant_spend: a pure RESHAPE of the engine result — its `items` already
 *  list every counted purchase, so they are the rows, verbatim. */
export function traceMerchantSpend(res: MerchantSpendResult): RowSumTrace {
  return assemble(
    'merchant_spend',
    res.totalCents,
    res.items.map((i) => ({ date: i.date, merchant: i.merchant, contributionCents: i.amountCents })),
    [
      'Purchases at this merchant only, from posted transactions. Returns are not subtracted here — this counts what you bought, matching your activity view.',
    ],
  );
}

/** income: cite the rows `monthlyFlows` counted as income in the window, via
 *  its own exported predicate; the headline is the flows' windowed sum —
 *  exactly the figure the answer used. */
export function traceIncome(flows: readonly MonthlyFlow[], txns: readonly TraceTxn[], tf: Timeframe): RowSumTrace {
  const headline = flows
    .filter((f) => f.month >= tf.fromYm && f.month <= tf.toYm)
    .reduce((s, f) => s + f.incomeCents, 0);
  const rows: TraceRow[] = txns
    .filter((t) => {
      const ym = t.date.slice(0, 7);
      return ym >= tf.fromYm && ym <= tf.toYm && isIncomeFlowRow(t);
    })
    .map((t) => ({
      date: t.date,
      merchant: normalizeMerchant(t.rawDescriptor).canonical,
      contributionCents: t.amountCents,
    }));
  return assemble('income', headline, rows, [
    'Income only — transfers between your own accounts are excluded, and merchandise refunds count against spending instead of income.',
  ]);
}

/** largest_purchases: the headline is ONE row's amount — cite that single row,
 *  trivially reconciled. (The runner-up facts come from the same engine list.) */
export function traceLargest(largest: readonly LargestTxn[], merchant?: string): RowSumTrace {
  const top = largest[0];
  const rows: TraceRow[] = top
    ? [{ date: top.date, merchant: top.merchant, contributionCents: top.amountCents }]
    : [];
  return assemble('largest_purchases', top?.amountCents ?? 0, rows, [
    merchant
      ? 'The single biggest posted purchase at this merchant in the period — one transaction, not a sum.'
      : 'The single biggest posted purchase in the period — one transaction, not a sum.',
  ]);
}

// ─── orchestrator ────────────────────────────────────────────────────────────

export interface TraceInput {
  transactions: readonly TraceTxn[];
  /** Business date (YYYY-MM-DD) — the same `today` the answer was built with. */
  today: string;
  /** REQUIRED (critic 2026-07-15 F1): the SAME category meta the answer was
   *  built with (`mergeCategoryMeta(custom)` on the server). An optional
   *  default to the static map silently mis-bucketed custom categories —
   *  a wrong number stamped reconciled. Callers with no custom categories
   *  pass CATEGORY_BY_ID explicitly. */
  meta: ReadonlyMap<string, CategoryMeta>;
  /** The cents figure the user actually TAPPED, from the answer payload
   *  (critic 2026-07-15 F2). The trace recomputes from tap-time inputs; if
   *  data synced in between and the recomputed headline no longer equals the
   *  tapped figure, that answer→tap drift is reported as unreconciled — the
   *  drawer must never show a green check next to a different number than
   *  the one the user tapped. */
  expectedHeadlineCents?: number;
}

/**
 * Trace the number behind a resolved intent. Recomputes through the SAME pure
 * engines `buildAnswer` calls with the same inputs, so determinism guarantees
 * the headline here equals the answer's — then reshapes their output into rows.
 * Derivation-chain intents return `not_row_sum` (criterion 4): the UI must not
 * offer a tap it can't honor.
 */
export function traceAnswer(intent: AssistantIntent, input: TraceInput): AnswerTrace {
  const trace = traceForKind(intent, input);
  // Answer→tap drift check (critic F2): the trace can be internally consistent
  // and still describe a DIFFERENT number than the one the user tapped, if a
  // sync landed in between. That is a failed reconciliation, honestly reported.
  if (
    trace.kind === 'row_sum' &&
    input.expectedHeadlineCents !== undefined &&
    trace.headlineCents !== input.expectedHeadlineCents
  ) {
    return { ...trace, reconciled: false };
  }
  return trace;
}

function traceForKind(intent: AssistantIntent, input: TraceInput): AnswerTrace {
  const meta = input.meta;
  const txns = input.transactions;
  switch (intent.kind) {
    case 'spend_total':
      return traceSpendTotal(spendingByCategory(txns, intent.timeframe, meta), txns, intent.timeframe, meta);
    case 'spend_by_category':
      return traceSpendByCategory(
        spendingByCategory(txns, intent.timeframe, meta),
        intent.target,
        txns,
        intent.timeframe,
        meta,
      );
    case 'top_categories':
      return traceTopCategories(
        spendingByCategory(txns, intent.timeframe, meta),
        intent.limit,
        txns,
        intent.timeframe,
        meta,
      );
    case 'merchant_spend':
      return traceMerchantSpend(merchantSpend(toPurchaseRows(txns), intent.timeframe, intent.merchant, input.today, meta));
    case 'income':
      // TraceTxn extends TxnLike (compile-time assert below) — no cast needed.
      return traceIncome(monthlyFlows(txns), txns, intent.timeframe);
    case 'largest_purchases':
      return traceLargest(
        largestPurchases(toPurchaseRows(txns), intent.timeframe, intent.limit, input.today, meta, intent.merchant),
        intent.merchant,
      );
    default:
      return { kind: 'not_row_sum', intentKind: intent.kind };
  }
}

// Type-compatibility guards (compile-time only): TraceTxn must remain a valid
// input to every engine the trace locksteps with.
type _AssertReportTxn = TraceTxn extends ReportTxn ? true : never;
type _AssertTxnLike = TraceTxn extends TxnLike ? true : never;
const _reportOk: _AssertReportTxn = true;
const _flowsOk: _AssertTxnLike = true;
void _reportOk;
void _flowsOk;
