/**
 * Per-category Fixed amounts + Plan gate (DECISIONS #377).
 */
import { describe, expect, it } from 'vitest';
import {
  averageMonthlySpendByCategory,
  resolveFixedCategoryAmounts,
} from '@/lib/engine/spending-plan/fixed-category-amounts';
import { computeSpendingPlan } from '@/lib/engine/spending-plan/plan';
import { resolveCategoryIsFixed } from '@/lib/engine/spending-plan/spend-class';
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

  it('test_regression__category_rollup_unions_out_of_scope_recurring', () => {
    // Critic P0: groceries in rollup + out-of-dial transfer series must BOTH survive.
    const p = computeSpendingPlan({
      today,
      trailingMonthlyIncomeCents: [500_000],
      scheduledIncome: [],
      scheduledFixed: [
        { amountCents: -80_000, cadence: 'MONTHLY', categoryId: 'groceries' },
        { amountCents: -250_000, cadence: 'MONTHLY', categoryId: 'transfer' },
      ],
      trailingMonthlyFixedCents: [80_000],
      categoryFixedCents: 80_000,
      categoryFixedCoveredIds: new Set(['groceries']),
      categoryIsFixed: (id) => (id === 'groceries' ? true : id === 'transfer' ? null : false),
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
    });
    expect(p.fixedBasis).toBe('category-designations');
    expect(p.fixedExpensesCents).toBe(330_000); // 80k rollup + 250k transfer (not max)
    expect(p.leftToSpendCents).toBe(170_000);
  });

  it('test_regression__transfer_fixed_auto_loan_unions_when_absent_from_rollup', () => {
    // #381 critic P0: CarMax-style auto-loan is isTransfer → never in typical
    // rollup, but Fixed + counted — must not be skipped as "already in rollup".
    const p = computeSpendingPlan({
      today,
      trailingMonthlyIncomeCents: [500_000],
      scheduledIncome: [],
      scheduledFixed: [{ amountCents: -38_500, cadence: 'MONTHLY', categoryId: 'auto-loan' }],
      trailingMonthlyFixedCents: [80_000],
      categoryFixedCents: 80_000, // groceries only
      categoryFixedCoveredIds: new Set(['groceries']),
      categoryIsFixed: (id) => (id === 'groceries' || id === 'auto-loan' ? true : null),
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
    });
    expect(p.fixedBasis).toBe('category-designations');
    expect(p.fixedExpensesCents).toBe(118_500); // 80k + 385 loan
    expect(p.leftToSpendCents).toBe(381_500);
  });

  it('test_regression__median_fallback_unions_uncovered_auto_loan_not_max', () => {
    // #382 critic P0: category rollup empty → trailing median path. Scalar
    // Math.max(median, recurring) dropped complementary Fixed (auto-loan).
    // Median of grocery months = 200_000; loan 38_500 must ADD, not lose.
    const p = computeSpendingPlan({
      today,
      trailingMonthlyIncomeCents: [500_000],
      scheduledIncome: [],
      scheduledFixed: [{ amountCents: -38_500, cadence: 'MONTHLY', categoryId: 'auto-loan' }],
      trailingMonthlyFixedCents: [200_000, 200_000, 200_000],
      categoryFixedCents: 0,
      // Groceries fed the median months — covered so a grocery series would not
      // double-count; auto-loan is absent (never in median spend).
      categoryFixedCoveredIds: new Set(['groceries']),
      categoryIsFixed: (id) => (id === 'groceries' || id === 'auto-loan' ? true : null),
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
    });
    expect(p.fixedBasis).toBe('non-discretionary-median');
    // FAIL-OLD: Math.max(200_000, 38_500) === 200_000
    expect(p.fixedExpensesCents).toBe(238_500);
    expect(p.leftToSpendCents).toBe(261_500);
  });

  it('test_regression__isTransfer_auto_loan_absent_from_category_rollup', () => {
    // Soft-lock close (#382 critic P1-2): end-to-end through the rollup helper.
    const rows = [
      txn({
        date: '2026-05-05',
        amountCents: -80_000,
        categoryId: 'groceries',
        rawDescriptor: 'KROGER',
      }),
      txn({
        date: '2026-06-05',
        amountCents: -80_000,
        categoryId: 'groceries',
        rawDescriptor: 'KROGER',
      }),
      txn({
        date: '2026-07-05',
        amountCents: -80_000,
        categoryId: 'groceries',
        rawDescriptor: 'KROGER',
      }),
      txn({
        date: '2026-05-10',
        amountCents: -38_500,
        categoryId: 'auto-loan',
        isTransfer: true,
        rawDescriptor: 'CARMAX AUTO',
      }),
      txn({
        date: '2026-06-10',
        amountCents: -38_500,
        categoryId: 'auto-loan',
        isTransfer: true,
        rawDescriptor: 'CARMAX AUTO',
      }),
      txn({
        date: '2026-07-10',
        amountCents: -38_500,
        categoryId: 'auto-loan',
        isTransfer: true,
        rawDescriptor: 'CARMAX AUTO',
      }),
    ];
    const r = resolveFixedCategoryAmounts({
      transactions: rows,
      today,
      meta: CATEGORY_BY_ID,
      overrides: new Map(),
      budgetByCategory: new Map(),
      nameOf: (id) => CATEGORY_BY_ID.get(id)?.name ?? id,
    });
    expect(r.rows.map((x) => x.categoryId)).toEqual(['groceries']);
    expect(r.totalCents).toBe(80_000);
    const covered = new Set(r.rows.filter((x) => x.amountCents > 0).map((x) => x.categoryId));
    expect(covered.has('auto-loan')).toBe(false);

    const p = computeSpendingPlan({
      today,
      trailingMonthlyIncomeCents: [500_000],
      scheduledIncome: [],
      scheduledFixed: [{ amountCents: -38_500, cadence: 'MONTHLY', categoryId: 'auto-loan' }],
      trailingMonthlyFixedCents: [80_000],
      categoryFixedCents: r.totalCents,
      categoryFixedCoveredIds: covered,
      categoryIsFixed: (id) => resolveCategoryIsFixed(id, CATEGORY_BY_ID, new Map()),
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
    });
    expect(p.fixedExpensesCents).toBe(118_500);
  });

  it('test_regression__fixed_category_recurring_is_not_double_counted', () => {
    // Rent series filed under housing is already inside the rollup — do not add again.
    const p = computeSpendingPlan({
      today,
      trailingMonthlyIncomeCents: [500_000],
      scheduledIncome: [],
      scheduledFixed: [{ amountCents: -200_000, cadence: 'MONTHLY', categoryId: 'rent' }],
      trailingMonthlyFixedCents: [200_000],
      categoryFixedCents: 350_000, // rent + groceries typical
      categoryFixedCoveredIds: new Set(['rent', 'groceries']),
      categoryIsFixed: (id) => (id === 'rent' || id === 'groceries' ? true : null),
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
    });
    expect(p.fixedExpensesCents).toBe(350_000); // not 550k
  });

  it('test_regression__discretionary_recurring_stays_out_of_fixed_union', () => {
    const p = computeSpendingPlan({
      today,
      trailingMonthlyIncomeCents: [500_000],
      scheduledIncome: [],
      scheduledFixed: [{ amountCents: -5_000, cadence: 'MONTHLY', categoryId: 'subscriptions' }],
      trailingMonthlyFixedCents: [100_000],
      categoryFixedCents: 100_000,
      categoryFixedCoveredIds: new Set(['groceries']),
      categoryIsFixed: (id) => (id === 'subscriptions' ? false : true),
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
    });
    expect(p.fixedExpensesCents).toBe(100_000); // Netflix not added
  });

  it('test_regression__omitted_categoryIsFixed_does_not_double_count_recurring', () => {
    const p = computeSpendingPlan({
      today,
      trailingMonthlyIncomeCents: [500_000],
      scheduledIncome: [],
      scheduledFixed: [{ amountCents: -80_000, cadence: 'MONTHLY', categoryId: 'groceries' }],
      trailingMonthlyFixedCents: [],
      categoryFixedCents: 80_000,
      categoryFixedCoveredIds: new Set(['groceries']),
      // categoryIsFixed omitted on purpose
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
    });
    expect(p.fixedExpensesCents).toBe(80_000); // not 160k
  });

  it('test_regression__fallback_recurring_excludes_credit_card_payment', () => {
    const p = computeSpendingPlan({
      today,
      trailingMonthlyIncomeCents: [500_000],
      scheduledIncome: [],
      scheduledFixed: [
        { amountCents: -100_000, cadence: 'MONTHLY', categoryId: 'rent' },
        { amountCents: -50_000, cadence: 'MONTHLY', categoryId: 'credit-card-payment' },
      ],
      trailingMonthlyFixedCents: [],
      categoryFixedCents: 0,
      cardObligationsCents: 50_000,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
    });
    expect(p.fixedBasis).toBe('detected-series');
    expect(p.fixedExpensesCents).toBe(100_000); // payment not Fixed
  });

  it('test_regression__credit_card_purchases_count_in_fixed_card_payment_does_not', () => {
    // Owner: May Visa Whole Foods $120 + Shell $40 Fixed; Netflix $15 discretionary;
    // June checking pays Visa $175 = settlement, not an expense. Fixed ≈ $160.
    const visa = 'visa';
    const checking = 'chk';
    const months = [
      txn({
        accountId: visa,
        date: '2026-05-05',
        amountCents: -12_000,
        categoryId: 'groceries',
        rawDescriptor: 'WHOLE FOODS',
      }),
      txn({
        accountId: visa,
        date: '2026-05-06',
        amountCents: -4_000,
        categoryId: 'fuel',
        rawDescriptor: 'SHELL',
      }),
      txn({
        accountId: visa,
        date: '2026-05-07',
        amountCents: -1_500,
        categoryId: 'subscriptions',
        rawDescriptor: 'NETFLIX',
      }),
      txn({
        accountId: visa,
        date: '2026-06-05',
        amountCents: -12_000,
        categoryId: 'groceries',
        rawDescriptor: 'WHOLE FOODS',
      }),
      txn({
        accountId: visa,
        date: '2026-06-06',
        amountCents: -4_000,
        categoryId: 'fuel',
        rawDescriptor: 'SHELL',
      }),
      txn({
        accountId: visa,
        date: '2026-06-07',
        amountCents: -1_500,
        categoryId: 'subscriptions',
        rawDescriptor: 'NETFLIX',
      }),
      txn({
        accountId: visa,
        date: '2026-07-05',
        amountCents: -12_000,
        categoryId: 'groceries',
        rawDescriptor: 'WHOLE FOODS',
      }),
      txn({
        accountId: visa,
        date: '2026-07-06',
        amountCents: -4_000,
        categoryId: 'fuel',
        rawDescriptor: 'SHELL',
      }),
      txn({
        accountId: visa,
        date: '2026-07-07',
        amountCents: -1_500,
        categoryId: 'subscriptions',
        rawDescriptor: 'NETFLIX',
      }),
      // Card payment from checking — transfer settlement, never Fixed.
      txn({
        accountId: checking,
        date: '2026-06-15',
        amountCents: -17_500,
        categoryId: 'credit-card-payment',
        isTransfer: true,
        rawDescriptor: 'PAYMENT THANK YOU VISA',
      }),
      txn({
        accountId: checking,
        date: '2026-07-15',
        amountCents: -17_500,
        categoryId: 'credit-card-payment',
        isTransfer: true,
        rawDescriptor: 'PAYMENT THANK YOU VISA',
      }),
    ];
    const r = resolveFixedCategoryAmounts({
      transactions: months,
      today,
      meta: CATEGORY_BY_ID,
      overrides: new Map(),
      budgetByCategory: new Map(),
      nameOf: (id) => CATEGORY_BY_ID.get(id)!.name,
    });
    expect(r.totalCents).toBe(16_000); // groceries 120 + fuel 40; Netflix out
    expect(r.rows.map((x) => x.categoryId).sort()).toEqual(['fuel', 'groceries']);
    expect(r.rows.find((x) => x.categoryId === 'subscriptions')).toBeUndefined();

    // Card-payment series must not union into Fixed even if somehow scheduled.
    const p = computeSpendingPlan({
      today,
      trailingMonthlyIncomeCents: [500_000],
      scheduledIncome: [],
      scheduledFixed: [
        { amountCents: -17_500, cadence: 'MONTHLY', categoryId: 'credit-card-payment' },
      ],
      trailingMonthlyFixedCents: [],
      categoryFixedCents: r.totalCents,
      categoryFixedCoveredIds: new Set(r.rows.map((x) => x.categoryId)),
      categoryIsFixed: (id) => {
        if (id === 'groceries' || id === 'fuel') return true;
        if (id === 'subscriptions') return false;
        return null;
      },
      cardObligationsCents: 17_500,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
    });
    expect(p.fixedBasis).toBe('category-designations');
    expect(p.fixedExpensesCents).toBe(16_000); // not 16k + 175 payment
    expect(p.leftToSpendCents).toBe(484_000);
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
