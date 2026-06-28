/**
 * Inverse debt planner (AI Differentiation Plan §1.1 "Plan in Words", DECISIONS #125).
 *
 * Every other planner in the app is FORWARD: change a knob, see the result. This is
 * INVERSE: state a target DATE ("be debt-free by December 2027") and SOLVE the existing
 * debt engine for the minimal extra-monthly payment that hits it — then say honestly
 * whether that is realistic against your real safe-to-spend, and refuse to invent a
 * figure when the date simply can't be reached.
 *
 * Pure & deterministic: integer cents in, integer cents out, no I/O, no `new Date()`.
 * It originates NO new debt math — it BISECTS the already-tested `planDebtPayoff`
 * (DECISIONS #95/#98) over its monotone `extraMonthlyCents → monthsToDebtFree` knob,
 * the exact pattern `coastFI` (fi.ts) already ships. Pinned to docs/EDGE_CASES.md
 * §Debt-free-by-date.
 *
 * Monotonicity (why bisection is valid): more budget never delays a payoff — with a
 * larger monthly budget every debt's balance trajectory is pointwise ≤ the smaller-budget
 * trajectory, so `monthsToDebtFree` is non-increasing in `extraMonthlyCents` (null = never,
 * which behaves as +∞). Hence the predicate `monthsToDebtFree ≤ targetMonths` flips
 * false→true exactly once as extra rises. A property test in the suite pins this.
 *
 * Design note (DECISIONS #125): the §5 plan sketch used a single `feasible` boolean but
 * itself wanted the "reachable only above your safe-to-spend" case to return both
 * feasible:false AND the honest figure — a contradiction. We instead report an honest
 * `outcome` discriminant plus a separate `withinSafeToSpend` affordability flag, so an
 * over-budget-but-reachable target shows the real number AND flags it as a stretch,
 * never a fake yes and never a figure-less refusal.
 */
import { type DebtInput, type DebtStrategy, planDebtPayoff } from '@/lib/engine/debt/payoff';
import { type ISODate, addMonthsClamped, compareDates } from '@/lib/dates';

/** 100 years — mirrors payoff.ts / fi.ts MAX_MONTHS; nothing is reachable past this. */
const MAX_MONTHS = 1200;

/** Same 60-iteration cap as coastFI (fi.ts) — ample for any cent-scale binary search. */
const BISECTION_ITERATIONS = 60;

export type DebtFreeByDateOutcome =
  /** No debt at all (or all balances ≤ 0) — nothing to solve. */
  | 'already-debt-free'
  /** Minimum payments alone already clear the debt by the target date (extra = 0). */
  | 'on-track'
  /** A finite extra/mo hits the date. Affordability is reported separately. */
  | 'reachable'
  /** The date cannot be reached at all (it is today/in the past, or sooner than one cycle). */
  | 'unreachable';

export interface DebtFreeByDateInput {
  /** The same debt shape the payoff engine consumes (reused, not re-modelled). */
  debts: readonly DebtInput[];
  /** Payoff ordering — 'avalanche' (least interest) is the app default. */
  strategy: DebtStrategy;
  /** The goal date, a calendar date. */
  targetDate: ISODate;
  /** "Today" as a business date (DEMO_TODAY-pinned in demo). */
  today: ISODate;
  /** Monthly safe-to-spend, integer cents. May be ≤ 0 (overspent); share/affordability then null. */
  safeToSpendCents: number;
}

export interface DebtFreeByDateResult {
  outcome: DebtFreeByDateOutcome;
  /** Whole months from today to the target date (0 if the date is today/past). */
  targetMonths: number;
  /**
   * Minimal extra-per-month (on top of every minimum) to be debt-free by the date.
   * 0 for already-debt-free / on-track; null only when the date is unreachable.
   */
  requiredExtraMonthlyCents: number | null;
  /**
   * Months the plan actually takes at requiredExtra — the soonest achievable, always
   * ≤ targetMonths. 0 for already-debt-free; null when unreachable.
   */
  monthsToDebtFree: number | null;
  /**
   * requiredExtra as a share of monthly safe-to-spend, in bps. NOT clamped — a value
   * over 10000 (>100%) is the honest "this would take more than your whole safe-to-spend"
   * signal. null when safeToSpend ≤ 0 or there is no required figure.
   */
  shareOfSafeToSpendBps: number | null;
  /**
   * Does the required extra fit inside monthly safe-to-spend? The honest affordability
   * flag. null when safeToSpend ≤ 0 or there is no required figure.
   */
  withinSafeToSpend: boolean | null;
  /** Sum of all debt balances, cents — for the answer copy. */
  totalBalanceCents: number;
}

