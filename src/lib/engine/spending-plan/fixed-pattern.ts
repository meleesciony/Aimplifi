/**
 * Guilt-free fixed-cost pattern (DECISIONS #371).
 *
 * Fixed = non-discretionary spend (groceries, housing, utilities, insurance,
 * fuel, loans…) — not dining out / shopping / entertainment. Transfers, card
 * payments, and "Investment & Savings" are excluded so they cannot double-count
 * the savings dial or settle spend twice. Uncategorized rows are excluded
 * (unknown is not a cost class).
 *
 * When the trailing pattern is empty, the plan falls back to detected recurring
 * series (the pre-#371 path).
 */
import { countsInFlows, type TxnLike } from '@/lib/engine/fi/insights';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import { monthKey } from '@/lib/dates';

/** Settlement / savings / noise — never part of the fixed allocation bucket. */
export const FIXED_PATTERN_EXCLUDE_CATEGORY_IDS = new Set([
  'transfer',
  'credit-card-payment',
  'cash',
  'investment',
]);

export function isGuiltFreeFixedSpendRow(t: TxnLike): boolean {
  if (!countsInFlows(t) || t.amountCents >= 0) return false;
  const id = t.categoryId;
  if (!id || FIXED_PATTERN_EXCLUDE_CATEGORY_IDS.has(id)) return false;
  const cat = CATEGORY_BY_ID.get(id);
  if (!cat || cat.discretionary) return false;
  if (cat.group === 'Income' || cat.group === 'Transfers & Other') return false;
  return true;
}

export interface MonthlyFixedCents {
  month: string;
  expenseCents: number;
}

/** Per-month non-discretionary outflows for the guilt-free trailing median. */
export function monthlyNonDiscretionaryCents(
  transactions: readonly TxnLike[],
): MonthlyFixedCents[] {
  const byMonth = new Map<string, number>();
  for (const t of transactions) {
    if (!isGuiltFreeFixedSpendRow(t)) continue;
    const m = monthKey(t.date);
    byMonth.set(m, (byMonth.get(m) ?? 0) + -t.amountCents);
  }
  return [...byMonth.entries()]
    .map(([month, expenseCents]) => ({ month, expenseCents }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
}
