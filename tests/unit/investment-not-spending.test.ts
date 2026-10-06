/**
 * DECISIONS #789 — a row filed Investment & Savings moves the reader's own money:
 * it is never spending, never income, and never a refund that nets spending down,
 * in every flow and spending predicate. The register's spend-class chip has always
 * said so ("Money moved into investing is saving, not spending"); before #789 the
 * figures disagreed with it — reports, trends, /budgets, the coach's savings rate,
 * the FI number and Ask all counted a brokerage deposit as an EXPENSE, because the
 * categorizer files "VANGUARD BUY INVESTMENT" to Investment & Savings and the
 * pairing detector cannot flag a transfer whose other side the app holds no rows
 * for (STATUS "FOUND 2026-10-05").
 *
 * Every amount and name below is invented. Hand math beside each assertion.
 */
import { describe, expect, it } from 'vitest';
import {
  MONEY_MOVE_CATEGORY_IDS,
  isMoneyMoveCategoryId,
} from '@/lib/engine/categorize/categories';
import { categorize } from '@/lib/engine/categorize/pipeline';
import { isSpendRow, spendingByCategory, type ReportTxn } from '@/lib/engine/reports/reports';
import { countsInFlows, isIncomeFlowRow, monthlyFlows, type TxnLike } from '@/lib/engine/fi/insights';
import { buildMonthFlowBreakdowns } from '@/lib/engine/glass-box/month-flow-breakdown';
import { computeSpendingTrends, type TrendTxn } from '@/lib/engine/trends/trends';
import { answerSpendByCategory, largestPurchases, type AskTxnRow } from '@/lib/engine/assistant/answer';
import {
  isBudgetable,
  summarizeBudgets,
  untrackedBudgetTargetSentence,
  untrackedBudgetTargets,
} from '@/lib/engine/budgets/status';
import { buildDialCatalog } from '@/lib/engine/settings/money-dial-ids';
import { classifySpendClass, outOfScopeReason } from '@/lib/engine/spending-plan/spend-class';
import type { Timeframe } from '@/lib/engine/assistant/intent';

const JUNE = { fromYm: '2026-06', toYm: '2026-06' };
const THIS_MONTH: Timeframe = { fromYm: '2026-06', toYm: '2026-06', label: 'this month' };

function flowRow(date: string, amountCents: number, categoryId: string | null, over: Partial<TxnLike> = {}): TxnLike {
  return {
    id: `${date}:${amountCents}:${categoryId}`,
    date,
    amountCents,
    rawDescriptor: 'X',
    accountId: 'chk',
    isTransfer: false,
    status: 'POSTED',
    categoryId,
    isSplitParent: false,
    ...over,
  };
}

// A month: pay $5,000.00 in, groceries $400.00, a Vanguard deposit $1,000.00, and
// $250.00 taken back from the brokerage — the last two filed Investment & Savings,
// neither transfer-flagged (the categorizer's own filing; nothing to pair).
const JUNE_ROWS: TxnLike[] = [
  flowRow('2026-06-01', 500_000, 'paycheck'),
  flowRow('2026-06-03', -40_000, 'groceries'),
  flowRow('2026-06-04', -100_000, 'investment', { rawDescriptor: 'VANGUARD BUY INVESTMENT' }),
  flowRow('2026-06-20', 25_000, 'investment', { rawDescriptor: 'VANGUARD SELL INVESTMENT' }),
];

