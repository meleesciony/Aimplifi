/**
 * Glass-Box slice 2 (GLASSBOX_PLAN §Sequencing) — the `headlineCents` contract.
 *
 * `AssistantAnswer.headlineCents` is what makes the trace's drift guard REAL: the
 * server passes it as `expectedHeadlineCents`, and the trace (which recomputes the
 * figure independently) flips to `reconciled: false` if they ever diverge. That
 * guard is only meaningful if `headlineCents` is the SAME number the headline
 * STRING shows — set from the builder's own figure, not copied from the trace.
 *
 * So the load-bearing invariant, locked here: for every row-sum builder,
 * `headline` literally contains `formatCents(headlineCents)`; and every non-row-sum
 * or empty answer omits `headlineCents` entirely (the UI must not make it tappable).
 */
import { describe, expect, it } from 'vitest';
import {
  answerIncome,
  answerLargest,
  answerMerchantSpend,
  answerNetWorth,
  answerSpendByCategory,
  answerSpendTotal,
  answerTopCategories,
  type AccountLike,
  type AssistantAnswer,
  type MerchantSpendResult,
} from '@/lib/engine/assistant/answer';
import type { SpendingBreakdown } from '@/lib/engine/reports/reports';
import type { LargestTxn } from '@/lib/engine/trends/trends';
import type { Timeframe } from '@/lib/engine/assistant/intent';
import { formatCents, type Cents } from '@/lib/money';

const THIS_MONTH: Timeframe = { fromYm: '2026-06', toYm: '2026-06', label: 'this month' };
const LAST_MONTH: Timeframe = { fromYm: '2026-05', toYm: '2026-05', label: 'last month' };

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

const MERCHANT: MerchantSpendResult = {
  merchant: 'Costco',
  totalCents: 15844,
  count: 1,
  items: [{ date: '2026-06-10', merchant: 'Costco', amountCents: 15844 }],
};

const LARGEST: LargestTxn[] = [
  { date: '2026-06-10', merchant: 'Costco', categoryName: 'Groceries', amountCents: 15844 },
];

/** Every row-sum builder, keyed by the exact cents its headline must show. */
const ROW_SUM_ANSWERS: { name: string; answer: AssistantAnswer; expected: number }[] = [
  { name: 'spend_total', answer: answerSpendTotal(BREAKDOWN, THIS_MONTH), expected: 50000 },
  {
    name: 'spend_by_category',
    answer: answerSpendByCategory(BREAKDOWN, { type: 'category', categoryId: 'groceries', label: 'Groceries' }, LAST_MONTH),
    expected: 30000,
  },
  { name: 'top_categories', answer: answerTopCategories(BREAKDOWN, THIS_MONTH, 5), expected: 30000 },
  { name: 'merchant_spend', answer: answerMerchantSpend(MERCHANT, THIS_MONTH), expected: 15844 },
  { name: 'largest_purchases', answer: answerLargest(LARGEST, THIS_MONTH), expected: 15844 },
  { name: 'income', answer: answerIncome(245000, LAST_MONTH), expected: 245000 },
];

describe('headlineCents — the trace drift guard is non-vacuous', () => {
  it.each(ROW_SUM_ANSWERS)('$name: headlineCents matches the figure in the headline', ({ answer, expected }) => {
    expect(answer.headlineCents).toBe(expected);
    // The load-bearing tie: the string the user reads contains exactly this figure,
    // so `expectedHeadlineCents` can never green-check a different number than shown.
    expect(answer.headline).toContain(formatCents(expected as Cents));
  });
});

describe('headlineCents — absent when there is no figure to reconcile', () => {
  it('empty spend_total omits it', () => {
    expect(answerSpendTotal({ totalCents: 0, byCategory: [], byGroup: [] }, THIS_MONTH).headlineCents).toBeUndefined();
  });
  it('empty income omits it', () => {
    expect(answerIncome(0, THIS_MONTH).headlineCents).toBeUndefined();
  });
  it('empty largest omits it', () => {
    expect(answerLargest([], THIS_MONTH).headlineCents).toBeUndefined();
  });
  it('empty merchant_spend omits it', () => {
    expect(answerMerchantSpend({ merchant: 'Costco', totalCents: 0, count: 0, items: [] }, THIS_MONTH).headlineCents).toBeUndefined();
  });
  it('zero-amount category omits it', () => {
    const a = answerSpendByCategory(BREAKDOWN, { type: 'category', categoryId: 'coffee', label: 'Coffee Shops' }, THIS_MONTH);
    expect(a.headlineCents).toBeUndefined();
  });
});

describe('headlineCents — never set for a derivation intent (stays non-tappable)', () => {
  it('net_worth carries no headlineCents', () => {
    const accounts: AccountLike[] = [
      { id: 'a1', name: 'Checking', type: 'CHECKING', currentBalanceCents: 100000 },
      { id: 'a2', name: 'Card', type: 'CREDIT', currentBalanceCents: 30000 },
    ];
    expect(answerNetWorth(accounts).headlineCents).toBeUndefined();
  });
});
