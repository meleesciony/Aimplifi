/**
 * Per-category Fixed amounts + Plan gate (DECISIONS #377).
 */
import { describe, expect, it } from 'vitest';
import {
  AGGREGATE_RESOLVE_MIN_SHARE_BPS,
  averageMonthlySpendByCategory,
  filedCategoryByMerchant,
  fixedAmountBasisClause,
  resolveFixedCategoryAmounts,
} from '@/lib/engine/spending-plan/fixed-category-amounts';
import { monthlyNonDiscretionaryCents } from '@/lib/engine/spending-plan/fixed-pattern';
import { computeSpendingPlan } from '@/lib/engine/spending-plan/plan';
import { suggestedCategoryIsFixed } from '@/lib/engine/spending-plan/spend-class';
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
      fixedMerchants: new Set<string>(),
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
      fixedMerchants: new Set<string>(),
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
      fixedMerchants: new Set<string>(),
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
      categoryIsFixed: (id) => suggestedCategoryIsFixed(id, CATEGORY_BY_ID),
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

  it('test_regression__detected_series_fallback_counts_discretionary_recurring', () => {
    // #384 follow-up. LAST-RESORT basis: no category rollup, no non-discretionary
    // spend history — a gym bill autopaid from savings is all we know about.
    // `fitness` is discretionary, so routing this branch through the
    // designation-aware union zeroed it and the bill was projected NOWHERE
    // (the L.25/L.26 owner symptom). Under-counting Fixed overstates guilt-free,
    // so every detected recurring outflow counts on this branch.
    const p = computeSpendingPlan({
      today,
      trailingMonthlyIncomeCents: [500_000],
      scheduledIncome: [],
      scheduledFixed: [{ amountCents: -4_500, cadence: 'MONTHLY', categoryId: 'fitness' }],
      trailingMonthlyFixedCents: [],
      categoryFixedCents: 0,
      categoryIsFixed: (id) => suggestedCategoryIsFixed(id, CATEGORY_BY_ID),
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
    });
    expect(p.fixedBasis).toBe('detected-series');
    expect(p.fixedExpensesCents).toBe(4_500); // FAIL-OLD (#384): 0
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
      fixedMerchants: new Set<string>(),
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

  it('test_regression__converted_merchant_leaves_the_rollup_entirely (C.23 critic P1-1)', () => {
    // The convert lever's reserve becomes the converted series' ONLY count —
    // the category rollup must exclude the merchant by canonical (the server
    // derives the set from the reserve goals, the same shape as the C.24 loan
    // exclusion), or the reserve ADDS to a typical that still holds the
    // converted charge: $60/mo of insurance typical plus a $10/mo reserve for
    // the same $120 annual dues is the double count the critic found.
    const rows = [
      txn({
        date: '2026-06-01',
        amountCents: -120_000,
        categoryId: 'insurance',
        rawDescriptor: 'AUTO CLUB DUES',
      }),
    ];
    // Un-excluded, the June charge is window mass: insurance typical $60/mo
    // (120000 ÷ the 2 observable months June+July).
    const withCharge = resolveFixedCategoryAmounts({
      transactions: rows,
      today,
      meta: CATEGORY_BY_ID,
      fixedMerchants: new Set<string>(),
      budgetByCategory: new Map(),
      nameOf: (id) => CATEGORY_BY_ID.get(id)!.name,
    });
    expect(withCharge.rows.map((x) => x.categoryId)).toEqual(['insurance']);
    expect(withCharge.rows[0]!.amountCents).toBe(60_000);

    const r = resolveFixedCategoryAmounts({
      transactions: rows,
      today,
      meta: CATEGORY_BY_ID,
      fixedMerchants: new Set<string>(),
      budgetByCategory: new Map(),
      nameOf: (id) => CATEGORY_BY_ID.get(id)!.name,
      excludeMerchantCanonicals: new Set(['Auto Club Dues']),
    });
    expect(r.rows).toHaveLength(0);
    expect(r.totalCents).toBe(0);
  });

  it('test_regression__converted_merchant_exclusion_leaves_the_categorys_other_spend (C.23 critic P1-1)', () => {
    // The exclusion drops only the converted merchant's rows — the category's
    // other bills stay, so Fixed does not lose a category the conversion never
    // touched. Insurance: monthly $100 STATE FARM bills plus the annual $120
    // AUTO CLUB DUES; with the dues excluded the typical is the $100/mo bill
    // alone (30000 ÷ 3 window months).
    const rows = [
      txn({ date: '2026-05-02', amountCents: -10_000, categoryId: 'insurance', rawDescriptor: 'STATE FARM' }),
      txn({ date: '2026-06-02', amountCents: -10_000, categoryId: 'insurance', rawDescriptor: 'STATE FARM' }),
      txn({ date: '2026-07-02', amountCents: -10_000, categoryId: 'insurance', rawDescriptor: 'STATE FARM' }),
      txn({ date: '2026-06-01', amountCents: -120_000, categoryId: 'insurance', rawDescriptor: 'AUTO CLUB DUES' }),
    ];
    const r = resolveFixedCategoryAmounts({
      transactions: rows,
      today,
      meta: CATEGORY_BY_ID,
      fixedMerchants: new Set<string>(),
      budgetByCategory: new Map(),
      nameOf: (id) => CATEGORY_BY_ID.get(id)!.name,
      excludeMerchantCanonicals: new Set(['Auto Club Dues']),
    });
    expect(r.rows.map((x) => x.categoryId)).toEqual(['insurance']);
    expect(r.rows[0]!.amountCents).toBe(10_000);
    expect(r.totalCents).toBe(10_000);
  });

  it('test_regression__converted_merchant_leaves_the_median_values_basis (C.23 critic round-2 P1-1)', () => {
    // The median VALUES path is the rollup's fallback: when a converted bill is
    // the reader's only fixed-classified window spend, the rollup exclusion
    // zeroes the category total, the plan flips to the trailing-median basis,
    // and the median must NOT count the converted charge whole beside the
    // reserve that replaced it — the critic's probe: $130,000 fixed vs the
    // correct $10,000, a 13x overstatement for every month that holds a
    // charge, recurring annually. The loader passes the SAME merged exclusion
    // set here as to the rollup (spending-plan.ts); this locks the function.
    const rows = [
      txn({ date: '2026-06-01', amountCents: -120_000, categoryId: 'insurance', rawDescriptor: 'AUTO CLUB DUES' }),
      txn({ date: '2026-06-10', amountCents: -10_000, categoryId: 'groceries', rawDescriptor: 'KROGER' }),
    ];
    const excluded = monthlyNonDiscretionaryCents(
      rows,
      CATEGORY_BY_ID,
      new Set<string>(),
      new Set(['Auto Club Dues']),
    );
    // The converted charge is gone from the month's value; the category's
    // other spend stays.
    expect(excluded.find((f) => f.month === '2026-06')!.expenseCents).toBe(10_000);
    // Without the exclusion the same month counts the charge whole — the exact
    // double count the loader's merged set closes.
    const unexcluded = monthlyNonDiscretionaryCents(rows, CATEGORY_BY_ID, new Set<string>());
    expect(unexcluded.find((f) => f.month === '2026-06')!.expenseCents).toBe(130_000);
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
    expect(m.get('groceries')).toEqual({ amountCents: 8_000, months: 3 });
  });

  it('test_regression__typical_divides_by_observable_months_not_window (C.5/#393)', () => {
    // The owner's Mathnasium shape: a MONTHLY bill whose first-ever charge landed
    // in the window's last month. FAIL-OLD: 59_300 / 3 = 19_767 — Fixed short by
    // two thirds, guilt-free over-generous (the dangerous direction).
    const m = averageMonthlySpendByCategory(
      [txn({ date: '2026-07-02', amountCents: -59_300, categoryId: 'education' })],
      isoDate('2026-08-01'),
      3,
    );
    expect(m.get('education')).toEqual({ amountCents: 59_300, months: 1 });
  });

  it('test_regression__established_long_cadence_keeps_window_smoothing (C.5/#393)', () => {
    // The owner's auto-insurance shape: a quarterly $1,553 premium charging since
    // BEFORE the window, once inside it. ÷3 = $517.67/mo is the correct monthly
    // reserve; dividing by months-WITH-a-charge would print $1,553/mo (3× over).
    // This pins the deliberate choice: an established category divides by the
    // whole window, however few months it happened to charge.
    const m = averageMonthlySpendByCategory(
      [
        txn({ date: '2026-04-15', amountCents: -155_300, categoryId: 'auto-insurance' }),
        txn({ date: '2026-07-15', amountCents: -155_300, categoryId: 'auto-insurance' }),
      ],
      isoDate('2026-08-01'),
      3,
    );
    expect(m.get('auto-insurance')).toEqual({ amountCents: 51_767, months: 3 });
  });

  it('a category two months old divides by two', () => {
    const m = averageMonthlySpendByCategory(
      [
        txn({ date: '2026-06-20', amountCents: -20_000, categoryId: 'kids' }),
        txn({ date: '2026-07-20', amountCents: -30_000, categoryId: 'kids' }),
      ],
      isoDate('2026-08-01'),
      3,
    );
    expect(m.get('kids')).toEqual({ amountCents: 25_000, months: 2 });
  });

  it('a refund does not start the clock, and cannot dilute the average (critic cycle 1)', () => {
    // First EVENT is a June refund; the first OUTFLOW is July. The divisor
    // follows the outflow AND the numerator shares its basis: a stray refund
    // landing before the category's first charge would otherwise print a
    // $100/mo bill as "$50.00 (typical)" — a false money claim both critics
    // found independently.
    const m = averageMonthlySpendByCategory(
      [
        txn({ date: '2026-06-10', amountCents: 5_000, categoryId: 'internet' }),
        txn({ date: '2026-07-10', amountCents: -10_000, categoryId: 'internet' }),
      ],
      isoDate('2026-08-01'),
      3,
    );
    expect(m.get('internet')).toEqual({ amountCents: 10_000, months: 1 });
  });

  it('a refund-only window yields no typical at all', () => {
    const m = averageMonthlySpendByCategory(
      [txn({ date: '2026-06-10', amountCents: 5_000, categoryId: 'internet' })],
      isoDate('2026-08-01'),
      3,
    );
    expect(m.has('internet')).toBe(false);
  });
});

