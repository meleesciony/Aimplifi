/**
 * Fixed vs guilt-free spend class — PER TRANSACTION (DECISIONS #397,
 * 2026-08-03; supersedes the category-level designation channel of
 * #376/#378/#396, which the owner rejected: "not all hair and beauty is
 * fixed — when I switch one transaction, they all switch").
 *
 * Every spending outflow (posted OR pending) is one of:
 *   - fixed — non-discretionary (utilities, groceries, rent…)
 *   - guilt-free — discretionary (dining, movies, skiing…)
 *   - out-of-scope — transfers, card payments, income, uncategorized, etc.
 *
 * Pending is NOT out-of-scope: the charge already reduced what the reader can
 * spend, and the dial must work on the row they are looking at (owner 2026-08-03:
 * pending Hair Capital showed "Not counted" with no control). Plan intake stays
 * POSTED-only; /budgets already sums pending into its instruction.
 *
 * The class is individual: flipping one row never moves its category
 * siblings. The reader's per-row verdict (`Transaction.spendClassOverride`)
 * wins; absent one the app GUESSES — a recurring-bill merchant guesses fixed
 * (the owner's seed rule: most recurring items are fixed), otherwise the
 * filed category's taxonomy `discretionary` flag decides (custom categories
 * resolve through the same meta map as everywhere else). A dial choice that
 * matches the guess stores NULL, so the guess stays the source of truth
 * until the reader disagrees (setTransactionSpendClass in
 * src/server/transaction-flags-actions.ts).
 */
import { type TxnLike } from '@/lib/engine/fi/insights';
import {
  CATEGORY_BY_ID,
  type CategoryMeta,
} from '@/lib/engine/categorize/categories';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { isBudgetable } from '@/lib/engine/budgets/status';
import { overrideKey } from '@/lib/engine/recurring/override';
import { isExcludedFromTotals } from '@/lib/engine/transactions/exclude';

/** Settlement / savings / noise — never part of the fixed allocation bucket. */
export const FIXED_PATTERN_EXCLUDE_CATEGORY_IDS = new Set([
  'transfer',
  'credit-card-payment',
  'cash',
  'investment',
]);

export type SpendClass = 'fixed' | 'guilt-free' | 'out-of-scope';

/** Short register label — "discretionary" matches the owner's vocabulary. */
export function spendClassLabel(c: SpendClass): string {
  if (c === 'fixed') return 'Fixed';
  if (c === 'guilt-free') return 'Discretionary';
  return 'Not counted';
}

/**
 * The taxonomy's suggestion for a category (no per-row input): true = fixed,
 * false = guilt-free, `null` = the category cannot carry a spend class at all
 * (settlement, income, transfers, uncategorized, or unknown). This is the
 * fallback guess for a row whose merchant is not a recurring bill.
 */
export function suggestedCategoryIsFixed(
  categoryId: string,
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
): boolean | null {
  if (!isBudgetable(categoryId)) return null;
  if (FIXED_PATTERN_EXCLUDE_CATEGORY_IDS.has(categoryId)) return null;
  const cat = meta.get(categoryId) ?? CATEGORY_BY_ID.get(categoryId);
  if (!cat) return null;
  if (cat.group === 'Income' || cat.group === 'Transfers & Other') return null;
  return !cat.discretionary;
}

/**
 * The class of ONE transaction. `fixedMerchants` holds the canonical payees
 * the reader's recurring bills resolve to (stored outflow series + declared
 * BILL verdicts − NOT_BILL — one server definition, see
 * getRecurringBillMerchantCanonicals); the default empty set keeps pure-engine
 * callers on the taxonomy guess alone.
 */
export function classifySpendClass(
  t: TxnLike,
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
  fixedMerchants: ReadonlySet<string> = new Set(),
): SpendClass {
  // Same exclusions as `countsInFlows`, except PENDING is admitted — settlement
  // status is not a spend-class axis (see module doc). Unknown statuses still
  // refuse rather than invent a class.
  if (
    t.isTransfer ||
    Boolean(t.isSplitParent) ||
    isExcludedFromTotals(t) ||
    t.amountCents >= 0 ||
    (t.status !== 'POSTED' && t.status !== 'PENDING')
  ) {
    return 'out-of-scope';
  }
  const id = t.categoryId;
  if (!id || FIXED_PATTERN_EXCLUDE_CATEGORY_IDS.has(id)) return 'out-of-scope';
  const suggested = suggestedCategoryIsFixed(id, meta);
  if (suggested === null) return 'out-of-scope';
  // The reader's verdict on THIS row wins; anything unreadable falls through
  // to the guess (parse-don't-guess, the isTaxClass rule).
  if (t.spendClassOverride === 'fixed' || t.spendClassOverride === 'guilt-free') {
    return t.spendClassOverride;
  }
  if (fixedMerchants.has(overrideKey(normalizeMerchant(t.rawDescriptor).canonical))) return 'fixed';
  return suggested ? 'fixed' : 'guilt-free';
}

/**
 * The app's guess for a row, ignoring any verdict on it — the server action
 * stores NULL when the reader's choice matches this, so the guess stays the
 * source of truth until the reader actually disagrees.
 */
export function guessSpendClass(
  t: TxnLike,
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
  fixedMerchants: ReadonlySet<string> = new Set(),
): SpendClass {
  return classifySpendClass({ ...t, spendClassOverride: null }, meta, fixedMerchants);
}

export interface SpendClassCategoryRow {
  categoryId: string;
  name: string;
  spentCents: number;
  /** Which list the row sits in — a mixed category appears in both, once per
   *  side, with that side's subtotal. */
  isFixed: boolean;
}

/**
 * Build the Fixed / Guilt-free lists for /budgets from this month's rows,
 * classified PER TRANSACTION (#397): a category whose rows split appears in
 * both lists, each with its own subtotal — the lists answer "what makes up my
 * Fixed number and my guilt-free number", and a single category-level bucket
 * cannot do that honestly. Categories with $0 classified spend are omitted.
 */
export function summarizeSpendClassCategories(
  transactions: readonly TxnLike[],
  meta: ReadonlyMap<string, CategoryMeta>,
  fixedMerchants: ReadonlySet<string>,
  nameOf: (id: string) => string,
): { fixed: SpendClassCategoryRow[]; guiltFree: SpendClassCategoryRow[] } {
  const byCat = new Map<string, { fixed: number; guiltFree: number }>();
  for (const t of transactions) {
    const cls = classifySpendClass(t, meta, fixedMerchants);
    if (cls === 'out-of-scope') continue;
    const id = t.categoryId!;
    const cur = byCat.get(id) ?? { fixed: 0, guiltFree: 0 };
    cur[cls === 'fixed' ? 'fixed' : 'guiltFree'] += -t.amountCents;
    byCat.set(id, cur);
  }
  const fixed: SpendClassCategoryRow[] = [];
  const guiltFree: SpendClassCategoryRow[] = [];
  for (const [categoryId, sums] of byCat) {
    if (sums.fixed > 0) {
      fixed.push({ categoryId, name: nameOf(categoryId), spentCents: sums.fixed, isFixed: true });
    }
    if (sums.guiltFree > 0) {
      guiltFree.push({
        categoryId,
        name: nameOf(categoryId),
        spentCents: sums.guiltFree,
        isFixed: false,
      });
    }
  }
  const bySpendThenName = (a: SpendClassCategoryRow, b: SpendClassCategoryRow) =>
    b.spentCents - a.spentCents || a.name.localeCompare(b.name);
  fixed.sort(bySpendThenName);
  guiltFree.sort(bySpendThenName);
  return { fixed, guiltFree };
}
