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
  type AskTxnRow,
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
  { id: 'a1', name: 'Everyday Checking', type: 'CHECKING', currentBalanceCents: 100000, feedDroppedAt: null },
  { id: 'a2', name: 'High-Yield Savings', type: 'SAVINGS', currentBalanceCents: 50000, feedDroppedAt: null },
  { id: 'a3', name: 'Freedom Card', type: 'CREDIT', currentBalanceCents: 30000, feedDroppedAt: null },
  { id: 'a4', name: 'Auto Loan', type: 'LOAN', currentBalanceCents: 200000, feedDroppedAt: null },
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
      { id: 'c', name: 'Checking', type: 'CHECKING', currentBalanceCents: 500000, feedDroppedAt: null },
      { id: 'm', name: 'Home Mortgage', type: 'MORTGAGE', currentBalanceCents: 30000000, feedDroppedAt: null },
      { id: 'o', name: 'Personal Note', type: 'OTHER_LIABILITY', currentBalanceCents: 250000, feedDroppedAt: null },
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
    const accts: AccountLike[] = [{ id: 'm', name: 'Home Mortgage', type: 'MORTGAGE', currentBalanceCents: 30000000, feedDroppedAt: null }];
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
    const two = [...ACCOUNTS, { id: 'a5', name: 'Joint Checking', type: 'CHECKING', currentBalanceCents: 20000, feedDroppedAt: null }];
    const a = answerAccountBalance(two, 'how much in checking');
    expect(a.headline).toBe('$1,200.00 across 2 accounts.');
  });
});

