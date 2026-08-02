/**
 * Guilt-free fixed-cost pattern (DECISIONS #371 / #376).
 *
 * Fixed = non-discretionary spend (groceries, housing, utilities, insurance,
 * fuel, loans…) — not dining out / shopping / entertainment. Transfers, card
 * payments, and "Investment & Savings" are excluded so they cannot double-count
 * the savings dial or settle spend twice. Uncategorized rows are excluded
 * (unknown is not a cost class).
 *
 * #376: classification is meta-aware (custom categories) and honours per-user
 * CategoryFixedOverride. When the trailing pattern is empty, the plan falls
 * back to detected recurring series (the pre-#371 path).
 */
import { type TxnLike } from '@/lib/engine/fi/insights';
import { CATEGORY_BY_ID, type CategoryMeta } from '@/lib/engine/categorize/categories';
import { monthKey } from '@/lib/dates';
import {
  classifySpendClass,
  FIXED_PATTERN_EXCLUDE_CATEGORY_IDS,
} from '@/lib/engine/spending-plan/spend-class';

export { FIXED_PATTERN_EXCLUDE_CATEGORY_IDS };

export function isGuiltFreeFixedSpendRow(
  t: TxnLike,
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
  overrides: ReadonlyMap<string, boolean> = new Map(),
): boolean {
  return classifySpendClass(t, meta, overrides) === 'fixed';
}

export interface MonthlyFixedCents {
  month: string;
  expenseCents: number;
}

/** Per-month non-discretionary outflows for the guilt-free trailing median. */
export function monthlyNonDiscretionaryCents(
  transactions: readonly TxnLike[],
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
  overrides: ReadonlyMap<string, boolean> = new Map(),
): MonthlyFixedCents[] {
  const byMonth = new Map<string, number>();
  for (const t of transactions) {
    if (!isGuiltFreeFixedSpendRow(t, meta, overrides)) continue;
    const m = monthKey(t.date);
    byMonth.set(m, (byMonth.get(m) ?? 0) + -t.amountCents);
  }
  return [...byMonth.entries()]
    .map(([month, expenseCents]) => ({ month, expenseCents }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
}

/**
 * Category ids that contributed Fixed spend in the given calendar months —
 * the covered set for the trailing-median Fixed union (#384). Transfer
 * auto-loan ACH never appears here (`classifySpendClass` → out-of-scope), so
 * it still unions in via `recurringOutsideFixedCategoryCents`.
 */
export function fixedSpendCategoryIdsInMonths(
  transactions: readonly TxnLike[],
  months: ReadonlySet<string>,
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
  overrides: ReadonlyMap<string, boolean> = new Map(),
): Set<string> {
  const ids = new Set<string>();
  if (months.size === 0) return ids;
  for (const t of transactions) {
    if (!isGuiltFreeFixedSpendRow(t, meta, overrides)) continue;
    if (!months.has(monthKey(t.date))) continue;
    const id = t.categoryId;
    if (id) ids.add(id);
  }
  return ids;
}
