// @vitest-environment jsdom
/**
 * DECISIONS #786 (critic cycles 1 and 2): after one change the regular-pay
 * figure counts the lower paycheck and, every week or two weeks, no more than a
 * usual month of the new pay — "your regular pay averaged over the year" would be
 * untrue, and a reader would take "your regular pay" as the newer one. One level
 * keeps the plain note. Invented figures.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/engagement-actions', () => ({ logEngagement: vi.fn() }));

import { cleanup, render, screen } from '@testing-library/react';
import { BudgetingCompositionCard } from '@/components/finance/budgeting-composition-card';
import { computeSpendingPlan, type SpendingPlanInput } from '@/lib/engine/spending-plan/plan';
import type { PayStep, RegularPay } from '@/lib/engine/spending-plan/regular-pay';
import { isoDate } from '@/lib/dates';

afterEach(cleanup);

function payWith(step: PayStep | null): RegularPay {
  return {
    clean: true,
    fallback: null,
    streams: [
      {
        payerCanonical: 'Northwind Health Payroll',
        frequency: 'biweekly',
        paycheckCents: 520000,
        step,
        monthlyCents: 1126667,
        firstPaidOn: isoDate('2026-06-12'),
        lastPaidOn: isoDate('2026-10-02'),
      },
    ],
    streamsMonthlyCents: 1126667,
    otherMonthlyCents: 0,
    monthlyCents: 1126667,
  };
}

function planWith(step: PayStep | null) {
  const input: SpendingPlanInput = {
    today: isoDate('2026-10-03'),
    trailingMonthlyIncomeCents: [1040000, 1040000, 1122080],
    scheduledIncome: [],
    scheduledFixed: [],
    categoryFixedCents: 300000,
    cardObligationsCents: 0,
    cardObligationsEstimated: false,
    obligationsBeyondMonthCents: 0,
    obligationsBeyondMonthThroughDate: null,
    obligationsBeyondMonthEstimated: false,
    goalContributionsCents: 0,
    savingsTargetBps: 0,
    regularPay: payWith(step),
  };
  return computeSpendingPlan(input);
}

describe('the /budgets income note after one change of pay', () => {
  it('test_regression__after_a_pay_change_the_budgets_note_does_not_say_averaged_over_the_year', () => {
    for (const step of [
      { direction: 'rose', newestCents: 572000, sinceCents: 572000 } as PayStep,
      { direction: 'fell', newestCents: 520000, sinceCents: 520000 } as PayStep,
    ]) {
      const plan = planWith(step);
      expect(plan.incomeBasis).toBe('regular-pay');
      render(<BudgetingCompositionCard plan={plan} savingsTargetBps={0} />);
      expect(screen.getByTestId('budgeting-income-basis').textContent).toBe(
        'app calculated — your regular pay since a change in pay, counted low (the arithmetic is on Guilt-free)',
      );
      cleanup();
    }
  });

  it('with other income riding along, the changed note keeps "counted low" (critic cycle 3, P3-2)', () => {
    const base = planWith({ direction: 'rose', newestCents: 572000, sinceCents: 572000 });
    const plan = { ...base, regularPay: { ...base.regularPay!, otherMonthlyCents: 26840 } };
    render(<BudgetingCompositionCard plan={plan} savingsTargetBps={0} />);
    expect(screen.getByTestId('budgeting-income-basis').textContent).toBe(
      'app calculated — your regular pay since a change in pay, counted low (the arithmetic is on Guilt-free), plus your usual other income',
    );
  });

  it('one level keeps the plain note', () => {
    render(<BudgetingCompositionCard plan={planWith(null)} savingsTargetBps={0} />);
    expect(screen.getByTestId('budgeting-income-basis').textContent).toBe('app calculated — your regular pay averaged over the year');
  });
});
