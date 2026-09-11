/**
 * Goal progress + pace (DECISIONS #737).
 *
 * The /goals card used to answer one question — "how many months at this pledge?" — and
 * never the two a saver actually asks: "how far along am I?" and "will I make my date?".
 * This module answers both from the goal's stored fields alone, pure and deterministic:
 * integer cents in, integer cents / bps out, calendar dates only, no I/O, no `new Date()`.
 *
 * It originates NO new money math. The funding timeline is `goalFundingMonths` (the SAME
 * flat model the card and the inverse planner already share), and the required-monthly
 * figure for a dated goal comes from `solveSavingsGoalByDate` itself — the exact solver Ask
 * Aimplifi runs for "save $X by <date>" — so the card's "$714.29/mo gets you there on time"
 * and Ask's answer for the same goal are one figure, not two that happen to agree.
 *
 * Pinned to docs/EDGE_CASES.md §Goal-progress-and-pace.
 */
import { addMonthsClamped, type ISODate, isoDate, monthKey, monthWindow } from '@/lib/dates';
import { goalFundingMonths } from '@/lib/engine/goals';
import { solveSavingsGoalByDate } from '@/lib/engine/solve/savings-goal-by-date';

export type GoalPace =
  /** remaining = 0 — the full target is already set aside. */
  | 'funded'
  /** A target date is set and it is this month or earlier, with money still to go. */
  | 'date-passed'
  /** Money to go and no (or zero) monthly pledge — no timeline can be stated. */
  | 'no-pledge'
  /** A pledge but no target date — a funded-by month, nothing to be on pace FOR. */
  | 'no-date'
  /** The pledge funds the goal on or before the target date. */
  | 'on-track'
  /** The pledge lands after the target date. */
  | 'behind';

export interface GoalProgressInput {
  targetCents: number;
  savedCents: number;
  monthlyContributionCents: number | null;
  targetDate: ISODate | null;
  today: ISODate;
}

export interface GoalProgress {
  pace: GoalPace;
  /** max(0, target − saved). */
  remainingCents: number;
  /**
   * Share of the target already saved, in basis points, FLOORED and clamped to 0..10000.
   * Floored so a goal at 99.99% never reads "100%" — the bar may understate by <0.01%,
   * never overstate. A non-positive target has nothing left to fund → 10000.
   */
  fundedBps: number;
  /** Months to fully fund at the current pledge (`goalFundingMonths`); null with no pledge. */
  monthsToFunded: number | null;
  /** addMonthsClamped(today, monthsToFunded); null with no pledge. Today itself when funded. */
  fundedByDate: ISODate | null;
  /**
   * Whole months from today to the END of the target month (the solver's `wholeMonthsUntil`
   * against the month-granular deadline — see the dated branch); null with no date.
   */
  targetMonths: number | null;
  /**
   * The minimal monthly that funds the goal by the target date — `solveSavingsGoalByDate`'s
   * own figure. 0 when funded; null with no date or when the date has passed.
   */
  requiredMonthlyCents: number | null;
  /**
   * on-track: months of slack (targetMonths − monthsToFunded, ≥ 0).
   * behind: months late (monthsToFunded − targetMonths, ≥ 1).
   * null in every other pace.
   */
  monthsDelta: number | null;
  /** behind only: requiredMonthly − currentMonthly (> 0). null otherwise. */
  gapMonthlyCents: number | null;
}

/**
 * A stored `Goal.targetDate` as an ISODate, or null when absent or not a calendar date.
 * Every writer validates through `isoDate`, so the null branch is defensive only — a page
 * that renders a whole list must not throw on one row (the target-date control is equally
 * tolerant and shows "Set date" for a value it cannot read).
 */
export function goalTargetDate(raw: string | null | undefined): ISODate | null {
  if (!raw) return null;
  try {
    return isoDate(raw);
  } catch {
    return null;
  }
}

