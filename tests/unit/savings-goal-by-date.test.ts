/**
 * Known-answer + property tests for the inverse savings planner
 * (src/lib/engine/solve/savings-goal-by-date.ts, DECISIONS #126).
 *
 * Every required-monthly figure below is hand-derived to the cent and pinned in
 * docs/EDGE_CASES.md §Savings-goal-by-date. The load-bearing locks are:
 *   - MINIMALITY: the required monthly funds the goal by the date AND required-1 does NOT,
 *     checked INDEPENDENTLY via the same goalFundingMonths the /goals card uses.
 *   - CARD CONSISTENCY: the solver's monthsToGoal equals goalFIImpact's monthsToGoal at the
 *     solved contribution — so a goal saved at the solved monthly renders an identical
 *     timeline on /goals (the #125 card-vs-solver lesson, here proven, not assumed).
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import { cents } from '@/lib/money';
import { goalFIImpact, goalFundingMonths } from '@/lib/engine/goals';
import {
  type SavingsGoalByDateInput,
  solveSavingsGoalByDate,
} from '@/lib/engine/solve/savings-goal-by-date';

const d = isoDate;
const TODAY = d('2026-06-10');

function solve(over: Partial<SavingsGoalByDateInput>): ReturnType<typeof solveSavingsGoalByDate> {
  return solveSavingsGoalByDate({
    goalAmountCents: over.goalAmountCents ?? 600_000,
    currentSavingsCents: over.currentSavingsCents ?? 0,
    targetDate: over.targetDate ?? d('2027-06-10'),
    today: over.today ?? TODAY,
    safeToSpendCents: over.safeToSpendCents ?? 200_000,
  });
}

/** Independent oracle: does this monthly fund the goal by the date? Uses the SAME
 *  goalFundingMonths the /goals card renders with — so minimality is checked against the
 *  exact function that draws the timeline, not a re-derivation. */
function fundsBy(remainingCents: number, monthlyCents: number, targetMonths: number): boolean {
  const k = goalFundingMonths(remainingCents, monthlyCents);
  return k !== null && k <= targetMonths;
}

describe('solveSavingsGoalByDate — known-answer outcomes', () => {
  it('SG-A simple: $6,000 over 12 months → exactly $500.00/mo', () => {
    // remaining 600000; required = ceil(600000/12) = 50000.
    const r = solve({ goalAmountCents: 600_000, targetDate: d('2027-06-10'), safeToSpendCents: 200_000 });
    expect(r.outcome).toBe('reachable');
    expect(r.requiredMonthlyCents).toBe(50_000);
    expect(r.monthsToGoal).toBe(12);
    expect(r.shareOfSafeToSpendBps).toBe(2_500); // round(50000/200000*10000) = 25%
    expect(r.withinSafeToSpend).toBe(true);
    expect(r.goalAmountCents).toBe(600_000);
    expect(r.remainingCents).toBe(600_000);
  });

  it('SG-B already-funded: current ≥ goal → $0/mo, nothing to solve', () => {
    const r = solve({ goalAmountCents: 100_000, currentSavingsCents: 200_000, safeToSpendCents: 200_000 });
    expect(r.outcome).toBe('already-funded');
    expect(r.requiredMonthlyCents).toBe(0);
    expect(r.monthsToGoal).toBe(0);
    expect(r.shareOfSafeToSpendBps).toBe(0);
    expect(r.withinSafeToSpend).toBe(true);
    expect(r.remainingCents).toBe(0);
  });

  it('SG-C non-divisible: $5,000 over 7 months → exactly $714.29/mo (ceil)', () => {
    // ceil(500000/7) = ceil(71428.57) = 71429; 7 × 71429 = 500003 ≥ 500000.
    const r = solve({ goalAmountCents: 500_000, targetDate: d('2027-01-10'), safeToSpendCents: 100_000 });
    expect(r.targetMonths).toBe(7);
    expect(r.outcome).toBe('reachable');
    expect(r.requiredMonthlyCents).toBe(71_429);
    expect(r.monthsToGoal).toBe(7);
    expect(r.shareOfSafeToSpendBps).toBe(7_143); // round(71429/100000*10000) = round(7142.9)
    expect(r.withinSafeToSpend).toBe(true);
  });

  it('SG-D reachable but OVER budget: honest figure AND flagged unaffordable', () => {
    // $12,000 over 2 months → $6,000/mo; safe-to-spend only $500.
    const r = solve({ goalAmountCents: 1_200_000, targetDate: d('2026-08-10'), safeToSpendCents: 50_000 });
    expect(r.targetMonths).toBe(2);
    expect(r.outcome).toBe('reachable');
    expect(r.requiredMonthlyCents).toBe(600_000);
    expect(r.monthsToGoal).toBe(2);
    expect(r.shareOfSafeToSpendBps).toBe(120_000); // 1200% — honest, NOT clamped
    expect(r.withinSafeToSpend).toBe(false);
  });

  it('SG-E unreachable: a date today or in the past', () => {
    const r = solve({ goalAmountCents: 500_000, targetDate: d('2026-06-10'), safeToSpendCents: 100_000 });
    expect(r.outcome).toBe('unreachable');
    expect(r.targetMonths).toBe(0);
    expect(r.requiredMonthlyCents).toBeNull();
    expect(r.monthsToGoal).toBeNull();
    expect(r.shareOfSafeToSpendBps).toBeNull();
    expect(r.withinSafeToSpend).toBeNull();
    expect(r.remainingCents).toBe(500_000); // still reported, for the answer copy
  });

  it('SG-F overspent: safe-to-spend ≤ 0 → still a real figure, share/affordability null', () => {
    const r = solve({ goalAmountCents: 600_000, targetDate: d('2027-06-10'), safeToSpendCents: 0 });
    expect(r.outcome).toBe('reachable');
    expect(r.requiredMonthlyCents).toBe(50_000); // unchanged by safe-to-spend
    expect(r.shareOfSafeToSpendBps).toBeNull();
    expect(r.withinSafeToSpend).toBeNull();

    const neg = solve({ goalAmountCents: 600_000, targetDate: d('2027-06-10'), safeToSpendCents: -50_000 });
    expect(neg.shareOfSafeToSpendBps).toBeNull();
    expect(neg.withinSafeToSpend).toBeNull();
  });

  it('SG-G early finish: integer rounding can fund a month before the deadline (monthsToGoal < targetMonths)', () => {
    // remaining 10c over 6 months → ceil(10/6)=2c/mo, which funds in ceil(10/2)=5 months ≤ 6.
    const r = solve({ goalAmountCents: 10, targetDate: d('2026-12-10'), safeToSpendCents: 1_000_000 });
    expect(r.targetMonths).toBe(6);
    expect(r.requiredMonthlyCents).toBe(2);
    expect(r.monthsToGoal).toBe(5);
    expect(r.monthsToGoal as number).toBeLessThanOrEqual(r.targetMonths);
  });
});