const BREAKDOWN: SpendingBreakdown = {
  totalCents: 50000,
  countedOnHandoverDays: 0,
  uncountedOnHandoverDays: [],
  byCategory: [
    { categoryId: 'groceries', name: 'Groceries', group: 'Food & Dining', amountCents: 30000, countedOnHandoverDays: 0 },
    { categoryId: 'dining', name: 'Dining Out', group: 'Food & Dining', amountCents: 20000, countedOnHandoverDays: 0 },
  ],
  byGroup: [
    {
      group: 'Food & Dining',
      amountCents: 50000,
      categories: [
        { categoryId: 'groceries', name: 'Groceries', group: 'Food & Dining', amountCents: 30000, countedOnHandoverDays: 0 },
        { categoryId: 'dining', name: 'Dining Out', group: 'Food & Dining', amountCents: 20000, countedOnHandoverDays: 0 },
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
      countedOnHandoverDays: 0,
      uncountedOnHandoverDays: [],
      byCategory: [
        { categoryId: 'electricity', name: 'Electricity', group: 'Bills & Utilities', amountCents: 12000, countedOnHandoverDays: 0 },
        { categoryId: 'water', name: 'Water & Sewer', group: 'Bills & Utilities', amountCents: 6000, countedOnHandoverDays: 0 },
        { categoryId: 'trash', name: 'Trash & Recycling', group: 'Bills & Utilities', amountCents: 4000, countedOnHandoverDays: 0 },
        { categoryId: 'natural-gas', name: 'Natural Gas', group: 'Bills & Utilities', amountCents: 3000, countedOnHandoverDays: 0 },
        { categoryId: 'utilities', name: 'Internet & Utilities', group: 'Bills & Utilities', amountCents: 2000, countedOnHandoverDays: 0 },
        { categoryId: 'dining', name: 'Dining Out', group: 'Food & Dining', amountCents: 13000, countedOnHandoverDays: 0 },
      ],
      byGroup: [],
    };
    const a = answerSpendByCategory(
      UTIL_BREAKDOWN,
      { type: 'categories', categoryIds: ['utilities', 'electricity', 'natural-gas', 'water', 'trash'], label: 'utilities' },
      THIS_MONTH,
    );
    expect(a.headline).toBe('You spent $270.00 on utilities this month.'); // 120+60+40+30+20, NOT just the $20 residual
    // O.19b: the headline sums all five matched leaves, so the capped list must
    // carry its remainder — top 3 + the tail line recompose $270 on screen.
    expect(a.facts.map((f) => f.label)).toEqual([
      'Electricity',
      'Water & Sewer',
      'Trash & Recycling',
      // Scoped label (critic P3): a bare "Everything else" under a scoped
      // headline reads as all NON-utilities spending.
      'Everything else in utilities · 2 more categories',
    ]); // top 3, dining excluded
    expect(a.facts[3].value).toBe('$50.00'); // natural-gas $30 + internet $20 — $220 listed + $50 = the $270 headline
    expect(a.facts[3].traceKey).toBeUndefined(); // many categories, not one trace group — never a dead tap
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
  const rows: AskTxnRow[] = [
    { date: '2026-06-05', amountCents: -10000, categoryId: 'dining', merchant: 'A', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
    { date: '2026-06-06', amountCents: -25000, categoryId: 'groceries', merchant: 'B', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
    { date: '2026-06-07', amountCents: 5000, categoryId: 'refund', merchant: 'C', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false }, // inflow excluded
    { date: '2026-06-08', amountCents: -3000, categoryId: 'income', merchant: 'D', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false }, // income group excluded
    { date: '2026-06-09', amountCents: -8000, isTransfer: true, categoryId: 'groceries', merchant: 'E', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false }, // transfer excluded
    { date: '2026-05-30', amountCents: -99999, categoryId: 'shopping', merchant: 'OLD', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false }, // out of month excluded
    { date: '2026-06-02', amountCents: -5000, categoryId: 'shopping', merchant: 'Z', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
    { date: '2026-06-01', amountCents: -5000, categoryId: 'shopping', merchant: 'Y', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
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
    const r: AskTxnRow[] = [
      { date: '2026-06-20', amountCents: -99999, categoryId: 'shopping', merchant: 'FUTURE', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false }, // after today → excluded
      { date: '2026-06-05', amountCents: -5000, categoryId: 'shopping', merchant: 'apple', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
      { date: '2026-06-05', amountCents: -5000, categoryId: 'shopping', merchant: 'Banana', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
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
  const NO_DISCLOSURES = { undatedCards: [], statementPendingCards: [], duplicatePairs: [], frozenCards: [], creditCardCount: 0, creditCardsOutsideFigure: 0, cardsDatedAfterThisMonth: 0, fixedSeries: { detected: 0, counted: 0, onCard: 0, lapsed: 0, uncounted: 0, noCashAccount: 0 } };
  const BASE_PLAN = {
    today: '2026-06-23' as SpendingPlan['today'],
    trailingMonthlyIncomeCents: [500000],
    scheduledIncome: [],
    scheduledFixed: [],
    patternIncomeCents: 500000,
    incomeBasis: 'trailing-median' as const,
    incomeMonths: 1,
    suggestedIncomeCents: 500000,
    fixedExpensesCents: 300000,
    fixedBasis: 'detected-series' as const,
    fixedMonths: 0,
    suggestedFixedCents: 300000,
    // C.19/H.3: this fixture's basis is 'detected-series', which publishes no
    // itemization — the honest value here, not a convenience default.
    fixedLineItems: [],
    fixedLineItemsCoverRemainder: false,
    incomeSlideCents: 0,
    fixedSlideCents: 0,
    hasSlide: false,
    cardObligationsCents: 0,
    goalContributionsCents: 50000,
    savingsTargetBps: null,
    plannedSavingsCents: 50000,
    savingsSource: 'goals' as const,
    unallocatedSavingsCents: 0,
    cardObligationsEstimated: false,
    obligationsBeyondMonthCents: 0,
    obligationsBeyondMonthThroughDate: null,
    obligationsBeyondMonthEstimated: false,
    patternFixedCents: 0,
    reserveLines: [],
    reserveMonthlyCents: 0,
    reservesBeyondMonth: false,
    leftToSpendCents: 150000,
    overspent: false,
  };
  it('guilt-free to spend this month — a monthly allocation, no per-day framing (L.22)', () => {
    const a = answerSafeToSpend(BASE_PLAN, NO_DISCLOSURES);
    expect(a.headline).toBe('Your guilt-free allocation this month is $1,500.00.');
    expect(a.headline).not.toContain('/day');
    // Owner 2026-08-01: exactly three facts — income, fixed, savings. No card-payments line.
    expect(a.facts).toEqual([
      { label: 'Income (median of last 1 month)', value: '$5,000.00' },
      { label: 'Fixed & recurring expenses (monthly pattern)', value: '$3,000.00' },
      { label: 'Planned savings (goals)', value: '$500.00' },
    ]);
    // The detail states the pattern basis inline (the coaching guardrail).
    expect(a.detail).toContain('median of your last 1 complete month');
    expect(a.detail).toContain('minus fixed and recurring expenses and your planned savings');
    expect(a.detail).not.toContain('card payments due this month');
  });
  it('the one-time-deposit claim is qualified by how many months the median actually has (critic P1)', () => {
    // At 3 months the immunity is real; at 1-2 the same sentence was FALSE (a $18k spike
    // month became the income while the detail claimed it could not happen).
    const three = answerSafeToSpend({ ...BASE_PLAN, incomeMonths: 3 }, NO_DISCLOSURES);
    expect(three.detail).toContain('A one-time deposit is not income here');
    const one = answerSafeToSpend({ ...BASE_PLAN, incomeMonths: 1 }, NO_DISCLOSURES);
    expect(one.detail).not.toContain('A one-time deposit is not income here');
    expect(one.detail).toContain('a one-time deposit can still count');
  });
  it('overspent', () => {
    const plan = { ...BASE_PLAN, leftToSpendCents: -30000, overspent: true };
    expect(answerSafeToSpend(plan, NO_DISCLOSURES).headline).toBe("You're $300.00 over your plan for this month.");
  });
  it('a winning savings target relabels the savings fact', () => {
    const plan = {
      ...BASE_PLAN,
      savingsTargetBps: 2000,
      plannedSavingsCents: 100000,
      savingsSource: 'target' as const,
      leftToSpendCents: 100000,
    };
    const a = answerSafeToSpend(plan, NO_DISCLOSURES);
    // L.29 killed the drift this assertion had pinned: Ask said "Savings target
    // (Settings)" while the /spending-plan panel said "(from Settings)" for the
    // same line of the same figure. Both now come from `planRowLabels`.
    expect(a.facts).toContainEqual({ label: 'Savings target (from Settings)', value: '$1,000.00' });
  });
  it('the income fact names a detected-series or empty basis honestly', () => {
    const series = answerSafeToSpend(
      { ...BASE_PLAN, incomeBasis: 'detected-series' as const, incomeMonths: 0, patternIncomeCents: 541667, leftToSpendCents: 191667 },
      NO_DISCLOSURES,
    );
    expect(series.facts).toContainEqual({ label: 'Income (detected recurring, monthly)', value: '$5,416.67' });
    expect(series.detail).toContain('detected recurring income at a monthly rate');
    const none = answerSafeToSpend(
      { ...BASE_PLAN, incomeBasis: 'none' as const, incomeMonths: 0, patternIncomeCents: 0, leftToSpendCents: -350000, overspent: true },
      NO_DISCLOSURES,
    );
    expect(none.facts).toContainEqual({ label: 'Income (no pattern yet)', value: '$0.00' });
  });
  const QUALIFIER_PLAN = (over: Partial<SpendingPlan>): SpendingPlan =>
    ({
      ...BASE_PLAN,
      cardObligationsCents: 120000,
      plannedSavingsCents: 0,
      goalContributionsCents: 0,
      leftToSpendCents: 80000,
      ...over,
    }) as SpendingPlan;
  const FULL_DISCLOSURES = {
    undatedCards: [{ cardName: 'Venture', frozenSince: null }],
    statementPendingCards: [{ cardName: 'Bonvoy', dueDate: '2026-06-28' }],
    duplicatePairs: [{ aName: 'CREDIT CARD', bName: 'CREDIT CARD', confidence: 'high' as const }],
    frozenCards: [{ label: 'Freedom', frozenSince: '2026-06-01' }],
    // Four cards are named above, so this reader plainly has cards linked (L.29).
    creditCardCount: 4,
    creditCardsOutsideFigure: 0,
    cardsDatedAfterThisMonth: 0,
    fixedSeries: { detected: 0, counted: 0, onCard: 0, lapsed: 0, uncounted: 0, noCashAccount: 0 },
  };

  it('an uncounted repeating bill flips direction with the figure Ask renders (L.30)', () => {
    // Ask needs this sentence at all because this answer is UNTRACED: the
    // /spending-plan basis list that carries it cannot reach a reader who asked here.
    //
    // And it must flip. The overspent branch renders the OVERAGE — the negation of
    // left-to-spend — so one missing bill makes that figure BIGGER while it makes
    // room-to-spend SMALLER. The first draft of this sentence said "too generous"
    // unconditionally, which is backwards for every overspent reader; `headline` is
    // a required argument so no caller can inherit the wrong direction by default.
    const short = {
      ...NO_DISCLOSURES,
      fixedSeries: { detected: 4, counted: 3, onCard: 0, lapsed: 0, uncounted: 1, noCashAccount: 0 },
    };
    const positive = answerSafeToSpend(QUALIFIER_PLAN({}), short);
    expect(positive.detail).toContain(
      'One repeating bill we found is not in the fixed-expenses line, so your real fixed costs are higher than shown and the real amount free to spend is smaller than shown by that much. Your recurring list shows every bill we found, including it.',
    );
    const over = answerSafeToSpend(QUALIFIER_PLAN({ leftToSpendCents: -50000, overspent: true }), short);
    expect(over.detail).toContain(
      'One repeating bill we found is not in the fixed-expenses line, so your real fixed costs are higher than shown and the real overage is bigger than shown by that much. Your recurring list shows every bill we found, including it.',
    );
    // Neither surface may claim the wrong direction, so pin the absence too.
    expect(positive.detail).not.toContain('overage is bigger');
    expect(over.detail).not.toContain('free to spend is smaller');
    // Silent when there is nothing to disclose.
    expect(answerSafeToSpend(QUALIFIER_PLAN({}), NO_DISCLOSURES).detail).not.toContain(
      'not in the fixed-expenses line',
    );
  });

  it('when cards exist, detail points at Cash needed — undated/overage card notes are not on guilt-free', () => {
    // Owner 2026-08-01: card statement payments are settlement, not plan facts.
    // Undated / duplicate / frozen qualifiers left this answer; the one remaining
    // card sentence says they are not subtracted here.
    const a = answerSafeToSpend(QUALIFIER_PLAN({}), FULL_DISCLOSURES);
    expect(a.facts).toHaveLength(3);
    expect(a.facts.map((f) => f.label).join(' ')).not.toMatch(/Card payments/i);
    expect(a.detail).toContain('Card statement payments are not subtracted here');
    expect(a.detail).toContain('minus fixed and recurring expenses and your planned savings');
    expect(a.detail).not.toContain('no due date yet');
    expect(a.detail).not.toContain('not been generated yet');
    expect(a.detail).not.toContain('same card counted twice');
    expect(a.detail).not.toContain('stopped sharing');
    expect(a.detail).not.toContain('card payments due this month');
    expect(a.detail).not.toContain('overage');
  });

  it('estimated card obligations do not become a guilt-free fact', () => {
    const a = answerSafeToSpend(
      QUALIFIER_PLAN({ cardObligationsEstimated: true }),
      {
        undatedCards: [],
        statementPendingCards: [],
        duplicatePairs: [],
        frozenCards: [],
        creditCardCount: 1,
        creditCardsOutsideFigure: 0,
        cardsDatedAfterThisMonth: 0,
        fixedSeries: { detected: 0, counted: 0, onCard: 0, lapsed: 0, uncounted: 0, noCashAccount: 0 },
      },
    );
    expect(a.facts).toHaveLength(3);
    expect(a.facts.map((f) => f.label).join(' ')).not.toMatch(/Card payments/i);
    expect(a.detail).not.toContain('estimated from current balances');
    expect(a.detail).toContain('Card statement payments are not subtracted here');
    // Silent on the card sentence when there are no cards and no obligations.
    const none = answerSafeToSpend(
      { ...BASE_PLAN, cardObligationsCents: 0 },
      NO_DISCLOSURES,
    );
    expect(none.detail).not.toContain('Card statement payments are not subtracted here');
  });

  it('overspent branch keeps the three-term copy and the card-not-subtracted pointer', () => {
    const a = answerSafeToSpend(
      QUALIFIER_PLAN({ leftToSpendCents: -50000, overspent: true }),
      FULL_DISCLOSURES,
    );
    expect(a.headline).toBe("You're $500.00 over your plan for this month.");
    expect(a.detail).toContain('minus fixed and recurring expenses and your planned savings');
    expect(a.detail).toContain('Card statement payments are not subtracted here');
    // Old undated / overage card qualifiers must not return on guilt-free.
    expect(a.detail).not.toContain('the real overage may be higher than shown');
    expect(a.detail).not.toContain('the real overage is smaller than shown');
    expect(a.detail).not.toContain('free to spend may be lower');
    expect(a.detail).not.toContain('no due date yet');
  });
});

describe('answerCashNeeded', () => {
  // `unknownDueDateCards` is always present on a real engine result; these fixtures
  // are hand-built casts, so it has to be stated here too. Empty = every card is
  // datable, which is what these three cases are about.
  const base = {
    cards: [],
    unknownDueDateCards: [],
    intraPeriodMinimum: null,
    minimumPathInterestCents: null,
  };
  it('amount + date', () => {
    const r = {
      ...base,
      headline: { requiredCents: 120000, firstDueDate: '2026-06-24', byDate: '2026-06-24', cardsDueCount: 2, shortfallCents: 0, shortfallDate: null, recommendation: null },
    } as unknown as CashNeededResult;
    const a = answerCashNeeded(r, 'Everyday Checking');
    expect(a.headline).toBe('You need $1,200.00 by Jun 24, 2026 to pay your cards in full.');
    expect(a.facts).toContainEqual({ label: 'Cards due', value: '2' });
  });
  it('shortfall adds the transfer advice', () => {
    const r = {
      ...base,
      headline: { requiredCents: 120000, firstDueDate: '2026-06-24', byDate: '2026-06-24', cardsDueCount: 1, shortfallCents: 20000, shortfallDate: '2026-06-24', recommendation: { amountCents: 20000, byDate: '2026-06-23' } },
    } as unknown as CashNeededResult;
    const a = answerCashNeeded(r, 'Everyday Checking');
    expect(a.detail).toContain('move $200.00 in by Jun 23, 2026');
    expect(a.facts).toContainEqual({ label: 'Shortfall', value: '$200.00' });
  });
  it('nothing due', () => {
    const r = { ...base, headline: { requiredCents: 0, byDate: null, cardsDueCount: 0, shortfallCents: 0, shortfallDate: null, recommendation: null } } as unknown as CashNeededResult;
    expect(answerCashNeeded(r, 'Everyday Checking').headline).toBe('You have nothing due on your cards this cycle.');
  });
  it('C.12: a worst dip AFTER the first short date adds the two-step sentence (L.23)', () => {
    // The executed defect paired the window's worst figure with the first short date.
    // The instruction keeps the sufficient transfer; the added sentence pairs each
    // amount with its own date.
    const r = {
      ...base,
      headline: {
        requiredCents: 120000,
        byDate: '2026-06-24',
        cardsDueCount: 2,
        shortfallCents: 995100,
        shortfallDate: '2026-06-04',
        firstShortCents: 5000,
        worstDipDate: '2026-06-10',
        shortfallDateBalanceCents: -100,
        recommendation: { amountCents: 1000000, byDate: '2026-06-03' },
      },
    } as unknown as CashNeededResult;
    const a = answerCashNeeded(r, 'Everyday Checking');
    expect(a.detail).toContain('move $10,000.00 in by Jun 3, 2026');
    expect(a.detail).toContain('Two steps work: $50.00 by Jun 3, 2026 covers the first short day');
    expect(a.detail).toContain('the low point on Jun 10, 2026');
  });
  it('C.12: single-event shortfall adds NO two-step sentence (gate mutation lock)', () => {
    const r = {
      ...base,
      headline: {
        requiredCents: 120000,
        byDate: '2026-06-24',
        cardsDueCount: 1,
        shortfallCents: 20000,
        shortfallDate: '2026-06-24',
        firstShortCents: 0,
        worstDipDate: '2026-06-24',
        shortfallDateBalanceCents: -20000,
        recommendation: { amountCents: 20000, byDate: '2026-06-23' },
      },
    } as unknown as CashNeededResult;
    expect(answerCashNeeded(r, 'Everyday Checking').detail).not.toContain('Two steps work');
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
    expect(a.suggestions).toHaveLength(12);
    expect(a.suggestions).toContain('When will I be debt-free?');
    expect(a.suggestions).toContain('Can I be debt-free by December 2028?');
    expect(a.suggestions).toContain('Can I save $20,000 by December 2028?');
    expect(a.suggestions).toContain('Can I retire at 60?');
    expect(a.suggestions).toContain('If I want to save up to $10 million, what do I need to do?');
    expect(a.suggestions).toContain('How much did I spend at Costco this month?'); // #168 merchant intent
    expect(a.source).toBeUndefined();
  });
});

// ─── O.19b — a capped list under a period total states its remainder ─────────
// The owner's /reports complaint ("these numbers do not add up") applied to Ask:
// wherever a headline/detail figure sums the WHOLE array and the fact list is
// capped, a tail line summed from the SAME array recomposes the total on
// screen. Abstention is the other half of the lock: a complete list must stay
// byte-identical (no remainder line claiming money that does not exist).
describe('O.19b — capped category lists state their remainder', () => {
  const WIDE: SpendingBreakdown = {
    totalCents: 150000, // = Σ byCategory, the engine identity (reports.ts:101)
    countedOnHandoverDays: 0,
    uncountedOnHandoverDays: [],
    byCategory: [
      { categoryId: 'rent', name: 'Rent', group: 'Housing', amountCents: 50000, countedOnHandoverDays: 0 },
      { categoryId: 'groceries', name: 'Groceries', group: 'Food & Dining', amountCents: 40000, countedOnHandoverDays: 0 },
      { categoryId: 'dining', name: 'Dining Out', group: 'Food & Dining', amountCents: 30000, countedOnHandoverDays: 0 },
      { categoryId: 'fuel', name: 'Gas & Fuel', group: 'Transport', amountCents: 20000, countedOnHandoverDays: 0 },
      { categoryId: 'fun', name: 'Entertainment', group: 'Lifestyle', amountCents: 10000, countedOnHandoverDays: 0 },
    ],
    byGroup: [],
  };

  it('spend_total: top 3 + remainder recompose the headline total', () => {
    const a = answerSpendTotal(WIDE, THIS_MONTH);
    expect(a.headline).toBe('You spent $1,500.00 this month.');
    expect(a.facts).toHaveLength(4);
    const tail = a.facts[3];
    expect(tail.label).toBe('Everything else · 2 more categories');
    expect(tail.value).toBe('$300.00'); // 20000 + 10000 — $1,200 listed + $300 = $1,500
    expect(tail.traceKey).toBeUndefined(); // many categories ≠ one trace group: never a dead tap
  });

  it('spend_total: singular tail copy ("1 more category")', () => {
    const four: SpendingBreakdown = { ...WIDE, totalCents: 140000, byCategory: WIDE.byCategory.slice(0, 4) };
    const a = answerSpendTotal(four, THIS_MONTH);
    expect(a.facts[3].label).toBe('Everything else · 1 more category');
    expect(a.facts[3].value).toBe('$200.00');
  });

  it('spend_total: abstains when the list is complete (≤3 categories)', () => {
    const a = answerSpendTotal(BREAKDOWN, THIS_MONTH); // 2 categories
    expect(a.facts).toHaveLength(2);
    expect(a.facts.every((f) => !f.label.startsWith('Everything else'))).toBe(true);
  });

  it('top_categories: remainder against the caller limit; abstains at/over the full length', () => {
    const capped = answerTopCategories(WIDE, THIS_MONTH, 2);
    expect(capped.detail).toBe('Total this month: $1,500.00.');
    expect(capped.facts).toHaveLength(3);
    expect(capped.facts[2].label).toBe('Everything else · 3 more categories');
    expect(capped.facts[2].value).toBe('$600.00'); // 30000+20000+10000

    const complete = answerTopCategories(WIDE, THIS_MONTH, 5);
    expect(complete.facts).toHaveLength(5); // exact fit → no remainder line
    const over = answerTopCategories(BREAKDOWN, THIS_MONTH, 5);
    expect(over.facts).toHaveLength(2); // limit past the end → no remainder line
  });

  it('spend_by_category group branch: 4th leaf gets the remainder line', () => {
    const grouped: SpendingBreakdown = {
      totalCents: 150000,
      countedOnHandoverDays: 0,
      uncountedOnHandoverDays: [],
      byCategory: WIDE.byCategory,
      byGroup: [
        {
          group: 'Bills & Utilities',
          amountCents: 25000,
          categories: [
            { categoryId: 'electricity', name: 'Electricity', group: 'Bills & Utilities', amountCents: 12000, countedOnHandoverDays: 0 },
            { categoryId: 'water', name: 'Water & Sewer', group: 'Bills & Utilities', amountCents: 6000, countedOnHandoverDays: 0 },
            { categoryId: 'trash', name: 'Trash & Recycling', group: 'Bills & Utilities', amountCents: 4000, countedOnHandoverDays: 0 },
            { categoryId: 'natural-gas', name: 'Natural Gas', group: 'Bills & Utilities', amountCents: 3000, countedOnHandoverDays: 0 },
          ],
        },
      ],
    };
    const a = answerSpendByCategory(grouped, { type: 'group', group: 'Bills & Utilities', label: 'bills' }, THIS_MONTH);
    expect(a.headline).toBe('You spent $250.00 on bills this month.');
    expect(a.facts.map((f) => f.label)).toEqual([
      'Electricity',
      'Water & Sewer',
      'Trash & Recycling',
      'Everything else in bills · 1 more category',
    ]);
    expect(a.facts[3].value).toBe('$30.00'); // $220 listed + $30 = the $250 headline
  });

  it('subscriptions: 6th sub gets a /mo tail line from the same array the headline sums', () => {
    const summary = {
      activeSubscriptionCount: 6,
      monthlyRecurringSpendCents: 0,
      subscriptions: [
        { merchantCanonical: 'NETFLIX', monthlyEquivalentCents: 1799 },
        { merchantCanonical: 'SPOTIFY', monthlyEquivalentCents: 1199 },
        { merchantCanonical: 'HULU', monthlyEquivalentCents: 1999 },
        { merchantCanonical: 'MAX', monthlyEquivalentCents: 1599 },
        { merchantCanonical: 'DISNEY+', monthlyEquivalentCents: 1399 },
        { merchantCanonical: 'PEACOCK', monthlyEquivalentCents: 599 },
      ],
      bills: [],
      priceIncreases: [],
    } as unknown as RecurringSummary;
    const a = answerSubscriptions(summary);
    expect(a.headline).toBe("You're paying about $85.94/mo across 6 active subscriptions.");
    expect(a.facts).toHaveLength(6);
    expect(a.facts[5]).toEqual({ label: 'Everything else · 1 more subscription', value: '$5.99/mo' });
  });

  it('subscriptions: abstains at exactly 5', () => {
    const summary = {
      activeSubscriptionCount: 5,
      monthlyRecurringSpendCents: 0,
      subscriptions: [
        { merchantCanonical: 'A', monthlyEquivalentCents: 1000 },
        { merchantCanonical: 'B', monthlyEquivalentCents: 900 },
        { merchantCanonical: 'C', monthlyEquivalentCents: 800 },
        { merchantCanonical: 'D', monthlyEquivalentCents: 700 },
        { merchantCanonical: 'E', monthlyEquivalentCents: 600 },
      ],
      bills: [],
      priceIncreases: [],
    } as unknown as RecurringSummary;
    expect(answerSubscriptions(summary).facts).toHaveLength(5);
  });
});
