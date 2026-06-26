/**
 * Reports data (DECISIONS #67): last-6-months income/expense series + this
 * month's spending-by-category breakdown, from the shared snapshot.
 */
import { monthlyFlows } from '@/lib/engine/fi/insights';
import { spendingByCategory, type SpendingBreakdown } from '@/lib/engine/reports/reports';
import { getProvider } from '@/lib/providers/demo';
import { getCategoryMeta } from '@/server/category-meta';

export interface ReportsData {
  ym: string;
  months: { month: string; incomeCents: number; expensesCents: number }[];
  breakdown: SpendingBreakdown;
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
  return { ym, months, breakdown };
}
