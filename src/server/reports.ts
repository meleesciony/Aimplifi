/**
 * Reports data (DECISIONS #67): last-6-months income/expense series + this
 * month's spending-by-category breakdown, from the shared snapshot.
 */
import { monthlyFlows } from '@/lib/engine/fi/insights';
import { spendingByCategory, type SpendingBreakdown } from '@/lib/engine/reports/reports';
import {
  buildCategoryBreakdowns,
  type CategoryBreakdown,
} from '@/lib/engine/glass-box/category-breakdown';
import { registerDisplayName } from '@/lib/engine/transactions/display-name';
import { getProvider } from '@/lib/providers/demo';
import { getCategoryMeta } from '@/server/category-meta';

export interface ReportsData {
  ym: string;
  months: { month: string; incomeCents: number; expensesCents: number }[];
  breakdown: SpendingBreakdown;
  /**
   * The transactions behind each category figure, keyed by category id — one
   * entry for every category in `breakdown.byCategory`.
   *
   * Built from the SAME snapshot array `spendingByCategory` was just handed, so
   * the panel a reader expands cannot show a different set of rows than the bar
   * they expanded it from. Every category is built rather than only the twelve
   * the view prints: each transaction belongs to exactly one category, so the
   * tail costs the tail's own rows and nothing more, and no constant has to stay
   * in step between this file and the component's `slice`.
   */
  breakdowns: Record<string, CategoryBreakdown>;
}

export async function getReports(userId: string): Promise<ReportsData> {
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
  const breakdowns = buildCategoryBreakdowns(
    snap.transactions.map((t) => ({
      ...t,
      // The register's own display rule, shared with it by construction, so one
      // charge reads the same in the panel and in the list it links to.
      merchantName: registerDisplayName(t),
    })),
    ym,
    new Map(breakdown.byCategory.map((c) => [c.categoryId, c.amountCents])),
    meta,
  );
  return { ym, months, breakdown, breakdowns };
}
