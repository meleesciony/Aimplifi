/**
 * Per-category fixed amounts (Wave B.1 residual / DECISIONS #377).
 *
 * For each category designated Fixed: amount = Budget.monthCents when set,
 * else typical monthly spend over the last complete months. Sum is the
 * category-rollup candidate for the Plan fixed term (used when the reader has
 * given input — a budget on a fixed category or a designation override).
 */
import { addMonthsClamped, isoDate, monthKey, type ISODate } from '@/lib/dates';
import type { CategoryMeta } from '@/lib/engine/categorize/categories';
import { countsInFlows, type TxnLike } from '@/lib/engine/fi/insights';
import { resolveCategoryIsFixed } from '@/lib/engine/spending-plan/spend-class';

export type FixedAmountBasis = 'budget-target' | 'typical-spend';

export interface FixedCategoryAmount {
  categoryId: string;
  name: string;
  amountCents: number;
  basis: FixedAmountBasis;
  /** Trailing average before the budget target wins (0 when no history). */
  typicalCents: number;
  budgetCents: number | null;
}

export interface FixedCategoryAmountsResult {
  rows: FixedCategoryAmount[];
  totalCents: number;
  /**
   * True when the reader has touched Fixed (a designation override) or set a
   * budget target on any fixed category — the gate for Plan to prefer this
   * rollup over the #371 whole-median (demo has neither → golden-safe).
   */
  hasReaderInput: boolean;
  windowMonths: number;
}

/**
 * Average monthly outflow per category over the last `windowMonths` complete
 * months before `today`. Only rows that count in flows; positive refunds net.
 */
export function averageMonthlySpendByCategory(
  transactions: readonly TxnLike[],
  today: ISODate,
  windowMonths = 3,
): Map<string, number> {
  const months = Math.max(1, Math.trunc(windowMonths));
  const lastFullMonthStart = addMonthsClamped(isoDate(`${monthKey(today)}-01`), 0);
  const monthSet = new Set<string>();
  for (let k = months; k >= 1; k--) {
    monthSet.add(monthKey(addMonthsClamped(lastFullMonthStart, -k)));
  }

  const signed = new Map<string, number>();
  for (const t of transactions) {
    if (!countsInFlows(t)) continue;
    const m = monthKey(t.date);
    if (!monthSet.has(m)) continue;
    const id = t.categoryId;
    if (!id || id === 'uncategorized') continue;
    signed.set(id, (signed.get(id) ?? 0) + t.amountCents);
  }

  const denom = monthSet.size;
  const out = new Map<string, number>();
  for (const [id, net] of signed) {
    if (net >= 0) continue;
    out.set(id, Math.round(-net / denom));
  }
  return out;
}

export function resolveFixedCategoryAmounts(input: {
  transactions: readonly TxnLike[];
  today: ISODate;
  meta: ReadonlyMap<string, CategoryMeta>;
  overrides: ReadonlyMap<string, boolean>;
  budgetByCategory: ReadonlyMap<string, number>;
  nameOf: (id: string) => string;
  windowMonths?: number;
}): FixedCategoryAmountsResult {
  const windowMonths = input.windowMonths ?? 3;
  const typicalByCat = averageMonthlySpendByCategory(
    input.transactions,
    input.today,
    windowMonths,
  );

  const ids = new Set<string>([
    ...typicalByCat.keys(),
    ...input.budgetByCategory.keys(),
    ...input.overrides.keys(),
  ]);

  const rows: FixedCategoryAmount[] = [];
  let hasBudgetOnFixed = false;
  for (const categoryId of ids) {
    const isFixed = resolveCategoryIsFixed(categoryId, input.meta, input.overrides);
    if (isFixed !== true) continue;

    const typicalCents = typicalByCat.get(categoryId) ?? 0;
    const budgetRaw = input.budgetByCategory.get(categoryId);
    const budgetCents =
      typeof budgetRaw === 'number' && Number.isSafeInteger(budgetRaw) && budgetRaw > 0
        ? budgetRaw
        : null;
    if (budgetCents != null) hasBudgetOnFixed = true;

    const amountCents = budgetCents ?? typicalCents;
    if (amountCents <= 0 && !input.overrides.has(categoryId)) continue;

    rows.push({
      categoryId,
      name: input.nameOf(categoryId),
      amountCents,
      basis: budgetCents != null ? 'budget-target' : 'typical-spend',
      typicalCents,
      budgetCents,
    });
  }

  rows.sort(
    (a, b) => b.amountCents - a.amountCents || a.name.localeCompare(b.name),
  );
  const totalCents = rows.reduce((s, r) => s + r.amountCents, 0);
  return {
    rows,
    totalCents,
    hasReaderInput: input.overrides.size > 0 || hasBudgetOnFixed,
    windowMonths,
  };
}
