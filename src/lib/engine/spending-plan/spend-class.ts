/**
 * Fixed vs guilt-free spend class (Wave B.1 / DECISIONS #376; manual dial
 * removed 2026-08-03 — owner directive: the class is deterministic and
 * algorithmic, never typed in).
 *
 * Every outflow that counts in flows is one of:
 *   - fixed — non-discretionary (utilities, groceries, rent…)
 *   - guilt-free — discretionary (dining, movies, skiing…)
 *   - out-of-scope — transfers, card payments, income, uncategorized, etc.
 *
 * Classification is a pure function of the transaction's filed category — the
 * taxonomy's `discretionary` flag, resolved through the per-user meta map so
 * custom categories classify like built-ins. There is no per-user override and
 * no label to set: the reader changes a row's class by refiling the row under
 * a different category, never by designating the row itself.
 */
import { countsInFlows, type TxnLike } from '@/lib/engine/fi/insights';
import {
  CATEGORY_BY_ID,
  type CategoryMeta,
} from '@/lib/engine/categorize/categories';
import { isBudgetable } from '@/lib/engine/budgets/status';

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
  return 'Neither';
}

/**
 * Effective fixed designation from the taxonomy alone.
 * `null` = category cannot be designated (out of the fixed/guilt-free dial):
 * settlement, income, transfers, uncategorized, or unknown.
 */
export function resolveCategoryIsFixed(
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

export function classifySpendClass(
  t: TxnLike,
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
): SpendClass {
  if (!countsInFlows(t) || t.amountCents >= 0) return 'out-of-scope';
  const id = t.categoryId;
  if (!id || FIXED_PATTERN_EXCLUDE_CATEGORY_IDS.has(id)) return 'out-of-scope';
  const isFixed = resolveCategoryIsFixed(id, meta);
  if (isFixed === null) return 'out-of-scope';
  return isFixed ? 'fixed' : 'guilt-free';
}

export interface SpendClassCategoryRow {
  categoryId: string;
  name: string;
  spentCents: number;
  /** Taxonomy designation. */
  isFixed: boolean;
}

/**
 * Build the Fixed / Guilt-free lists for /budgets from this month's spend.
 * Categories with $0 spend are omitted (nothing to classify yet).
 */
export function summarizeSpendClassCategories(
  spendByCategory: ReadonlyMap<string, number>,
  meta: ReadonlyMap<string, CategoryMeta>,
  nameOf: (id: string) => string,
): { fixed: SpendClassCategoryRow[]; guiltFree: SpendClassCategoryRow[] } {
  const fixed: SpendClassCategoryRow[] = [];
  const guiltFree: SpendClassCategoryRow[] = [];
  for (const categoryId of spendByCategory.keys()) {
    const isFixed = resolveCategoryIsFixed(categoryId, meta);
    if (isFixed === null) continue;
    const spentCents = spendByCategory.get(categoryId) ?? 0;
    if (spentCents <= 0) continue;
    const row: SpendClassCategoryRow = { categoryId, name: nameOf(categoryId), spentCents, isFixed };
    if (isFixed) fixed.push(row);
    else guiltFree.push(row);
  }
  const bySpendThenName = (a: SpendClassCategoryRow, b: SpendClassCategoryRow) =>
    b.spentCents - a.spentCents || a.name.localeCompare(b.name);
  fixed.sort(bySpendThenName);
  guiltFree.sort(bySpendThenName);
  return { fixed, guiltFree };
}