function fundedBps(targetCents: number, savedCents: number): number {
  if (targetCents <= 0) return 10000;
  const saved = Math.max(0, savedCents);
  // Integer arithmetic: floor of an exact ratio; both operands are non-negative integers.
  return Math.min(10000, Math.floor((saved * 10000) / targetCents));
}

export function goalProgress(input: GoalProgressInput): GoalProgress {
  const targetCents = Math.floor(input.targetCents);
  const savedCents = Math.floor(input.savedCents);
  const monthly = Math.max(0, Math.floor(input.monthlyContributionCents ?? 0));
  const remainingCents = Math.max(0, targetCents - savedCents);
  const bps = fundedBps(targetCents, savedCents);

  const monthsToFunded = goalFundingMonths(remainingCents, monthly);
  const fundedByDate = monthsToFunded === null ? null : addMonthsClamped(input.today, monthsToFunded);

  const base = {
    remainingCents,
    fundedBps: bps,
    monthsToFunded,
    fundedByDate,
    targetMonths: null as number | null,
    requiredMonthlyCents: null as number | null,
    monthsDelta: null as number | null,
    gapMonthlyCents: null as number | null,
  };

  if (input.targetDate === null) {
    if (remainingCents === 0) return { pace: 'funded', ...base };
    return { pace: monthly > 0 ? 'no-date' : 'no-pledge', ...base };
  }

  // A goal's date is MONTH-granular everywhere the reader meets it: the form is a month
  // picker (stored as the 1st — `updateGoalTargetDate`), Ask resolves "by June 2027" to the
  // month's END (`parseTargetDate`), and every card prints "by Jun 2027". Pace is therefore
  // judged against the end of the target month, or a form-set "Jun 2027" at $500/mo toward
  // $6,000 would read "behind by 1 month" against a 1st-of-June the reader never chose,
  // while the identical Ask-saved goal read on pace.
  const deadline = monthWindow(monthKey(input.targetDate)).to;

  // The dated branch reads the SAME solver Ask runs. safeToSpend is not a goal field, so
  // the affordability half of its answer (share / withinSafeToSpend) is not consulted here
  // — only the target-month count and the minimal monthly, which do not depend on it.
  const solved = solveSavingsGoalByDate({
    goalAmountCents: targetCents,
    currentSavingsCents: savedCents,
    targetDate: deadline,
    today: input.today,
    safeToSpendCents: 0,
  });
  const dated = { ...base, targetMonths: solved.targetMonths };

  if (solved.outcome === 'already-funded') {
    return { pace: 'funded', ...dated, requiredMonthlyCents: 0 };
  }
  if (solved.outcome === 'unreachable') {
    return { pace: 'date-passed', ...dated };
  }
  const requiredMonthlyCents = solved.requiredMonthlyCents;
  if (monthly === 0 || monthsToFunded === null) {
    return { pace: 'no-pledge', ...dated, requiredMonthlyCents };
  }
  if (monthsToFunded <= solved.targetMonths) {
    return {
      pace: 'on-track',
      ...dated,
      requiredMonthlyCents,
      monthsDelta: solved.targetMonths - monthsToFunded,
    };
  }
  return {
    pace: 'behind',
    ...dated,
    requiredMonthlyCents,
    monthsDelta: monthsToFunded - solved.targetMonths,
    // requiredMonthly is minimal for the date and the current pledge misses it, so the
    // current pledge is strictly below it: the gap is > 0 by construction.
    gapMonthlyCents: (requiredMonthlyCents ?? 0) - monthly,
  };
}

/**
 * Rank for "what needs my attention first" lists (Home). Lower sorts first. A goal that is
 * slipping outranks one waiting on a pledge, which outranks one that is fine, which outranks
 * one already done.
 */
export const GOAL_PACE_ATTENTION_RANK: Record<GoalPace, number> = {
  behind: 0,
  'date-passed': 1,
  'no-pledge': 2,
  'no-date': 3,
  'on-track': 4,
  funded: 5,
};
