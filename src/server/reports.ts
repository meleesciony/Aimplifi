/**
 * Reports data (DECISIONS #67 + #171): last-6-months income/expense series +
 * this month's spending-by-category breakdown + optional per-category MoM
 * series when `?category=` is set, from the shared snapshot.
 */
import { monthlyFlows } from '@/lib/engine/fi/insights';
import {
  categorySpendSeries,
  isSpendDrilldownCategory,
  spendingByCategory,
  type CategorySpendSeries,
  type SpendingBreakdown,
} from '@/lib/engine/reports/reports';
import { getProvider } from '@/lib/providers/demo';
import { getCategoryMeta } from '@/server/category-meta';

/** Months of MoM history shown in the category drill-down (matches the income chart). */
export const CATEGORY_MOM_MONTHS = 6;

export interface ReportsData {
  ym: string;
  months: { month: string; incomeCents: number; expensesCents: number }[];
  breakdown: SpendingBreakdown;
  /** Present when the page was opened with ?category= — Mint-style MoM drill-down. */
  categorySeries: CategorySpendSeries | null;
}

export async function getReports(
  userId: string,
  opts: { categoryId?: string | null } = {},
): Promise<ReportsData> {
  const provider = getProvider();
  const today = provider.today(userId);
  const ym = today.slice(0, 7);
  const [snap, meta] = await Promise.all([
    provider.getFinanceSnapshot(userId),
    getCategoryMeta(userId),
  ]);

  const months = monthlyFlows(snap.transactions)
    .map((f) => ({ month: f.month, incomeCents: f.incomeCents, expensesCents: f.expensesCents }))
    .sort((a, b) => (a.month < b.month ? -1 : 1))
    .slice(-6);

  const breakdown = spendingByCategory(snap.transactions, { fromYm: ym, toYm: ym }, meta);

  const categoryId = opts.categoryId?.trim() || null;
  // Spendable categories only (not Income / transfer). Customs live in meta;
  // a leaf that only appears in this month's breakdown (e.g. uncategorized) is
  // also allowed. Garbage / income ids → null (no invented spend panel).
  const drillable =
    categoryId != null &&
    (isSpendDrilldownCategory(categoryId, meta) ||
      breakdown.byCategory.some((c) => c.categoryId === categoryId));
  const categorySeries =
    categoryId && drillable
      ? categorySpendSeries(snap.transactions, categoryId, ym, CATEGORY_MOM_MONTHS, meta)
      : null;

  return { ym, months, breakdown, categorySeries };
}