describe('solveSavingsGoalByDate — minimality (independent oracle, via goalFundingMonths)', () => {
  const cases: { name: string; goalAmountCents: number; targetDate: ReturnType<typeof isoDate> }[] = [
    { name: 'SG-A', goalAmountCents: 600_000, targetDate: d('2027-06-10') },
    { name: 'SG-C', goalAmountCents: 500_000, targetDate: d('2027-01-10') },
    { name: 'odd remainder', goalAmountCents: 333_333, targetDate: d('2027-03-10') },
  ];
  for (const c of cases) {
    it(`${c.name}: required funds by the date and required-1 does not`, () => {
      const r = solve({ goalAmountCents: c.goalAmountCents, targetDate: c.targetDate, safeToSpendCents: 10_000_000 });
      expect(r.requiredMonthlyCents).not.toBeNull();
      const required = r.requiredMonthlyCents as number;
      expect(fundsBy(r.remainingCents, required, r.targetMonths)).toBe(true);
      expect(fundsBy(r.remainingCents, required - 1, r.targetMonths)).toBe(false);
    });
  }
});

describe('solveSavingsGoalByDate — card consistency (no #125 drift)', () => {
  it('the solved monthly renders the SAME timeline on /goals (goalFIImpact.monthsToGoal)', () => {
    for (const goalAmountCents of [600_000, 500_000, 333_333, 10, 1_234_567]) {
      const r = solve({ goalAmountCents, targetDate: d('2027-06-10'), safeToSpendCents: 10_000_000 });
      if (r.requiredMonthlyCents === null) continue;
      // The exact call /goals makes for a saved (kind null) goal: savedCents 0, so
      // goalRemainingCents = targetCents. portfolio/return/fiTarget only affect FI delay,
      // not monthsToGoal, so any non-degenerate values suffice here.
      const impact = goalFIImpact({
        portfolioCents: cents(0),
        monthlySavingsCents: cents(0),
        annualReturnBps: 0,
        fiTargetCents: cents(100_000_000),
        goalRemainingCents: cents(r.remainingCents),
        goalMonthlyContributionCents: cents(r.requiredMonthlyCents),
      });
      expect(impact.monthsToGoal).toBe(r.monthsToGoal);
    }
  });
});
