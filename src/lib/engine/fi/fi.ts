/**
 * FI engine (Phase 3) — binding formulas from docs/PHASE_0_ARCHITECTURE.md §6,
 * every function pinned to the hand-built tables in docs/EDGE_CASES.md §FI.
 *
 * Rate conventions:
 *  - Portfolio growth (years-to-FI, Coast FI) uses the GEOMETRIC monthly rate
 *    (1 + r)^(1/12) − 1, so an annual return compounds to exactly r.
 *  - Opportunity-cost FV uses the NOMINAL monthly rate r/12 with end-of-month
 *    contributions (the standard annuity convention) — per EDGE_CASES anchors.
 * Money stays integer cents at every materialized step (round half away from 0).
 */

import { type Cents, cents, roundHalfAwayFromZero } from '@/lib/money';

/** FI number = annual expenses × (10000 / swrBps). 400 bps → 25×. */
export function fiNumberCents(annualExpensesCents: Cents, swrBps: number): Cents {
  if (swrBps <= 0) throw new Error('swrBps must be positive');
  return roundHalfAwayFromZero((annualExpensesCents * 10000) / swrBps);
}

export function geometricMonthlyRate(annualReturnBps: number): number {
  return Math.pow(1 + annualReturnBps / 10000, 1 / 12) - 1;
}

export interface YearsToFIResult {
  months: number | null; // null = not reachable within the cap
  fiDate: { yearsFromNow: number; monthsRemainder: number } | null;
}

const MAX_MONTHS = 1200; // 100 years — beyond this, "not on track" is the answer

/**
 * Iterative monthly simulation (deterministic, not closed-form):
 * portfolio grows at the geometric monthly rate, then the monthly savings
 * contribution lands (end of month). Returns the FIRST month where
 * portfolio ≥ FI number (0 if already there).
 */
export function monthsToFI(
  portfolioCents: Cents,
  monthlySavingsCents: Cents,
  annualReturnBps: number,
  fiTargetCents: Cents,
): number | null {
  if (portfolioCents >= fiTargetCents) return 0;
  const i = geometricMonthlyRate(annualReturnBps);
  let p: number = portfolioCents;
  for (let m = 1; m <= MAX_MONTHS; m++) {
    p = roundHalfAwayFromZero(p * (1 + i)) + monthlySavingsCents;
    if (p >= fiTargetCents) return m;
  }
  return null;
}

export interface CoastFIResult {
  isCoastFI: boolean;
  /** Months for the current portfolio alone to reach the target (null if never). */
  monthsCompoundingAlone: number | null;
  /** If not Coast FI: level monthly contribution still required to hit the target on time. */
  requiredMonthlyContributionCents: Cents | null;
}

/**
 * Coast FI: would the current portfolio, compounding alone, reach the FI
 * number within `monthsToTarget` (e.g. months until target retirement age)?
 */
export function coastFI(
  portfolioCents: Cents,
  fiTargetCents: Cents,
  annualReturnBps: number,
  monthsToTarget: number,
): CoastFIResult {
  const alone = monthsToFI(portfolioCents, cents(0), annualReturnBps, fiTargetCents);
  const isCoastFI = alone !== null && alone <= monthsToTarget;
  let required: Cents | null = null;
  if (!isCoastFI) {
    // Binary search the level monthly contribution that reaches the target
    // exactly at monthsToTarget (same simulation, so definitions agree).
    let lo = 0;
    let hi: number = fiTargetCents; // absurd upper bound, halves quickly
    for (let iter = 0; iter < 60 && lo < hi; iter++) {
      const mid = Math.floor((lo + hi) / 2);
      const m = monthsToFI(portfolioCents, cents(mid), annualReturnBps, fiTargetCents);
      if (m !== null && m <= monthsToTarget) hi = mid;
      else lo = mid + 1;
    }
    required = cents(lo);
  }
  return { isCoastFI, monthsCompoundingAlone: alone, requiredMonthlyContributionCents: required };
}

/**
 * Future value of $X/month for N months at a NOMINAL annual rate (rate/12 per
 * month, end-of-month contributions): FV = P × ((1+i)^n − 1) / i.
 * Rounded to cents once, at the end (a single materialized result).
 */
export function opportunityFVCents(
  monthlyCents: Cents,
  months: number,
  annualRateBps: number,
): Cents {
  const i = annualRateBps / 10000 / 12;
  if (i === 0) return cents(monthlyCents * months);
  const fv = monthlyCents * ((Math.pow(1 + i, months) - 1) / i);
  return roundHalfAwayFromZero(fv);
}

/** Savings rate in bps: (income − expenses) / income. Income ≤ 0 → null. */
export function savingsRateBps(incomeCents: Cents, expensesCents: Cents): number | null {
  if (incomeCents <= 0) return null;
  return Math.round(((incomeCents - expensesCents) / incomeCents) * 10000);
}

/**
 * Savings rate ACROSS a window of months — POOLED, not the mean of monthly rates.
 *
 * A multi-month savings rate must divide summed dollars by summed dollars:
 * (Σ income − Σ expenses) / Σ income. Averaging the monthly *ratios* instead is a real
 * bug, not a rounding nicety: one month with near-zero income makes its own
 * (income − expenses)/income explode to hundreds of thousands of percent, and an
 * arithmetic mean lets that single month dominate every other. The owner's dashboard
 * showed a "4-month average of −855105.8%" from exactly this — a month whose paychecks
 * weren't categorised as income divided a normal month's spending by a few dollars.
 *
 * Only months with income > 0 contribute (matching `savingsRateBps`'s own income ≤ 0 →
 * null): a zero-income month has no ratio to pool and would otherwise add expenses with no
 * denominator. Returns null when the whole window has no income to divide by — the honest
 * "we can't compute this yet", never a fabricated giant number. Integer bps; no floats
 * survive. `months` is the count that actually contributed, for the "{n}-month" label.
 */
export function pooledSavingsRateBps(
  flows: readonly { incomeCents: Cents; expensesCents: Cents }[],
): { rateBps: number; months: number } | null {
  let totalIncome = 0;
  let totalExpenses = 0;
  let months = 0;
  for (const f of flows) {
    if (f.incomeCents <= 0) continue;
    totalIncome += f.incomeCents;
    totalExpenses += f.expensesCents;
    months += 1;
  }
  if (totalIncome <= 0) return null;
  return {
    rateBps: Math.round(((totalIncome - totalExpenses) / totalIncome) * 10000),
    months,
  };
}