describe('#789 — one set of leaves that move money, read by every predicate', () => {
  it('the set is exactly Transfer and Investment & Savings', () => {
    expect([...MONEY_MOVE_CATEGORY_IDS].sort()).toEqual(['investment', 'transfer']);
    expect(isMoneyMoveCategoryId('investment')).toBe(true);
    expect(isMoneyMoveCategoryId('transfer')).toBe(true);
    expect(isMoneyMoveCategoryId('investment-income')).toBe(false); // dividends stay income
    expect(isMoneyMoveCategoryId('groceries')).toBe(false);
    expect(isMoneyMoveCategoryId(null)).toBe(false);
    expect(isMoneyMoveCategoryId(undefined)).toBe(false);
  });

  it('the categorizer files real brokerage deposits to Investment & Savings, untransferred — the rows this decision is about', () => {
    for (const d of ['VANGUARD BUY INVESTMENT PPD ID: 0000000001', 'FID BKG SVC LLC MONEYLINE PPD', 'ROBINHOOD DEBITS']) {
      const r = categorize({ rawDescriptor: d, amountCents: -50_000, date: '2026-06-04', accountId: 'chk', isTransfer: false } as never);
      expect(r.categoryId, d).toBe('investment');
    }
  });
});

describe('test_regression__a_row_filed_investment_and_savings_is_never_spending_or_income', () => {
  it('reports: neither direction is a spend row (an outflow was spending; an inflow netted spending down)', () => {
    const out: ReportTxn = { date: '2026-06-04', amountCents: -100_000, categoryId: 'investment', isTransfer: false };
    const back: ReportTxn = { date: '2026-06-20', amountCents: 25_000, categoryId: 'investment', isTransfer: false };
    expect(isSpendRow(out, JUNE)).toBe(false);
    expect(isSpendRow(back, JUNE)).toBe(false);
    // Anti-vacuity: the same outflow filed to a real spend leaf still counts.
    expect(isSpendRow({ ...out, categoryId: 'shopping' }, JUNE)).toBe(true);
  });

  it('reports: the month spent $400.00 — groceries only; no Investment & Savings bucket', () => {
    const b = spendingByCategory(JUNE_ROWS, JUNE);
    expect(b.totalCents).toBe(40_000);
    expect(b.byCategory.map((c) => [c.categoryId, c.amountCents])).toEqual([['groceries', 40_000]]);
  });

  it('flows: income $5,000.00, expenses $400.00, savings rate 92% — the deposit is not an expense and the money back is not a refund', () => {
    for (const r of JUNE_ROWS.filter((t) => t.categoryId === 'investment')) {
      expect(countsInFlows(r)).toBe(false);
      expect(isIncomeFlowRow(r)).toBe(false);
    }
    const [june] = monthlyFlows(JUNE_ROWS);
    expect(june!.incomeCents).toBe(500_000);
    expect(june!.expensesCents).toBe(40_000);
    // (500,000 − 40,000) / 500,000 = 0.92 → 9,200 bps. Before #789: expenses
    // 40,000 + 100,000 − 25,000 = 115,000 → (500,000 − 115,000)/500,000 = 7,700.
    expect(june!.savingsRateBps).toBe(9_200);
  });

  it('the /reports bar panel lists the rows its bar summed — and still reconciles', () => {
    const flows = monthlyFlows(JUNE_ROWS);
    const panels = buildMonthFlowBreakdowns(JUNE_ROWS, flows);
    const spend = panels['2026-06:expense']!;
    const income = panels['2026-06:income']!;
    expect(spend.reconciles).toBe(true);
    expect(income.reconciles).toBe(true);
    // The expense bar's rows: groceries only ($400.00), oriented positive.
    expect(spend.rows.map((r) => r.amountCents)).toEqual([40_000]);
    expect(income.rows.map((r) => r.amountCents)).toEqual([500_000]);
  });

  it('trends: the deposit is neither the biggest purchase nor in the month’s pace', () => {
    const T = (date: string, amountCents: number, categoryId: string, merchant: string): TrendTxn => ({
      id: `${date}:${merchant}`,
      date,
      amountCents,
      categoryId,
      status: 'POSTED',
      merchant,
    });
    const r = computeSpendingTrends({
      txns: [T('2026-06-04', -100_000, 'investment', 'Vanguard'), T('2026-06-03', -40_000, 'groceries', 'Kroger')],
      today: '2026-06-10',
      scheduled: [],
    });
    expect(r.largest.map((l) => l.merchant)).toEqual(['Kroger']);
    expect(r.pace?.spentSoFarCents ?? 40_000).toBe(40_000);
  });

  it('Ask: the deposit is not "your biggest purchase"', () => {
    const rows: AskTxnRow[] = [
      { date: '2026-06-04', amountCents: -100_000, categoryId: 'investment', merchant: 'Vanguard', status: 'POSTED', merchantCategoryId: 'investment', aggregateMerchant: false },
      { date: '2026-06-03', amountCents: -40_000, categoryId: 'groceries', merchant: 'Kroger', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
    ];
    expect(largestPurchases(rows, THIS_MONTH, 5, '2026-06-10').map((t) => t.merchant)).toEqual(['Kroger']);
  });

  it('Ask: "how much did I spend on Investment & Savings" says why there is no spending figure', () => {
    const a = answerSpendByCategory(
      spendingByCategory(JUNE_ROWS, JUNE),
      { type: 'category', categoryId: 'investment', label: 'Investment & Savings' },
      THIS_MONTH,
    );
    expect(a.headline).toBe('No Investment & Savings spending this month.');
    expect(a.detail).toBe('Money filed Investment & Savings is saving, not spending, so no spending figure counts it.');
    const t = answerSpendByCategory(
      spendingByCategory(JUNE_ROWS, JUNE),
      { type: 'category', categoryId: 'transfer', label: 'Transfer' },
      THIS_MONTH,
    );
    expect(t.detail).toBe('A transfer moves your own money between your accounts, so no spending figure counts it.');
    // A real spend leaf with nothing in it keeps the bare zero (no reason to give).
    const g = answerSpendByCategory(
      spendingByCategory(JUNE_ROWS, JUNE),
      { type: 'category', categoryId: 'coffee', label: 'Coffee Shops' },
      THIS_MONTH,
    );
    expect(g.detail).toBeUndefined();
  });

  it('the register chip already said so — and still does (the figures now agree with it)', () => {
    const out = flowRow('2026-06-04', -100_000, 'investment');
    expect(classifySpendClass(out)).toBe('out-of-scope');
    expect(outOfScopeReason(out, 'out-of-scope')).toBe('investment');
  });
});

describe('#789 — /budgets: no spending target on a leaf that is never spending', () => {
  it('Investment & Savings is no longer offered or accepted as a target, nor as a money dial', () => {
    expect(isBudgetable('investment')).toBe(false);
    expect(isBudgetable('transfer')).toBe(false);
    expect(isBudgetable('groceries')).toBe(true);
    expect(isBudgetable('cash')).toBe(true); // unchanged: ATM cash is real leakage
    expect(buildDialCatalog([]).some((c) => c.id === 'investment')).toBe(false);
  });

  it('a target already stored on it is named, not tracked as "$0.00 spent"', () => {
    const stored = new Map([
      ['groceries', 50_000],
      ['investment', 100_000],
    ]);
    const { tracked, untracked } = untrackedBudgetTargets(stored);
    expect([...tracked]).toEqual([['groceries', 50_000]]);
    expect(untracked).toEqual([{ categoryId: 'investment', budgetCents: 100_000 }]);
    const rows = summarizeBudgets(new Map([['groceries', 40_000]]), tracked, { name: (id) => id, isDial: () => false });
    expect(rows.map((r) => r.categoryId)).toEqual(['groceries']);
    expect(untrackedBudgetTargetSentence('Investment & Savings', 100_000, 'investment')).toBe(
      'Your $1,000.00 monthly target on Investment & Savings isn’t tracked here: money moved into investing or savings is saving, not spending, so no spending figure counts it.',
    );
  });

  it('every other stored target is tracked exactly as before (legacy ids included)', () => {
    const stored = new Map([
      ['paycheck', 10_000], // a pre-#163 legacy target: not this slice's business
      ['groceries', 50_000],
    ]);
    const { tracked, untracked } = untrackedBudgetTargets(stored);
    expect(untracked).toEqual([]);
    expect([...tracked].sort()).toEqual([...stored].sort());
  });
});
