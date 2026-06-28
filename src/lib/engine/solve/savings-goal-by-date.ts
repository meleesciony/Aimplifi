/**
 * Inverse savings planner (AI Differentiation Plan §1.1 "Plan in Words", DECISIONS #126).
 *
 * The sibling of the debt-free-by-date solver (#125). Every other planner in the app is
 * FORWARD; this is INVERSE: state a target AMOUNT and a target DATE ("save $15,000 by next
 * December") and SOLVE for the minimal monthly contribution that funds it by then — then say
 * honestly whether that fits your real safe-to-spend, and refuse to invent a figure when the
 * date can't be reached.
 *
 * Pure & deterministic: integer cents in, integer cents out, no I/O, no `new Date()`. It
 * originates NO new money math — the funding timeline is the SAME flat model the /goals card
 * uses (`goalFundingMonths` in goals.ts: months = ceil(remaining / monthly), no investment
 * growth), so a goal saved at the solved monthly renders an identical timeline (the #125
 * card-vs-solver consistency lesson). Pinned to docs/EDGE_CASES.md §Savings-goal-by-date.
 *
 * Why no bisection (unlike the debt twin): debt amortizes (interest compounds), so its
 * monthsToDebtFree has no closed form and must be bisected over the tested engine. Savings is
 * LINEAR — `ceil(remaining / monthly)` — so the minimal monthly is closed-form:
 * `ceil(remaining / targetMonths)` is exactly the smallest integer m with
 * `ceil(remaining / m) ≤ targetMonths`. A minimality oracle (using the SAME goalFundingMonths
 * the card uses) pins this in the test suite.
 */
import type { ISODate } from '@/lib/dates';
import { goalFundingMonths } from '@/lib/engine/goals';
import { wholeMonthsUntil } from '@/lib/engine/solve/debt-free-by-date';

export type SavingsGoalByDateOutcome =
  /** Already have the target (or more) set aside — nothing to solve. */
  | 'already-funded'
  /** A finite monthly contribution funds the goal by the date. Affordability is reported separately. */
  | 'reachable'
  /** The date cannot be reached at all (it is today/in the past — under one whole month away). */
  | 'unreachable';

export interface SavingsGoalByDateInput {
  /** The user-STATED target to accumulate, integer cents (> 0). */
  goalAmountCents: number;
  /** Already set aside toward it. The app passes 0 (a fresh envelope, like createGoal's
   *  savedCents); the engine accepts > 0 for generality (the already-funded case). */
  currentSavingsCents: number;
  /** The goal date, a calendar date. */
  targetDate: ISODate;
  /** "Today" as a business date (DEMO_TODAY-pinned in demo). */
  today: ISODate;
  /** Monthly safe-to-spend, integer cents. May be ≤ 0 (overspent); share/affordability then null. */
  safeToSpendCents: number;
}

export interface SavingsGoalByDateResult {
  outcome: SavingsGoalByDateOutcome;
  /** Whole months from today to the target date (0 if the date is today/past). */
  targetMonths: number;
  /**
   * Minimal monthly contribution to reach the target by the date. 0 for already-funded;
   * null only when the date is unreachable.
   */
  requiredMonthlyCents: number | null;
  /**
   * Months the plan actually takes at requiredMonthly — the soonest achievable, always
   * ≤ targetMonths (integer rounding of the monthly can land a month early). 0 for
   * already-funded; null when unreachable.
   */
  monthsToGoal: number | null;
  /**
   * requiredMonthly as a share of monthly safe-to-spend, in bps. NOT clamped — a value over
   * 10000 (>100%) is the honest "this would take more than your whole safe-to-spend" signal.
   * null when safeToSpend ≤ 0 or there is no required figure.
   */
  shareOfSafeToSpendBps: number | null;
  /**
   * Does the required monthly fit inside monthly safe-to-spend? The honest affordability flag.
   * null when safeToSpend ≤ 0 or there is no required figure.
   */
  withinSafeToSpend: boolean | null;
  /** The user-stated target, echoed for the answer copy. */
  goalAmountCents: number;
  /** max(0, goal − current) — what's left to save. */
  remainingCents: number;
}

/**
 * Identical rule to the debt twin's `shareAndAffordability` (DECISIONS #125): a display ratio
 * in bps (not a materialized cent value, so no Cents rounding rule applies), and an honest
 * affordability flag. Replicated rather than imported to keep this solver self-contained; the
 * exact bps values are pinned in the test suite so the two can't silently diverge.
 */
function shareAndAffordability(
  requiredCents: number | null,
  safeToSpendCents: number,
): { shareOfSafeToSpendBps: number | null; withinSafeToSpend: boolean | null } {
  if (requiredCents === null || safeToSpendCents <= 0) {
    return { shareOfSafeToSpendBps: null, withinSafeToSpend: null };
  }
  return {
    shareOfSafeToSpendBps: Math.round((requiredCents / safeToSpendCents) * 10000),
    withinSafeToSpend: requiredCents <= safeToSpendCents,
  };
}

export function solveSavingsGoalByDate(input: SavingsGoalByDateInput): SavingsGoalByDateResult {
  const goalAmountCents = Math.max(0, Math.floor(input.goalAmountCents));
  const remainingCents = Math.max(0, goalAmountCents - Math.floor(input.currentSavingsCents));
  const targetMonths = wholeMonthsUntil(input.today, input.targetDate);

  // Already have it set aside — a $0 contribution is trivially affordable.
  if (remainingCents <= 0) {
    const { shareOfSafeToSpendBps, withinSafeToSpend } = shareAndAffordability(0, input.safeToSpendCents);
    return {
      outcome: 'already-funded',
      targetMonths,
      requiredMonthlyCents: 0,
      monthsToGoal: 0,
      shareOfSafeToSpendBps,
      withinSafeToSpend,
      goalAmountCents,
      remainingCents: 0,
    };
  }

  // The date is unreachable only when it is sooner than a single contribution cycle:
  // targetMonths < 1 (today or in the past). Refuse to invent a figure.
  if (targetMonths < 1) {
    return {
      outcome: 'unreachable',
      targetMonths,
      requiredMonthlyCents: null,
      monthsToGoal: null,
      shareOfSafeToSpendBps: null,
      withinSafeToSpend: null,
      goalAmountCents,
      remainingCents,
    };
  }

  // Minimal monthly (closed form): the smallest integer m with goalFundingMonths(remaining, m)
  // ≤ targetMonths is ceil(remaining / targetMonths). monthsToGoal is then recomputed through
  // the SAME helper the /goals card uses, so a saved goal's timeline matches exactly.
  const requiredMonthlyCents = Math.ceil(remainingCents / targetMonths);
  const monthsToGoal = goalFundingMonths(remainingCents, requiredMonthlyCents);
  const { shareOfSafeToSpendBps, withinSafeToSpend } = shareAndAffordability(
    requiredMonthlyCents,
    input.safeToSpendCents,
  );

  return {
    outcome: 'reachable',
    targetMonths,
    requiredMonthlyCents,
    monthsToGoal,
    shareOfSafeToSpendBps,
    withinSafeToSpend,
    goalAmountCents,
    remainingCents,
  };
}
