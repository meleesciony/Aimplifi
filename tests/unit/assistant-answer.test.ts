/**
 * Ask Aimplifi — answer formatter known-answer tests (DECISIONS #75). Every
 * dollar value here is hand-computed from the synthetic inputs, so these pin the
 * exact phrasing AND the arithmetic selection (the formatter must never invent a
 * number — it only renders engine output through formatCents).
 */
import { describe, expect, it } from 'vitest';
import {
  answerAccountBalance,
  answerCashNeeded,
  answerForecast,
  answerIncome,
  answerLargest,
  answerNetWorth,
  answerSafeToSpend,
  answerSavingsRate,
  answerSpendByCategory,
  answerSpendTotal,
  answerSubscriptions,
  answerTopCategories,
  answerUnknown,
  largestPurchases,
  type AccountLike,
  type PurchaseRow,
} from '@/lib/engine/assistant/answer';
import type { SpendingBreakdown } from '@/lib/engine/reports/reports';
import type { SpendingPlan } from '@/lib/engine/spending-plan/plan';
import type { RecurringSummary } from '@/lib/engine/recurring/summary';
import type { Forecast } from '@/lib/engine/forecast/forecast';
import type { CashNeededResult } from '@/lib/engine/cash-needed/types';
import type { Timeframe } from '@/lib/engine/assistant/intent';

const THIS_MONTH: Timeframe = { fromYm: '2026-06', toYm: '2026-06', label: 'this month' };
const LAST_MONTH: Timeframe = { fromYm: '2026-05', toYm: '2026-05', label: 'last month' };

const ACCOUNTS: AccountLike[] = [
  { id: 'a1', name: 'Everyday Checking', type: 'CHECKING', currentBalanceCents: 100000 },
  { id: 'a2', name: 'High-Yield Savings', type: 'SAVINGS', currentBalanceCents: 50000 },
  { id: 'a3', name: 'Freedom Card', type: 'CREDIT', currentBalanceCents: 30000 },
  { id: 'a4', name: 'Auto Loan', type: 'LOAN', currentBalanceCents: 200000 },
];

describe('answerNetWorth', () => {
  it('assets − liabilities, with the breakdown', () => {
    const a = answerNetWorth(ACCOUNTS); // 150000 − 230000 = −80000
    expect(a.headline).toBe('Your net worth is -$800.00.');
    expect(a.facts).toEqual([
      { label: 'Assets', value: '$1,500.00' },
      { label: 'Liabilities', value: '$2,300.00' },
    ]);
    expect(a.source).toEqual({ label: 'See accounts', href: '/accounts' });
  });

  // F1 regression: the breakdown must use the canonical isLiabilityType
  // ({CREDIT,LOAN,MORTGAGE,OTHER_LIABILITY}), so MORTGAGE/OTHER_LIABILITY count as
  // liabilities and the facts always reconcile to the headline net worth.
  it('classifies MORTGAGE + OTHER_LIABILITY as liabilities (facts reconcile to the headline)', () => {
    const accts: AccountLike[] = [
      { id: 'c', name: 'Checking', type: 'CHECKING', currentBalanceCents: 500000 },
      { id: 'm', name: 'Home Mortgage', type: 'MORTGAGE', currentBalanceCents: 30000000 },
      { id: 'o', name: 'Personal Note', type: 'OTHER_LIABILITY', currentBalanceCents: 250000 },
    ];
    const a = answerNetWorth(accts);
    // assets 500000 − liabilities (30000000+250000) = −29750000
    expect(a.headline).toBe('Your net worth is -$297,500.00.');
    const assets = Number(a.facts[0].value.replace(/[^0-9.-]/g, '')) * 100;
    const liabilities = Number(a.facts[1].value.replace(/[^0-9.-]/g, '')) * 100;
    expect(Math.round(assets - liabilities)).toBe(-29750000); // facts reconcile to headline
    expect(a.facts).toEqual([
      { label: 'Assets', value: '$5,000.00' },
      { label: 'Liabilities', value: '$302,500.00' },
    ]);
  });
  it('a mortgage balance reads as owed', () => {
    const accts: AccountLike[] = [{ id: 'm', name: 'Home Mortgage', type: 'MORTGAGE', currentBalanceCents: 30000000 }];
    expect(answerAccountBalance(accts, 'how much is left on my mortgage').headline).toBe('Home Mortgage has a balance of $300,000.00 owed.');
  });
});

