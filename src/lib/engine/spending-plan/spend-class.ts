/**
 * Fixed vs guilt-free spend class (Wave B.1 / DECISIONS #376; manual dial
 * restored 2026-08-03 by DECISIONS #396 — the owner corrected the #395
 * removal directive he never gave).
 *
 * Every outflow that counts in flows is one of:
 *   - fixed — non-discretionary (utilities, groceries, rent…)
 *   - guilt-free — discretionary (dining, movies, skiing…)
 *   - out-of-scope — transfers, card payments, income, uncategorized, etc.
 *
 * Classification is by the transaction's filed category. A per-user override
 * map (categoryId → isFixed) wins over the category's suggested `discretionary`
 * flag; custom categories resolve through the same meta map as everywhere else.
 * The deterministic taxonomy suggestion stays the default — a dial choice that
 * matches it deletes the override row (src/server/category-fixed-actions.ts),
 * so the suggestion is the source of truth until the reader disagrees.
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
  return 'Not counted';
}

/** Suggested class from taxonomy alone (no user override). */
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
 * Effective fixed flag after user overrides.
 * `null` = category cannot be designated (out of the fixed/guilt-free dial):
 * settlement, income, transfers, uncategorized, or unknown.
 */
export function resolveCategoryIsFixed(
  categoryId: string,
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
  overrides: ReadonlyMap<string, boolean> = new Map(),
): boolean | null {
  const suggested = suggestedCategoryIsFixed(categoryId, meta);
  if (suggested === null) return null;
  if (overrides.has(categoryId)) return overrides.get(categoryId)!;
  return suggested;
}

export function classifySpendClass(
  t: TxnLike,
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
  overrides: ReadonlyMap<string, boolean> = new Map(),
): SpendClass {
  if (!countsInFlows(t) || t.amountCents >= 0) return 'out-of-scope';
  const id = t.categoryId;
  if (!id || FIXED_PATTERN_EXCLUDE_CATEGORY_IDS.has(id)) return 'out-of-scope';
  const isFixed = resolveCategoryIsFixed(id, meta, overrides);
  if (isFixed === null) return 'out-of-scope';
  return isFixed ? 'fixed' : 'guilt-free';
}

export interface SpendClassCategoryRow {
  categoryId: string;
  name: string;
  spentCents: number;
  /** Effective designation after overrides. */
  isFixed: boolean;
  /** App suggestion before any override. */
  suggestedFixed: boolean;
  /** True when the reader has disagreed with the suggestion. */
  overridden: boolean;
}

/**
 * Build the Fixed / Guilt-free lists for /budgets from this month's spend.
 * Categories with $0 spend and no override are omitted (nothing to classify yet);
 * an override with $0 still appears so the reader can see / undo their choice.
 */
export function summarizeSpendClassCategories(
  spendByCategory: ReadonlyMap<string, number>,
  meta: ReadonlyMap<string, CategoryMeta>,
  overrides: ReadonlyMap<string, boolean>,
  nameOf: (id: string) => string,
): { fixed: SpendClassCategoryRow[]; guiltFree: SpendClassCategoryRow[] } {
  const ids = new Set([...spendByCategory.keys(), ...overrides.keys()]);
  const fixed: SpendClassCategoryRow[] = [];
  const guiltFree: SpendClassCategoryRow[] = [];
  for (const categoryId of ids) {
    const suggested = suggestedCategoryIsFixed(categoryId, meta);
    if (suggested === null) continue;
    const isFixed = resolveCategoryIsFixed(categoryId, meta, overrides)!;
    const spentCents = spendByCategory.get(categoryId) ?? 0;
    const overridden = overrides.has(categoryId);
    if (spentCents <= 0 && !overridden) continue;
    const row: SpendClassCategoryRow = {
      categoryId,
      name: nameOf(categoryId),
      spentCents,
      isFixed,
      suggestedFixed: suggested,
      overridden,
    };
    if (isFixed) fixed.push(row);
    else guiltFree.push(row);
  }
  const bySpendThenName = (a: SpendClassCategoryRow, b: SpendClassCategoryRow) =>
    b.spentCents - a.spentCents || a.name.localeCompare(b.name);
  fixed.sort(bySpendThenName);
  guiltFree.sort(bySpendThenName);
  return { fixed, guiltFree };
}
