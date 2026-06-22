/**
 * Reports data (DECISIONS #67): last-6-months income/expense series + this
 * month's spending-by-category breakdown, from the shared snapshot.
 */
import { monthlyFlows } from '@/lib/engine/fi/insights';
import { spendingByCategory, type SpendingBreakdown } from '@/lib/engine/reports/reports';
import { getProvider } from '@/lib/providers/demo';

export interface ReportsData {
  ym: string;
  months: { month: string; incomeCents: number; expensesCents: number }[];
  breakdown: SpendingBreakdown;
}

export async function getReports(userId: string): Promise<ReportsData> {
  const provider = getProvider();
  const today = provider.today(userId);
  const ym = today.slice(0, 7);
  const snap = await provider.getFinanceSnapshot(userId);

  const months = monthlyFlows(snap.transactions)
    .map((f) => ({ month: f.month, incomeCents: f.incomeCents, expensesCents: f.expensesCents }))
    .sort((a, b) => (a.month < b.month ? -1 : 1))
    .slice(-6);

  const breakdown = spendingByCategory(snap.transactions, { fromYm: ym, toYm: ym });
  return { ym, months, breakdown };
}