describe('answerAccountBalance', () => {
  it('single asset account', () => {
    expect(answerAccountBalance(ACCOUNTS, "what's my checking balance").headline).toBe('Everyday Checking has $1,000.00.');
  });
  it('liability account phrasing', () => {
    expect(answerAccountBalance(ACCOUNTS, 'how much on my credit card').headline).toBe('Freedom Card has a balance of $300.00 owed.');
  });
  it('no match lists available accounts', () => {
    const a = answerAccountBalance(ACCOUNTS, 'how much is in my brokerage');
    expect(a.headline).toBe("I couldn't find an account matching that.");
    expect(a.facts).toHaveLength(4);
  });
  it('multiple matches sum', () => {
    const two = [...ACCOUNTS, { id: 'a5', name: 'Joint Checking', type: 'CHECKING', currentBalanceCents: 20000 }];
    const a = answerAccountBalance(two, 'how much in checking');
    expect(a.headline).toBe('$1,200.00 across 2 accounts.');
  });
});

const BREAKDOWN: SpendingBreakdown = {
  totalCents: 50000,
  byCategory: [
    { categoryId: 'groceries', name: 'Groceries', group: 'Food & Dining', amountCents: 30000 },
    { categoryId: 'dining', name: 'Dining Out', group: 'Food & Dining', amountCents: 20000 },
  ],
  byGroup: [
    {
      group: 'Food & Dining',
      amountCents: 50000,
      categories: [
        { categoryId: 'groceries', name: 'Groceries', group: 'Food & Dining', amountCents: 30000 },
        { categoryId: 'dining', name: 'Dining Out', group: 'Food & Dining', amountCents: 20000 },
      ],
    },
  ],
};

describe('answerSpend*', () => {
  it('total', () => {
    expect(answerSpendTotal(BREAKDOWN, THIS_MONTH).headline).toBe('You spent $500.00 this month.');
  });
  it('by category with share', () => {
    const a = answerSpendByCategory(BREAKDOWN, { type: 'category', categoryId: 'groceries', label: 'Groceries' }, LAST_MONTH);
    expect(a.headline).toBe('You spent $300.00 on Groceries last month.');
    expect(a.detail).toBe("That's 60% of your last month spending.");
  });
  it('by group', () => {
    const a = answerSpendByCategory(BREAKDOWN, { type: 'group', group: 'Food & Dining', label: 'food & dining' }, THIS_MONTH);
    expect(a.headline).toBe('You spent $500.00 on food & dining this month.');
  });
  // #154 critic P2: the "utilities" umbrella (a `categories` target) sums the split
  // leaves and lists the top 3 contributors, not just the residual `utilities` leaf.
  it('by category-set (utilities umbrella) sums the family and ranks facts', () => {
    const UTIL_BREAKDOWN = {
      totalCents: 40000,
      byCategory: [
        { categoryId: 'electricity', name: 'Electricity', group: 'Bills & Utilities', amountCents: 12000 },
        { categoryId: 'water', name: 'Water & Sewer', group: 'Bills & Utilities', amountCents: 6000 },
        { categoryId: 'trash', name: 'Trash & Recycling', group: 'Bills & Utilities', amountCents: 4000 },
        { categoryId: 'natural-gas', name: 'Natural Gas', group: 'Bills & Utilities', amountCents: 3000 },
        { categoryId: 'utilities', name: 'Internet & Utilities', group: 'Bills & Utilities', amountCents: 2000 },
        { categoryId: 'dining', name: 'Dining Out', group: 'Food & Dining', amountCents: 13000 },
      ],
      byGroup: [],
    };
    const a = answerSpendByCategory(
      UTIL_BREAKDOWN,
      { type: 'categories', categoryIds: ['utilities', 'electricity', 'natural-gas', 'water', 'trash'], label: 'utilities' },
      THIS_MONTH,
    );
    expect(a.headline).toBe('You spent $270.00 on utilities this month.'); // 120+60+40+30+20, NOT just the $20 residual
    expect(a.facts.map((f) => f.label)).toEqual(['Electricity', 'Water & Sewer', 'Trash & Recycling']); // top 3, dining excluded
  });
  it('zero category', () => {
    const a = answerSpendByCategory(BREAKDOWN, { type: 'category', categoryId: 'coffee', label: 'Coffee Shops' }, THIS_MONTH);
    expect(a.headline).toBe('No Coffee Shops spending this month.');
  });
  it('top categories', () => {
    const a = answerTopCategories(BREAKDOWN, THIS_MONTH, 5);
    expect(a.headline).toBe('Your top spending this month: Groceries at $300.00.');
    expect(a.facts).toHaveLength(2);
  });
});

