/**
 * Non-discretionary fixed pattern for guilt-free (DECISIONS #371).
 */
import { describe, expect, it } from 'vitest';
import {
  isGuiltFreeFixedSpendRow,
  monthlyNonDiscretionaryCents,
} from '@/lib/engine/spending-plan/fixed-pattern';
import { computeSpendingPlan } from '@/lib/engine/spending-plan/plan';
import type { TxnLike } from '@/lib/engine/fi/insights';
import { isoDate } from '@/lib/dates';

function txn(partial: Partial<TxnLike> & Pick<TxnLike, 'date' | 'amountCents' | 'categoryId'>): TxnLike {
  return {
    accountId: 'chk',
    isTransfer: false,
    status: 'POSTED',
    rawDescriptor: 'X',
    ...partial,
  };
}

describe('monthlyNonDiscretionaryCents', () => {
  it('counts groceries and rent; excludes dining out, transfers, and investment', () => {
    const months = monthlyNonDiscretionaryCents([
      txn({ date: '2026-07-02', amountCents: -50_000, categoryId: 'groceries' }),
      txn({ date: '2026-07-03', amountCents: -200_000, categoryId: 'rent' }),
      txn({ date: '2026-07-04', amountCents: -8_000, categoryId: 'dining' }),
      txn({ date: '2026-07-05', amountCents: -100_000, categoryId: 'transfer' }),
      txn({ date: '2026-07-06', amountCents: -50_000, categoryId: 'investment' }),
    ]);
    expect(months).toEqual([{ month: '2026-07', expenseCents: 250_000 }]);
  });

  it('test_regression__dining_out_is_not_fixed', () => {
    expect(
      isGuiltFreeFixedSpendRow(
        txn({ date: '2026-07-01', amountCents: -4500, categoryId: 'dining' }),
      ),
    ).toBe(false);
    expect(
      isGuiltFreeFixedSpendRow(
        txn({ date: '2026-07-01', amountCents: -4500, categoryId: 'groceries' }),
      ),
    ).toBe(true);
  });

  it('test_regression__fitness_golf_is_discretionary_not_fixed', () => {
    expect(
      isGuiltFreeFixedSpendRow(
        txn({ date: '2026-07-01', amountCents: -12_000, categoryId: 'fitness' }),
      ),
    ).toBe(false);
  });
});

describe('computeSpendingPlan — non-discretionary fixed (#371)', () => {
  it('test_regression__fixed_is_nondiscretionary_median_not_tiny_recurring_only', () => {
    const p = computeSpendingPlan({
      today: isoDate('2026-08-01'),
      trailingMonthlyIncomeCents: [3_000_000, 3_000_000, 3_000_000],
      scheduledIncome: [],
      // Tiny recurring detector output (the owner-live failure mode: $834).
      scheduledFixed: [{ amountCents: -83_431, cadence: 'MONTHLY' }],
      trailingMonthlyFixedCents: [1_290_554, 1_378_026, 2_901_749],
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: 2500,
    });
    // median of fixed = 1_378_026; savings = 25% of 3_000_000 = 750_000
    expect(p.fixedBasis).toBe('non-discretionary-median');
    expect(p.fixedExpensesCents).toBe(1_378_026);
    expect(p.plannedSavingsCents).toBe(750_000);
    expect(p.leftToSpendCents).toBe(3_000_000 - 750_000 - 1_378_026); // 871_974
    // FAIL-OLD: fixed was only recurring $834.31 → left ≈ $22k.
    expect(p.leftToSpendCents).toBeLessThan(1_000_000);
  });

  it('test_regression__user_set_overrides_replace_suggestions', () => {
    const p = computeSpendingPlan({
      today: isoDate('2026-08-01'),
      trailingMonthlyIncomeCents: [2_000_000],
      scheduledIncome: [],
      scheduledFixed: [],
      trailingMonthlyFixedCents: [1_000_000],
      incomeOverrideCents: 3_000_000,
      fixedOverrideCents: 1_200_000,
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: 2500,
    });
    expect(p.incomeBasis).toBe('user-set');
    expect(p.fixedBasis).toBe('user-set');
    expect(p.suggestedIncomeCents).toBe(2_000_000);
    expect(p.suggestedFixedCents).toBe(1_000_000);
    expect(p.patternIncomeCents).toBe(3_000_000);
    expect(p.fixedExpensesCents).toBe(1_200_000);
    expect(p.plannedSavingsCents).toBe(750_000);
    expect(p.leftToSpendCents).toBe(3_000_000 - 750_000 - 1_200_000); // 1_050_000
  });

  it('test_regression__data_diff_from_intention_is_a_slide_not_a_rewrite', () => {
    // Intention: $10k fixed. Categories show $13k fixed → slide +$3k (overspend vs plan).
    const p = computeSpendingPlan({
      today: isoDate('2026-08-01'),
      trailingMonthlyIncomeCents: [3_000_000, 3_000_000, 3_000_000],
      scheduledIncome: [],
      scheduledFixed: [],
      trailingMonthlyFixedCents: [1_300_000],
      incomeOverrideCents: null,
      fixedOverrideCents: 1_000_000,
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: 2500,
    });
    expect(p.fixedExpensesCents).toBe(1_000_000); // intention wins the math
    expect(p.suggestedFixedCents).toBe(1_300_000);
    expect(p.fixedSlideCents).toBe(300_000);
    expect(p.hasSlide).toBe(true);
    expect(p.leftToSpendCents).toBe(3_000_000 - 750_000 - 1_000_000); // still on intention
  });
});
