/**
 * Reports data (DECISIONS #67): trailing income/expense series + this month's
 * spending-by-category breakdown, from the shared snapshot.
 *
 * The series length is a READER CHOICE (owner request 2026-08-04: "why are we
 * only pulling 6 months of data? … need a way to view last month, last
 * quarter, last year"): 6 months stays the default, and the same chart can be
 * widened to 12 or 24 months — the vocabulary lives in the engine
 * (engine/reports/chart-range.ts) so the client view's selector and this
 * assembler read the same values without the client importing a server module.
 */
import type { ReportChartMonths } from '@/lib/engine/reports/chart-range';
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
import {
  loanPaymentBasisFacts,
  loanPaymentRefusedCategories,
  type LoanPaymentBasisFact,
} from '@/server/loan-payment-basis';
import { getProvider } from '@/lib/providers/demo';
import { getCategoryMeta } from '@/server/category-meta';

export interface ReportsData {
  ym: string;
  months: { month: string; incomeCents: number; expensesCents: number }[];
  breakdown: SpendingBreakdown;
  /**
   * C.25 (DECISIONS #403): the loan payments these figures do NOT count as
   * spending, and why — one entry per excluded merchant, carrying the loan
   * it is counted on instead. Empty when no merchant qualifies (demo,
   * SimpleFIN-only readers, undatable loans), and the view says nothing:
   * silence is the correct sentence for "nothing moved".
   */
  loanPaymentExclusions: readonly LoanPaymentBasisFact[];
  /**
   * C.25 (#403, critic P1-4): categories whose figure dropped excluded rows.
   * A register link from one of them would land on a total still counting
   * those rows, so the view refuses the link on these (O.5/O.6 invariant).
   */
  loanPaymentRefusedCategories: readonly string[];
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

export async function getReports(userId: string, months: ReportChartMonths = 6): Promise<ReportsData> {
  const provider = getProvider();
  const today = provider.today(userId);
  const ym = today.slice(0, 7);
  const [snap, meta] = await Promise.all([
    provider.getFinanceSnapshot(userId),
    getCategoryMeta(userId),
  ]);
  // C.25 (#403): the read-side exclusion, computed ONCE in the assembler.
  // One set for every sum on this page, so the bars, the category table and
  // the rows under each cannot disagree about what counts.
  const excludedFlowIds = snap.loanPaymentFlowExclusions?.excludeIds;

  const series = monthlyFlows(snap.transactions, excludedFlowIds)
    .map((f) => ({ month: f.month, incomeCents: f.incomeCents, expensesCents: f.expensesCents }))
    .sort((a, b) => (a.month < b.month ? -1 : 1))
    .slice(-months);

  const breakdown = spendingByCategory(snap.transactions, { fromYm: ym, toYm: ym }, meta, excludedFlowIds);
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
    excludedFlowIds,
  );
  // `series` is the array the chart renders, so the headlines here are the
  // figures the reader will actually see — `reconciles` is checked against the
  // painted number, not against a second derivation of it.
  const monthFlows = buildMonthFlowBreakdowns(named, series, excludedFlowIds);
  // C.25 (#403) disclosure facts, named by the one shared helper so every
  // surface phrases the exclusion the same way.
  return {
    ym,
    months: series,
    breakdown,
    breakdowns,
    monthFlows,
    loanPaymentExclusions: loanPaymentBasisFacts(snap),
    loanPaymentRefusedCategories: loanPaymentRefusedCategories(snap),
  };
}
