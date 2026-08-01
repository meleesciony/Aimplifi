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
 *
 * FUTURE dollars. No surface prints this directly (W.10): /coach's opportunity list, the only
 * consumer there has ever been, prints `opportunityValueTodayCents` instead. It stays exported
 * because it is the primitive that function is built from and because the EDGE_CASES anchors
 * pin it — a new caller has to decide, in the open, which of the two it wants.
 */
export function opportunityFVCents(
  monthlyCents: Cents,
  months: number,
  annualRateBps: number,
): Cents {
  return roundHalfAwayFromZero(fvAnnuityUnrounded(monthlyCents, months, annualRateBps));
}

/** Unrounded, so a composed figure materializes cents exactly once (money rule 3). */
function fvAnnuityUnrounded(monthlyCents: number, months: number, annualRateBps: number): number {
  const i = annualRateBps / 10000 / 12;
  if (i === 0) return monthlyCents * months;
  return monthlyCents * ((Math.pow(1 + i, months) - 1) / i);
}

/**
 * What $X/month invested for N months is worth **in today's money**: the nominal annuity
 * above, divided by `(1 + inflation)^years`.
 *
 * W.10. The contribution stream modelled here is LEVEL IN NOMINAL DOLLARS — the reader frees
 * up $X a month and invests that same $X every month, never raising it. That is the literal
 * thing the sentence beside these figures describes, and it is deliberately NOT the same
 * convention as the FI card's monthly figures, which are level in today's dollars.
 *
 * Compounding at the real rate instead — which is what level-in-today's-dollars means — was
 * the first implementation, and two independent critics killed it on the same row: a
 * `negotiable-bill` opportunity is a hard-coded flat $20/mo retention offer (`insights.ts`),
 * so the justification for indexing it ("the price would have risen anyway") is a claim about
 * a price where there is no price. It printed 30.6% more than a reader investing a flat $20
 * will ever have. One convention that is conservative for every row beats two conventions with
 * a per-row argument about which applies.
 *
 * Inflation is clamped at 0 the way `realReturnBps` clamps it, so a negative dial cannot
 * INFLATE the answer above its own nominal future value. There is no clamp on the result: when
 * inflation outruns the return assumption this is legitimately less than the dollars paid in,
 * and the copy says so rather than flooring it into a reassuring number.
 */
export function opportunityValueTodayCents(
  monthlyCents: Cents,
  months: number,
  nominalRateBps: number,
  inflationBps: number,
): Cents {
  const fv = fvAnnuityUnrounded(monthlyCents, months, nominalRateBps);
  const deflator = Math.pow(1 + Math.max(0, inflationBps) / 10000, months / 12);
  return roundHalfAwayFromZero(fv / deflator);
}

/** The horizons the opportunity list prints, in the order it prints them. One author, so the
 *  sentence describing the figures cannot describe a different set of horizons than the rows
 *  show. */
export const OPPORTUNITY_HORIZON_MONTHS = [120, 240, 360] as const;

/**
 * Whether the today's-money value at this horizon lands BELOW the dollars the reader would
 * hand over — inflation taking more than the growth adds.
 *
 * Computed, not inferred from the dials. The first version of the sentence that needs this
 * fired on `inflationBps >= nominalReturnBps`, which sounds like the same thing and is not: a
 * sweep of every pair `validateDials` permits (return 0–15.00%, inflation 0–10.00%, 25bps
 * steps) found **1,579 horizon-cases** where inflation is strictly BELOW the return assumption
 * and the figure still trails the contributions — 10.25% against 10.00% trails by 62% at 30
 * years. The annuity's dollars are each invested for less than the full horizon while the
 * deflator runs the whole of it, so the break-even sits well above equal dials.
 *
 * Amount-independent: the annuity is linear in `monthlyCents` and the deflator does not touch
 * it, so the ratio is a function of (months, rates) alone and the probe below stands in for
 * every row. It is large enough that a half-cent of rounding cannot flip the comparison.
 */
export function opportunityValueTrailsContributions(
  months: number,
  nominalRateBps: number,
  inflationBps: number,
): boolean {
  const probe = cents(100_000);
  return opportunityValueTodayCents(probe, months, nominalRateBps, inflationBps) < probe * months;
}

/**
 * Whether ANY figure an opportunity row prints lands at or below the dollars the reader would
 * hand over across the same months.
 *
 * W.10a critic. The sibling above answers the same question for the LIST, from the dials. This
 * one answers it for one ROW, and deliberately reads the values that row will actually print
 * rather than re-deriving them: the sentence it gates enumerates those three figures, so the
 * claim has to be true of the numbers in the string, not of a recomputation that could be
 * handed a different rate pair than the one the row was built with.
 *
 * `<=`, not `<`, for the reason the list sentence says "at or below": the values are integer
 * cents and a figure trailing by a fraction of a cent prints as exactly what was paid in, where
 * a claim that compounding added something is still false.
 *
 * Any, not all: the row prints all three horizons in one sentence, so one trailing figure is
 * enough to falsify a payoff clause about the set. At 7.00% return against a 4.00% inflation
 * dial — both inside `validateDials` — the 10- and 20-year figures trail and the 30-year one
 * does not.
 */
export function opportunityRowTrailsContributions(row: {
  monthlyCents: number;
  todayValue10Cents: number;
  todayValue20Cents: number;
  todayValue30Cents: number;
}): boolean {
  const [m10, m20, m30] = OPPORTUNITY_HORIZON_MONTHS;
  return (
    row.todayValue10Cents <= row.monthlyCents * m10 ||
    row.todayValue20Cents <= row.monthlyCents * m20 ||
    row.todayValue30Cents <= row.monthlyCents * m30
  );
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