/**
 * Whole months from `today` to `target`, defined consistently with the payoff engine's
 * monthly cycles: the largest k where addMonthsClamped(today, k) ≤ target. This is
 * month-end-clamp-correct (Jan 31 → Feb 28 counts as one whole month) where naïve
 * day-subtraction is not. 0 if the target is today or in the past. Capped at MAX_MONTHS.
 */
export function wholeMonthsUntil(today: ISODate, target: ISODate): number {
  if (compareDates(target, today) <= 0) return 0;
  let k = 0;
  while (k < MAX_MONTHS && compareDates(addMonthsClamped(today, k + 1), target) <= 0) k++;
  return k;
}

function shareAndAffordability(
  requiredExtraCents: number | null,
  safeToSpendCents: number,
): { shareOfSafeToSpendBps: number | null; withinSafeToSpend: boolean | null } {
  if (requiredExtraCents === null || safeToSpendCents <= 0) {
    return { shareOfSafeToSpendBps: null, withinSafeToSpend: null };
  }
  return {
    // Both operands are non-negative here (safeToSpend > 0 guard above, requiredExtra ≥ 0),
    // so Math.round (half-up) is identical to the project's roundHalfAwayFromZero; this is a
    // ratio in bps, not a materialized cent value, so no Cents rounding rule applies.
    shareOfSafeToSpendBps: Math.round((requiredExtraCents / safeToSpendCents) * 10000),
    withinSafeToSpend: requiredExtraCents <= safeToSpendCents,
  };
}

export function solveDebtFreeByDate(input: DebtFreeByDateInput): DebtFreeByDateResult {
  const totalBalanceCents = input.debts.reduce((s, d) => s + Math.max(0, d.balanceCents), 0);
  const targetMonths = wholeMonthsUntil(input.today, input.targetDate);

  // Nothing owed — already there. requiredExtra 0; share 0 (a 0 payment is trivially affordable).
  if (totalBalanceCents <= 0) {
    const { shareOfSafeToSpendBps, withinSafeToSpend } = shareAndAffordability(0, input.safeToSpendCents);
    return {
      outcome: 'already-debt-free',
      targetMonths,
      requiredExtraMonthlyCents: 0,
      monthsToDebtFree: 0,
      shareOfSafeToSpendBps,
      withinSafeToSpend,
      totalBalanceCents: 0,
    };
  }

  const monthsAt = (extraMonthlyCents: number): number | null =>
    planDebtPayoff({ debts: [...input.debts], strategy: input.strategy, extraMonthlyCents }).monthsToDebtFree;

  const works = (extraMonthlyCents: number): boolean => {
    const m = monthsAt(extraMonthlyCents);
    return m !== null && m <= targetMonths;
  };

  // Sufficient upper bound for the bisection. Start at 2× total balance (clears the whole
  // portfolio in month 1 at any normal APR) and DOUBLE until works(hi) holds — so the bound
  // is sufficient by construction even at pathological rates where one month's interest could
  // exceed 2× balance (rather than a fixed 2× that a >1200% APR could defeat, falsely
  // reporting "unreachable"). The doubling is bounded; planDebtPayoff's own $1B overflow valve
  // caps any single balance, so a few dozen doublings is astronomically more than enough.
  let hi = Math.max(1, totalBalanceCents) * 2;
  for (let grow = 0; grow < 48 && !works(hi); grow++) hi *= 2;

  // The date is unreachable only when it is sooner than a single payment cycle: targetMonths < 1
  // (today or in the past), or — after growing the bound — still not hittable at all. Refuse to
  // invent a figure: no requiredExtra, no months.
  if (targetMonths < 1 || !works(hi)) {
    return {
      outcome: 'unreachable',
      targetMonths,
      requiredExtraMonthlyCents: null,
      monthsToDebtFree: null,
      shareOfSafeToSpendBps: null,
      withinSafeToSpend: null,
      totalBalanceCents,
    };
  }

  // Minimal extra by bisection (the coastFI idiom). works(hi) is true (grown above) and
  // works is monotone, so this converges to the smallest extra where the predicate holds; if
  // minimums alone already make the date, it converges to 0.
  let lo = 0;
  for (let iter = 0; iter < BISECTION_ITERATIONS && lo < hi; iter++) {
    const mid = Math.floor((lo + hi) / 2);
    if (works(mid)) hi = mid;
    else lo = mid + 1;
  }
  const requiredExtraMonthlyCents = lo;
  const monthsToDebtFree = monthsAt(requiredExtraMonthlyCents);
  const { shareOfSafeToSpendBps, withinSafeToSpend } = shareAndAffordability(
    requiredExtraMonthlyCents,
    input.safeToSpendCents,
  );

  return {
    outcome: requiredExtraMonthlyCents === 0 ? 'on-track' : 'reachable',
    targetMonths,
    requiredExtraMonthlyCents,
    monthsToDebtFree,
    shareOfSafeToSpendBps,
    withinSafeToSpend,
    totalBalanceCents,
  };
}