describe('largestPurchases + answerLargest', () => {
  const rows: PurchaseRow[] = [
    { date: '2026-06-05', amountCents: -10000, categoryId: 'dining', merchant: 'A' },
    { date: '2026-06-06', amountCents: -25000, categoryId: 'groceries', merchant: 'B' },
    { date: '2026-06-07', amountCents: 5000, categoryId: 'refund', merchant: 'C' }, // inflow excluded
    { date: '2026-06-08', amountCents: -3000, categoryId: 'income', merchant: 'D' }, // income group excluded
    { date: '2026-06-09', amountCents: -8000, isTransfer: true, categoryId: 'groceries', merchant: 'E' }, // transfer excluded
    { date: '2026-05-30', amountCents: -99999, categoryId: 'shopping', merchant: 'OLD' }, // out of month excluded
    { date: '2026-06-02', amountCents: -5000, categoryId: 'shopping', merchant: 'Z' },
    { date: '2026-06-01', amountCents: -5000, categoryId: 'shopping', merchant: 'Y' },
  ];
  it('filters, ranks, tie-breaks by date then merchant', () => {
    const top = largestPurchases(rows, THIS_MONTH, 5, '2026-06-30');
    expect(top.map((t) => [t.merchant, t.amountCents])).toEqual([
      ['B', 25000],
      ['A', 10000],
      ['Y', 5000], // 06-01 before 06-02 on the tie
      ['Z', 5000],
    ]);
  });
  it('excludes future-dated rows (<= today) and ties by code-point merchant (trends parity)', () => {
    const r: PurchaseRow[] = [
      { date: '2026-06-20', amountCents: -99999, categoryId: 'shopping', merchant: 'FUTURE' }, // after today → excluded
      { date: '2026-06-05', amountCents: -5000, categoryId: 'shopping', merchant: 'apple' },
      { date: '2026-06-05', amountCents: -5000, categoryId: 'shopping', merchant: 'Banana' },
    ];
    const top = largestPurchases(r, THIS_MONTH, 5, '2026-06-10');
    // FUTURE excluded by the <= today guard; tie → code-point order ('B' 66 < 'a' 97), NOT localeCompare.
    expect(top.map((t) => t.merchant)).toEqual(['Banana', 'apple']);
  });
  it('formats the headline', () => {
    const a = answerLargest([{ date: '2026-06-10', merchant: 'COSTCO', categoryName: 'Groceries', amountCents: 25000 }], THIS_MONTH);
    expect(a.headline).toBe('Your biggest purchase this month was $250.00 at COSTCO.');
    expect(a.facts[0]).toEqual({ label: 'COSTCO · Jun 10, 2026', value: '$250.00' });
  });
});

describe('answerIncome', () => {
  it('formats income for a timeframe', () => {
    expect(answerIncome(245000, LAST_MONTH).headline).toBe('You brought in $2,450.00 last month.');
  });
});

describe('answerSafeToSpend', () => {
  it('left to spend + per day', () => {
    const plan: SpendingPlan = {
      today: '2026-06-23' as SpendingPlan['today'],
      expectedIncomeCents: 500000,
      spentSoFarCents: 200000,
      upcomingBillsCents: 100000,
      plannedSavingsCents: 50000,
      leftToSpendCents: 150000,
      daysLeftInMonth: 8,
      perDayCents: 18750,
      overspent: false,
    };
    expect(answerSafeToSpend(plan).headline).toBe('You have $1,500.00 left to spend this month — about $187.50/day for the next 8 days.');
  });
  it('overspent', () => {
    const plan = {
      today: '2026-06-23',
      expectedIncomeCents: 100000,
      spentSoFarCents: 130000,
      upcomingBillsCents: 0,
      plannedSavingsCents: 0,
      leftToSpendCents: -30000,
      daysLeftInMonth: 8,
      perDayCents: 0,
      overspent: true,
    } as SpendingPlan;
    expect(answerSafeToSpend(plan).headline).toBe("You're $300.00 over your plan for this month.");
  });
});

describe('answerCashNeeded', () => {
  const base = { cards: [], intraPeriodMinimum: null, minimumPathInterestCents: null };
  it('amount + date', () => {
    const r = {
      ...base,
      headline: { requiredCents: 120000, byDate: '2026-06-24', cardsDueCount: 2, shortfallCents: 0, shortfallDate: null, recommendation: null },
    } as unknown as CashNeededResult;
    const a = answerCashNeeded(r, 'Everyday Checking');
    expect(a.headline).toBe('You need $1,200.00 by Jun 24, 2026 to pay your cards in full.');
    expect(a.facts).toContainEqual({ label: 'Cards due', value: '2' });
  });
  it('shortfall adds the transfer advice', () => {
    const r = {
      ...base,
      headline: { requiredCents: 120000, byDate: '2026-06-24', cardsDueCount: 1, shortfallCents: 20000, shortfallDate: '2026-06-24', recommendation: { amountCents: 20000, byDate: '2026-06-23' } },
    } as unknown as CashNeededResult;
    const a = answerCashNeeded(r, 'Everyday Checking');
    expect(a.detail).toContain('move $200.00 in by Jun 23, 2026');
    expect(a.facts).toContainEqual({ label: 'Shortfall', value: '$200.00' });
  });
  it('nothing due', () => {
    const r = { ...base, headline: { requiredCents: 0, byDate: null, cardsDueCount: 0, shortfallCents: 0, shortfallDate: null, recommendation: null } } as unknown as CashNeededResult;
    expect(answerCashNeeded(r, 'Everyday Checking').headline).toBe('You have nothing due on your cards this cycle.');
  });
});

