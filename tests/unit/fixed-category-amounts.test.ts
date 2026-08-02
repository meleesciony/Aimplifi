/**
 * Per-category Fixed amounts + Plan gate (DECISIONS #377).
 */
import { describe, expect, it } from 'vitest';
import {
  averageMonthlySpendByCategory,
  resolveFixedCategoryAmounts,
} from '@/lib/engine/spending-plan/fixed-category-amounts';
import { computeSpendingPlan } from '@/lib/engine/spending-plan/plan';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import type { TxnLike } from '@/lib/engine/fi/insights';
import { isoDate } from '@/lib/dates';

function txn(
  partial: Partial<TxnLike> & Pick<TxnLike, 'date' | 'amountCents' | 'categoryId'>,
): TxnLike {
  return {
    accountId: 'chk',
    isTransfer: false,
    status: 'POSTED',
    rawDescriptor: 'X',
    ...partial,
  };
}

describe('resolveFixedCategoryAmounts', () => {
  const today = isoDate('2026-08-01');
  const history = [
    txn({ date: '2026-05-02', amountCents: -30_000, categoryId: 'groceries' }),
    txn({ date: '2026-06-02', amountCents: -30_000, categoryId: 'groceries' }),
    txn({ date: '2026-07-02', amountCents: -30_000, categoryId: 'groceries' }),
    txn({ date: '2026-05-03', amountCents: -8_000, categoryId: 'dining' }),
    txn({ date: '2026-06-03', amountCents: -8_000, categoryId: 'dining' }),
    txn({ date: '2026-07-03', amountCents: -8_000, categoryId: 'dining' }),
  ];

  it('uses typical spend for fixed categories and ignores dining', () => {
    const r = resolveFixedCategoryAmounts({
      transactions: history,
      today,
      meta: CATEGORY_BY_ID,
      overrides: new Map(),
      budgetByCategory: new Map(),
      nameOf: (id) => CATEGORY_BY_ID.get(id)!.name,
    });
    expect(r.rows.map((x) => x.categoryId)).toEqual(['groceries']);
    expect(r.rows[0]!.amountCents).toBe(30_000);
    expect(r.rows[0]!.basis).toBe('typical-spend');
    expect(r.hasReaderInput).toBe(false);
  });

  it('test_regression__budget_target_wins_over_typical_for_fixed_category', () => {
    const r = resolveFixedCategoryAmounts({
      transactions: history,
      today,
      meta: CATEGORY_BY_ID,
      overrides: new Map(),
      budgetByCategory: new Map([['groceries', 50_000]]),
      nameOf: (id) => CATEGORY_BY_ID.get(id)!.name,
    });
    expect(r.rows[0]!.amountCents).toBe(50_000);
    expect(r.rows[0]!.basis).toBe('budget-target');
    expect(r.hasReaderInput).toBe(true);
    expect(r.totalCents).toBe(50_000);
  });

  it('test_regression__category_rollup_drives_plan_whenever_positive', () => {
    // #380: always-on — no reader-input gate. Positive rollup wins over median.
    const withRollup = computeSpendingPlan({
      today,
      trailingMonthlyIncomeCents: [300_000, 300_000, 300_000],
      scheduledIncome: [],
      scheduledFixed: [],
      trailingMonthlyFixedCents: [100_000, 100_000, 100_000],
      categoryFixedCents: 200_000,
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
    });
    expect(withRollup.fixedBasis).toBe('category-designations');
    expect(withRollup.fixedExpensesCents).toBe(200_000);
    expect(withRollup.leftToSpendCents).toBe(100_000);

    const noRollup = computeSpendingPlan({
      today,
      trailingMonthlyIncomeCents: [300_000, 300_000, 300_000],
      scheduledIncome: [],
      scheduledFixed: [],
      trailingMonthlyFixedCents: [100_000, 100_000, 100_000],
      categoryFixedCents: 0,
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
    });
    expect(noRollup.fixedBasis).toBe('non-discretionary-median');
    expect(noRollup.fixedExpensesCents).toBe(100_000);
  });

  it('test_regression__category_rollup_floors_at_recurring_series', () => {
    const p = computeSpendingPlan({
      today,
      trailingMonthlyIncomeCents: [500_000],
      scheduledIncome: [],
      scheduledFixed: [{ amountCents: -250_000, cadence: 'MONTHLY' }],
      trailingMonthlyFixedCents: [80_000],
      categoryFixedCents: 100_000,
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
    });
    expect(p.fixedBasis).toBe('category-designations');
    expect(p.fixedExpensesCents).toBe(250_000); // max(100k rollup, 250k recurring)
  });
});

describe('averageMonthlySpendByCategory', () => {
  it('nets refunds inside a month before averaging', () => {
    const m = averageMonthlySpendByCategory(
      [
        txn({ date: '2026-07-01', amountCents: -10_000, categoryId: 'groceries' }),
        txn({ date: '2026-07-15', amountCents: 2_000, categoryId: 'groceries' }),
        txn({ date: '2026-06-01', amountCents: -8_000, categoryId: 'groceries' }),
        txn({ date: '2026-05-01', amountCents: -8_000, categoryId: 'groceries' }),
      ],
      isoDate('2026-08-01'),
      3,
    );
    // (−8000 + −8000 + −8000) / 3 = 8000 after netting July to −8000
    expect(m.get('groceries')).toBe(8_000);
  });
});
