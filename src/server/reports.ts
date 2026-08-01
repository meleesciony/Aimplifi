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
import {
  buildMonthFlowBreakdowns,
  type MonthFlowBreakdown,
} from '@/lib/engine/glass-box/month-flow-breakdown';
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
  /**
   * The transactions behind each BAR of the income-vs-spending chart, keyed
   * `"YYYY-MM:income"` / `"YYYY-MM:expense"` — one entry per bar the chart draws.
   *
   * Built from the same snapshot array `monthlyFlows` was handed, through that
   * engine's own exported predicate, so a bar and the rows under it cannot
   * describe different sets. Deliberately NOT the same basis as `breakdowns`
   * above: this chart is posted-only and nets refunds against spending, which is
   * why it has its own builder and its own disclosure sentence.
   */
  monthFlows: Record<string, MonthFlowBreakdown>;
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
  // Named once and handed to BOTH builders: two panels that disagree about a
  // payee's name on the same page would be a defect nobody could explain, and
  // building the array twice is what would let them.
  const named = snap.transactions.map((t) => ({
    ...t,
    // The register's own display rule, shared with it by construction, so one
    // charge reads the same in the panel and in the list it links to.
    merchantName: registerDisplayName(t),
  }));
  const breakdowns = buildCategoryBreakdowns(
    named,
    ym,
    new Map(breakdown.byCategory.map((c) => [c.categoryId, c.amountCents])),
    meta,
  );
  // `months` is the array the chart renders, so the headlines here are the
  // figures the reader will actually see — `reconciles` is checked against the
  // painted number, not against a second derivation of it.
  const monthFlows = buildMonthFlowBreakdowns(named, months);
  return { ym, months, breakdown, breakdowns, monthFlows };
}
