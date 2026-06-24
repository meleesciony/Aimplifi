/**
 * Ask Aimplifi — seed grounding (DECISIONS #75). Proves the assistant never
 * invents a number: run the full parse → engine → format pipeline on the real
 * seed and assert each answer ties back to the SAME tested engine the dedicated
 * view uses (netWorthCents, spendingByCategory, monthlyFlows), with no drift.
 *
 * Like the trends "real-seed pinned" test, the in-memory seed predates DB
 * categorization, so categories are derived here via the shared normalizer —
 * standing in for a user's categorized transactions.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { buildSeedData } from '@/lib/seed/build';
import { formatCents, type Cents } from '@/lib/money';
import { netWorthCents } from '@/lib/engine/cash-needed/assemble';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { spendingByCategory, type ReportTxn } from '@/lib/engine/reports/reports';
import { monthlyFlows } from '@/lib/engine/fi/insights';
import { computeSpendingTrends, type TrendTxn } from '@/lib/engine/trends/trends';
import { parseAssistantQuery, type Timeframe } from '@/lib/engine/assistant/intent';
import {
  answerIncome,
  answerLargest,
  answerNetWorth,
  answerSpendByCategory,
  answerSpendTotal,
  largestPurchases,
  type PurchaseRow,
} from '@/lib/engine/assistant/answer';

const TODAY = isoDate('2026-06-10'); // the pinned demo date
const seed = buildSeedData('2026-06-10');
const fmt = (n: number) => formatCents(n as Cents);

const reportTxns: ReportTxn[] = seed.transactions.map((t) => ({
  date: t.date,
  amountCents: t.amountCents,
  categoryId: normalizeMerchant(t.rawDescriptor).categoryId,
  isTransfer: t.isTransfer,
  isSplitParent: false,
}));
// POSTED-only, mirroring the server's largest path (F4) and the /trends server.
const purchaseRows: PurchaseRow[] = seed.transactions
  .filter((t) => t.status === 'POSTED')
  .map((t) => {
    const m = normalizeMerchant(t.rawDescriptor);
    return {
      date: t.date,
      amountCents: t.amountCents,
      categoryId: m.categoryId,
      isTransfer: t.isTransfer,
      isSplitParent: false,
      merchant: m.canonical,
    };
  });

const THIS_MONTH: Timeframe = { fromYm: '2026-06', toYm: '2026-06', label: 'this month' };
const LAST_MONTH: Timeframe = { fromYm: '2026-05', toYm: '2026-05', label: 'last month' };

describe('net worth answer == netWorthCents engine', () => {
  it('ties exactly', () => {
    const expected = netWorthCents(seed.accounts);
    expect(answerNetWorth(seed.accounts).headline).toBe(`Your net worth is ${fmt(expected)}.`);
  });
});

describe('spend answers == spendingByCategory engine', () => {
  it('spend_total ties to the breakdown total (and the seed has June spend)', () => {
    const i = parseAssistantQuery('how much did I spend this month', TODAY);
    expect(i.kind).toBe('spend_total');
    const breakdown = spendingByCategory(reportTxns, THIS_MONTH);
    expect(breakdown.totalCents).toBeGreaterThan(0);
    expect(answerSpendTotal(breakdown, THIS_MONTH).headline).toBe(`You spent ${fmt(breakdown.totalCents)} this month.`);
  });

  it('spend_by_category groceries ties to that category bucket', () => {
    const i = parseAssistantQuery('how much did I spend on groceries last month', TODAY);
    expect(i.kind).toBe('spend_by_category');
    const breakdown = spendingByCategory(reportTxns, LAST_MONTH);
    const groceries = breakdown.byCategory.find((c) => c.categoryId === 'groceries')?.amountCents ?? 0;
    expect(groceries).toBeGreaterThan(0); // the seed has grocery spend (KROGER/COSTCO…)
    const a = answerSpendByCategory(breakdown, { type: 'category', categoryId: 'groceries', label: 'Groceries' }, LAST_MONTH);
    expect(a.headline).toBe(`You spent ${fmt(groceries)} on Groceries last month.`);
  });
});

describe('income answer == monthlyFlows engine (FULL rows, like the server)', () => {
  it('ties to last month income (pinned $7,400.00)', () => {
    // The server passes snap.transactions straight to monthlyFlows (preserving
    // categoryId + isSplitParent at runtime) — NOT a stripped subset (F3). Mirror that.
    const flows = monthlyFlows(seed.transactions);
    const may = flows.find((f) => f.month === '2026-05');
    expect(may).toBeDefined();
    expect(may!.incomeCents).toBe(740000); // pinned: May biweekly payroll
    expect(answerIncome(may!.incomeCents, LAST_MONTH).headline).toBe('You brought in $7,400.00 last month.');
  });
});

describe('F3 regression — full rows net refunds and exclude split parents', () => {
  it('monthlyFlows(full rows with categoryId) nets a refund and drops a split parent', () => {
    const rows = [
      { date: '2026-06-01', amountCents: 500000, rawDescriptor: 'ACME PAYROLL', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'income', isSplitParent: false },
      { date: '2026-06-05', amountCents: -20000, rawDescriptor: 'TARGET', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'shopping', isSplitParent: false },
      { date: '2026-06-09', amountCents: 5000, rawDescriptor: 'TARGET REFUND', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'shopping', isSplitParent: false },
      // a split parent container that must be excluded (its children carry amounts)
      { date: '2026-06-10', amountCents: -9999, rawDescriptor: 'SPLIT PARENT', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'shopping', isSplitParent: true },
    ];
    const jun = monthlyFlows(rows).find((f) => f.month === '2026-06')!;
    // refund nets DOWN shopping spend (200 − 50 = 150), NOT counted as income; split parent ignored
    expect(jun.incomeCents).toBe(500000);
    expect(jun.expensesCents).toBe(15000);
    // had the server stripped categoryId (the old bug), the +50 refund would have been income (505000).
  });
});

describe('largest purchases == /trends computeLargest (POSTED only), pinned', () => {
  it('matches the trends engine exactly and excludes pending charges', () => {
    // Build the trends input the SAME way the /trends server does: POSTED only.
    const trendTxns: TrendTxn[] = seed.transactions
      .filter((t) => t.status === 'POSTED')
      .map((t) => {
        const m = normalizeMerchant(t.rawDescriptor);
        return { date: t.date, amountCents: t.amountCents, categoryId: m.categoryId, isTransfer: t.isTransfer, isSplitParent: false, merchant: m.canonical, aggregateMerchant: m.aggregate } as TrendTxn;
      });
    const trendsLargest = computeSpendingTrends({ txns: trendTxns, today: '2026-06-10' }).largest;
    const mine = largestPurchases(purchaseRows, THIS_MONTH, trendsLargest.length || 5, '2026-06-10');
    expect(mine).toEqual(trendsLargest); // byte-for-byte parity with /trends (same window, <= today, tie-break)

    // Pinned full top-5 (pending Amazon -$43.18 correctly EXCLUDED; Publix is #5).
    expect(mine.slice(0, 5).map((t) => [t.merchant, t.amountCents])).toEqual([
      ['Costco', 15844],
      ["Lowe's", 15658],
      ["Trader Joe's", 5180],
      ['Store Card Purchase', 4350],
      ['Publix', 4258],
    ]);
    expect(answerLargest(mine, THIS_MONTH).headline).toBe('Your biggest purchase this month was $158.44 at Costco.');
  });
});