describe('fixedAmountBasisClause (P1-8: the label states method + window)', () => {
  it('renders the golden sentences — and never claims anything about "first charges"', () => {
    // "since its first charge" was falsified by the critic cycle: the clock
    // starts at the first COUNTED outflow, while the register can show earlier
    // charges the flow sums exclude (transfer-flagged, pending). The sentence
    // claims exactly the computation: an average over the last N complete months.
    expect(fixedAmountBasisClause({ basis: 'budget-target', typicalMonths: 3 })).toBe(
      ' (your target)',
    );
    expect(fixedAmountBasisClause({ basis: 'typical-spend', typicalMonths: 3 })).toBe(
      ' (typical — average of your last 3 complete months)',
    );
    expect(fixedAmountBasisClause({ basis: 'typical-spend', typicalMonths: 1 })).toBe(
      ' (typical — average of your last complete month)',
    );
    expect(fixedAmountBasisClause({ basis: 'typical-spend', typicalMonths: 2 })).toBe(
      ' (typical — average of your last 2 complete months)',
    );
  });
});

describe('filedCategoryByMerchant (C.4/#393)', () => {
  const today = isoDate('2026-08-01');

  it('resolves the FILED id per merchant by outflow cents, ignoring inflows and unfiled rows', () => {
    const m = filedCategoryByMerchant(
      [
        txn({ date: '2026-05-05', amountCents: -14_640, categoryId: 'life-insurance', rawDescriptor: 'PRINCIPAL-CCAPNL PRIN FINAN' }),
        txn({ date: '2026-06-05', amountCents: -14_640, categoryId: 'life-insurance', rawDescriptor: 'PRINCIPAL-CCAPNL PRIN FINAN' }),
        txn({ date: '2026-07-05', amountCents: -14_640, categoryId: 'insurance', rawDescriptor: 'PRINCIPAL-CCAPNL PRIN FINAN' }),
        // A refund and an unfiled row at the same payee change nothing.
        txn({ date: '2026-07-06', amountCents: 14_640, categoryId: 'fees', rawDescriptor: 'PRINCIPAL-CCAPNL PRIN FINAN' }),
        txn({ date: '2026-07-07', amountCents: -100, categoryId: null, rawDescriptor: 'PRINCIPAL-CCAPNL PRIN FINAN' }),
        // A merchant with ONLY unfiled rows gets no entry (caller keeps the guess).
        txn({ date: '2026-07-08', amountCents: -45_000, categoryId: 'uncategorized', rawDescriptor: 'BOAT SLIP DRAFT' }),
      ],
      today,
    );
    expect(m.get('Principal-ccapnl Prin Finan')).toBe('life-insurance');
    expect(m.has('Boat Slip Draft')).toBe(false);
  });

  it('test_regression__window_cents_outvote_stale_history (critic cycle 1 P0-1)', () => {
    // Four old $1 filings under `storage` must NOT out-vote three live $146.40
    // charges filed `life-insurance`: an all-time row-count modal resolved to a
    // category with no current rollup mass, reopening the double-count one
    // level up (the union would add the series while the rollup counts the
    // live rows under life-insurance).
    const m = filedCategoryByMerchant(
      [
        txn({ date: '2025-01-05', amountCents: -100, categoryId: 'storage', rawDescriptor: 'PRINCIPAL-CCAPNL PRIN FINAN' }),
        txn({ date: '2025-02-05', amountCents: -100, categoryId: 'storage', rawDescriptor: 'PRINCIPAL-CCAPNL PRIN FINAN' }),
        txn({ date: '2025-03-05', amountCents: -100, categoryId: 'storage', rawDescriptor: 'PRINCIPAL-CCAPNL PRIN FINAN' }),
        txn({ date: '2025-04-05', amountCents: -100, categoryId: 'storage', rawDescriptor: 'PRINCIPAL-CCAPNL PRIN FINAN' }),
        txn({ date: '2026-05-05', amountCents: -14_640, categoryId: 'life-insurance', rawDescriptor: 'PRINCIPAL-CCAPNL PRIN FINAN' }),
        txn({ date: '2026-06-05', amountCents: -14_640, categoryId: 'life-insurance', rawDescriptor: 'PRINCIPAL-CCAPNL PRIN FINAN' }),
        txn({ date: '2026-07-05', amountCents: -14_640, categoryId: 'life-insurance', rawDescriptor: 'PRINCIPAL-CCAPNL PRIN FINAN' }),
      ],
      today,
    );
    expect(m.get('Principal-ccapnl Prin Finan')).toBe('life-insurance');
  });

  it('test_regression__mixed_aggregate_does_not_resolve (critic cycle 1 P0-2)', () => {
    // "Zelle Payment" is ONE canonical over many payees: four dinner Zelles
    // filed `dining` must not re-file the UNFILED house cleaner's series and
    // silently drop it from the Fixed union. The unfiled cleaner rows sit in
    // the supermajority denominator, so `dining` holds only ~26% of the
    // canonical's cents and no resolution happens.
    const m = filedCategoryByMerchant(
      [
        txn({ date: '2026-05-02', amountCents: -4_000, categoryId: 'dining', rawDescriptor: 'Zelle payment JPM99A11111' }),
        txn({ date: '2026-06-02', amountCents: -4_000, categoryId: 'dining', rawDescriptor: 'Zelle payment JPM99A22222' }),
        txn({ date: '2026-07-02', amountCents: -4_000, categoryId: 'dining', rawDescriptor: 'Zelle payment JPM99A33333' }),
        txn({ date: '2026-07-03', amountCents: -4_000, categoryId: 'dining', rawDescriptor: 'Zelle payment JPM99A44444' }),
        txn({ date: '2026-05-09', amountCents: -15_000, categoryId: null, rawDescriptor: 'Zelle payment JPM99A55555' }),
        txn({ date: '2026-06-09', amountCents: -15_000, categoryId: null, rawDescriptor: 'Zelle payment JPM99A66666' }),
        txn({ date: '2026-07-09', amountCents: -15_000, categoryId: null, rawDescriptor: 'Zelle payment JPM99A77777' }),
      ],
      today,
    );
    expect(m.has('Zelle Payment')).toBe(false);
  });

  it('test_regression__aggregate_with_any_unfiled_minority_never_resolves (critic cycle 3 P1-1)', () => {
    // The dangerous direction above the supermajority bar: 91% of the
    // canonical's cents filed `dining` (discretionary) + a 9% UNFILED cleaner.
    // Resolving to dining would make the union skip the series as
    // guilt-free — the cleaner's draft is in NO rollup category, and the
    // union is its only chance to be counted. Any unfiled remainder refuses.
    const m = filedCategoryByMerchant(
      [
        txn({ date: '2026-07-01', amountCents: -91_000, categoryId: 'dining', rawDescriptor: 'Zelle payment JPM99A11111' }),
        txn({ date: '2026-07-09', amountCents: -9_000, categoryId: null, rawDescriptor: 'Zelle payment JPM99A55555' }),
      ],
      today,
    );
    expect(m.has('Zelle Payment')).toBe(false);
  });

  it('test_regression__aggregate_supermajority_boundary (critic cycle 3 P1-2)', () => {
    // Fully-filed aggregates, two categories, no unfiled remainder: 91/9
    // resolves, 89/11 refuses. Pins the 90% bar itself — without these, the
    // threshold could drift anywhere between the ~26% and 100% extremes the
    // other fixtures cover.
    expect(AGGREGATE_RESOLVE_MIN_SHARE_BPS).toBe(9000);
    const above = filedCategoryByMerchant(
      [
        txn({ date: '2026-07-01', amountCents: -91_000, categoryId: 'home-services', rawDescriptor: 'Zelle payment JPM99A11111' }),
        txn({ date: '2026-07-02', amountCents: -9_000, categoryId: 'dining', rawDescriptor: 'Zelle payment JPM99A22222' }),
      ],
      today,
    );
    expect(above.get('Zelle Payment')).toBe('home-services');
    const below = filedCategoryByMerchant(
      [
        txn({ date: '2026-07-01', amountCents: -89_000, categoryId: 'home-services', rawDescriptor: 'Zelle payment JPM99A11111' }),
        txn({ date: '2026-07-02', amountCents: -11_000, categoryId: 'dining', rawDescriptor: 'Zelle payment JPM99A22222' }),
      ],
      today,
    );
    expect(below.has('Zelle Payment')).toBe(false);
  });

  it('test_regression__single_category_aggregate_resolves (critic cycle 2 P0-1)', () => {
    // The reverse failure: a reader whose aggregate Zelles are ALL filed into
    // one rollup category. A blanket refusal left the original double-count
    // alive for exactly this shape — the series unioned in under the
    // `uncategorized` guess while the same rows fed the home-services rollup.
    // One category holding 100% of the canonical's cents behaves as the single
    // payee it is.
    const m = filedCategoryByMerchant(
      [
        txn({ date: '2026-05-09', amountCents: -15_000, categoryId: 'home-services', rawDescriptor: 'Zelle payment JPM99A55555' }),
        txn({ date: '2026-06-09', amountCents: -15_000, categoryId: 'home-services', rawDescriptor: 'Zelle payment JPM99A66666' }),
        txn({ date: '2026-07-09', amountCents: -15_000, categoryId: 'home-services', rawDescriptor: 'Zelle payment JPM99A77777' }),
      ],
      today,
    );
    expect(m.get('Zelle Payment')).toBe('home-services');
  });

  it('test_regression__window_mass_outvotes_larger_stale_history', () => {
    // A payee re-filed after a habit change: $5,000 of 2025 rows under
    // `shopping` vs $439.20 of live window rows under `life-insurance`. The
    // dedupe question is where the money lives in the rollup's OWN window, so
    // the window mass wins even against a bigger all-time total.
    const m = filedCategoryByMerchant(
      [
        txn({ date: '2025-03-05', amountCents: -250_000, categoryId: 'shopping', rawDescriptor: 'PRINCIPAL-CCAPNL PRIN FINAN' }),
        txn({ date: '2025-04-05', amountCents: -250_000, categoryId: 'shopping', rawDescriptor: 'PRINCIPAL-CCAPNL PRIN FINAN' }),
        txn({ date: '2026-05-05', amountCents: -14_640, categoryId: 'life-insurance', rawDescriptor: 'PRINCIPAL-CCAPNL PRIN FINAN' }),
        txn({ date: '2026-06-05', amountCents: -14_640, categoryId: 'life-insurance', rawDescriptor: 'PRINCIPAL-CCAPNL PRIN FINAN' }),
        txn({ date: '2026-07-05', amountCents: -14_640, categoryId: 'life-insurance', rawDescriptor: 'PRINCIPAL-CCAPNL PRIN FINAN' }),
      ],
      today,
    );
    expect(m.get('Principal-ccapnl Prin Finan')).toBe('life-insurance');
  });

  it('test_regression__cents_outvote_row_counts_inside_the_window (critic cycle 1 P1-5)', () => {
    // Three $1 misfilings must not beat one real $146.40 charge in the same
    // window: the vote is money, not rows.
    const m = filedCategoryByMerchant(
      [
        txn({ date: '2026-07-01', amountCents: -100, categoryId: 'fees', rawDescriptor: 'PRINCIPAL-CCAPNL PRIN FINAN' }),
        txn({ date: '2026-07-02', amountCents: -100, categoryId: 'fees', rawDescriptor: 'PRINCIPAL-CCAPNL PRIN FINAN' }),
        txn({ date: '2026-07-03', amountCents: -100, categoryId: 'fees', rawDescriptor: 'PRINCIPAL-CCAPNL PRIN FINAN' }),
        txn({ date: '2026-07-05', amountCents: -14_640, categoryId: 'life-insurance', rawDescriptor: 'PRINCIPAL-CCAPNL PRIN FINAN' }),
      ],
      today,
    );
    expect(m.get('Principal-ccapnl Prin Finan')).toBe('life-insurance');
  });

  it('a reader-excluded row does not vote', () => {
    const m = filedCategoryByMerchant(
      [
        txn({ date: '2026-07-05', amountCents: -90_000, categoryId: 'shopping', rawDescriptor: 'ATT PAYMENT', excludeFromTotals: true }),
        txn({ date: '2026-07-06', amountCents: -1_000, categoryId: 'phone', rawDescriptor: 'ATT PAYMENT' }),
      ],
      today,
    );
    expect(m.get('AT&T')).toBe('phone');
  });

  it('breaks a full tie toward the most recent row', () => {
    const m = filedCategoryByMerchant(
      [
        txn({ date: '2026-05-05', amountCents: -1_000, categoryId: 'phone', rawDescriptor: 'ATT PAYMENT' }),
        txn({ date: '2026-06-05', amountCents: -1_000, categoryId: 'internet', rawDescriptor: 'ATT PAYMENT' }),
      ],
      today,
    );
    expect(m.get('AT&T')).toBe('internet');
  });
});