describe('answerSubscriptions', () => {
  // #166: the headline totals SUBSCRIPTIONS ONLY. The old copy used
  // monthlyRecurringSpendCents (subs + bills), attributing rent/loans to
  // "subscriptions" (~7× off for the demo). Bills are disclosed separately.
  it('headline totals subscriptions only; bills disclosed in detail; price-increase note kept', () => {
    const summary = {
      activeSubscriptionCount: 3,
      monthlyRecurringSpendCents: 4997 + 180000,
      subscriptions: [
        { merchantCanonical: 'NETFLIX', monthlyEquivalentCents: 1799 },
        { merchantCanonical: 'SPOTIFY', monthlyEquivalentCents: 1199 },
        { merchantCanonical: 'HULU', monthlyEquivalentCents: 1999 },
      ],
      bills: [{ merchantCanonical: 'RENT', monthlyEquivalentCents: 180000 }],
      priceIncreases: [{ merchantCanonical: 'NETFLIX' }],
    } as unknown as RecurringSummary;
    const a = answerSubscriptions(summary);
    expect(a.headline).toBe("You're paying about $49.97/mo across 3 active subscriptions.");
    expect(a.detail).toBe(
      'Recurring bills (rent, loans, utilities) add $1,800.00/mo on top — $1,849.97/mo of recurring charges in total. 1 subscription has gone up in price recently.',
    );
    expect(a.facts[0]).toEqual({ label: 'NETFLIX', value: '$17.99/mo' });
  });

  it('no bills → no bills sentence', () => {
    const summary = {
      activeSubscriptionCount: 1,
      monthlyRecurringSpendCents: 1799,
      subscriptions: [{ merchantCanonical: 'NETFLIX', monthlyEquivalentCents: 1799 }],
      bills: [],
      priceIncreases: [],
    } as unknown as RecurringSummary;
    const a = answerSubscriptions(summary);
    expect(a.headline).toBe("You're paying about $17.99/mo across 1 active subscription.");
    expect(a.detail).toBeUndefined();
  });
});

describe('answerForecast', () => {
  const fc = (over: Partial<Forecast>): Forecast =>
    ({
      today: '2026-06-23',
      startingBalanceCents: 300000,
      endingBalanceCents: 250000,
      lowest: { date: '2026-07-15', balanceCents: 150000 },
      highest: { date: '2026-06-23', balanceCents: 300000 },
      firstNegativeDate: null,
      totalInflowCents: 490000,
      totalOutflowCents: 540000,
      days: [],
      milestones: [],
      upcoming: [],
      ...over,
    }) as Forecast;
  it('positive projection', () => {
    expect(answerForecast(fc({}), 'Everyday Checking', 90).headline).toBe('Everyday Checking is projected at $2,500.00 in 90 days.');
  });
  it('dip warning', () => {
    expect(answerForecast(fc({ firstNegativeDate: '2026-08-01' }), 'Everyday Checking', 90).headline).toBe(
      'Heads up — Everyday Checking is projected to dip below $0.00 around Aug 1, 2026.',
    );
  });
});

describe('answerSavingsRate', () => {
  it('formats a rate', () => {
    const a = answerSavingsRate({ rateBps: 2000, incomeCents: 500000, expensesCents: 400000, monthLabel: 'May' });
    expect(a.headline).toBe('Your savings rate was 20.0% in May.');
    expect(a.detail).toBe('You kept $1,000.00 of $5,000.00 in income that month.');
  });
  it('handles no data', () => {
    expect(answerSavingsRate({ rateBps: null, incomeCents: 0, expensesCents: 0, monthLabel: 'May' }).headline).toContain("don't have a full month");
  });
});

describe('answerUnknown', () => {
  it('offers capabilities + suggestions', () => {
    const a = answerUnknown();
    expect(a.kind).toBe('unknown');
    expect(a.suggestions).toHaveLength(11);
    expect(a.suggestions).toContain('When will I be debt-free?');
    expect(a.suggestions).toContain('Can I be debt-free by December 2028?');
    expect(a.suggestions).toContain('Can I save $20,000 by December 2028?');
    expect(a.suggestions).toContain('Can I retire at 60?');
    expect(a.suggestions).toContain('How much did I spend at Costco this month?'); // #168 merchant intent
    expect(a.source).toBeUndefined();
  });
});
