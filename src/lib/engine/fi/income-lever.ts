/**
 * P1.4 — income lever: a hypothetical raise, saved at the current rate,
 * re-run through the same `monthsToFI` walk as the FI card.
 *
 * Mirrors the savings-rate slider (same target, same real return, different
 * monthly savings) on the *income* side. The raise increment is saved at the
 * current pooled pace; the FI number is NOT restated from a bigger lifestyle.
 * That assumption is load-bearing and the copy that renders this result
 * names it.
 *
 * A non-positive savings rate saves $0 of the raise — dissaving is not
 * applied as a negative extra (that would invent a lifestyle inflation the
 * reader did not choose). No income → no rate → extra $0.
 *
 * Pure: no I/O, integer cents, deterministic.
 */

import { type Cents, cents, roundHalfAwayFromZero } from '@/lib/money';
import { monthsToFI, savingsRateBps } from '@/lib/engine/fi/fi';

/** Default thumb: a $10,000/yr raise — a concrete negotiation increment. */
export const INCOME_LEVER_DEFAULT_RAISE_CENTS = 1_000_000;

/** Slider step: $1,000/yr. */
export const INCOME_LEVER_STEP_CENTS = 100_000;

/** Floor on the slider ceiling so a low-income reader can still illustrate. */
export const INCOME_LEVER_MIN_MAX_CENTS = 2_500_000;

/** Cap so the range input stays usable. */
export const INCOME_LEVER_CAP_CENTS = 10_000_000;

export interface IncomeLeverInput {
  portfolioCents: Cents;
  monthlySavingsCents: Cents;
  monthlyIncomeCents: Cents;
  /** The rate the /coach FI walk compounds at — the REAL return, never the nominal dial. */
  realReturnBps: number;
  fiTargetCents: Cents;
  /** Hypothetical annual raise in cents. Clamped to ≥ 0. */
  raiseAnnualCents: Cents | number;
}

export interface IncomeLever {
  raiseAnnualCents: Cents;
  monthlyRaiseCents: Cents;
  /** Current pace; null when there is no income to divide by. */
  rateBps: number | null;
  extraMonthlySavingsCents: Cents;
  raisedMonthlySavingsCents: Cents;
  baselineMonths: number | null;
  raisedMonths: number | null;
  /**
   * How many fewer months FI takes after the raise. 0 when nothing moves —
   * already FI, identical dates, no extra savings, or both unreachable.
   * Only defined when both walks produce a date. A newly-reachable date
   * is reported via `newlyReachable`, not a fabricated "sooner".
   */
  monthsSooner: number;
  /** Baseline sits past the 100-year cap; the raise produces a date. */
  newlyReachable: boolean;
  /** No income on file — a rate cannot be computed. */
  noIncome: boolean;
  /** Rate ≤ 0, so none of the raise is treated as saved. */
  rateNonPositive: boolean;
  /** Baseline is already 0 — they are at the FI number on file. */
  alreadyThere: boolean;
}

/**
 * Inclusive slider ceiling: at least $25k/yr, at least half of current
 * annual income, never above $100k/yr.
 */
export function incomeLeverSliderMaxCents(monthlyIncomeCents: number): number {
  const annual = Math.max(0, Math.trunc(monthlyIncomeCents) * 12);
  const half = Math.trunc(annual / 2);
  return Math.min(INCOME_LEVER_CAP_CENTS, Math.max(INCOME_LEVER_MIN_MAX_CENTS, half));
}

/** Initial thumb: the $10k default, never above the ceiling. */
export function incomeLeverSliderInitialCents(monthlyIncomeCents: number): number {
  return Math.min(
    INCOME_LEVER_DEFAULT_RAISE_CENTS,
    incomeLeverSliderMaxCents(monthlyIncomeCents),
  );
}

/**
 * Apply a hypothetical annual raise at the current savings rate and re-run
 * the standing FI walk. Target and portfolio stay put.
 */
export function incomeLever(input: IncomeLeverInput): IncomeLever {
  const raiseAnnualCents = cents(Math.max(0, Math.trunc(input.raiseAnnualCents)));
  const monthlyRaiseCents = roundHalfAwayFromZero(raiseAnnualCents / 12);

  const baselineMonths = monthsToFI(
    input.portfolioCents,
    input.monthlySavingsCents,
    input.realReturnBps,
    input.fiTargetCents,
  );
  const alreadyThere = baselineMonths === 0;

  if (input.monthlyIncomeCents <= 0) {
    return {
      raiseAnnualCents,
      monthlyRaiseCents,
      rateBps: null,
      extraMonthlySavingsCents: cents(0),
      raisedMonthlySavingsCents: input.monthlySavingsCents,
      baselineMonths,
      raisedMonths: baselineMonths,
      monthsSooner: 0,
      newlyReachable: false,
      noIncome: true,
      rateNonPositive: false,
      alreadyThere,
    };
  }

  const impliedExpenses = cents(input.monthlyIncomeCents - input.monthlySavingsCents);
  const rateBps = savingsRateBps(input.monthlyIncomeCents, impliedExpenses);
  // income > 0 ⇒ savingsRateBps is a number. The null branch is the noIncome path above.
  const rate = rateBps ?? 0;
  const rateNonPositive = rate <= 0;

  const extraMonthlySavingsCents = rateNonPositive
    ? cents(0)
    : roundHalfAwayFromZero((monthlyRaiseCents * rate) / 10000);
  const raisedMonthlySavingsCents = cents(
    input.monthlySavingsCents + extraMonthlySavingsCents,
  );

  const raisedMonths = monthsToFI(
    input.portfolioCents,
    raisedMonthlySavingsCents,
    input.realReturnBps,
    input.fiTargetCents,
  );

  const newlyReachable = baselineMonths === null && raisedMonths !== null;
  const monthsSooner =
    baselineMonths !== null && raisedMonths !== null
      ? Math.max(0, baselineMonths - raisedMonths)
      : 0;

  return {
    raiseAnnualCents,
    monthlyRaiseCents,
    rateBps: rate,
    extraMonthlySavingsCents,
    raisedMonthlySavingsCents,
    baselineMonths,
    raisedMonths,
    monthsSooner,
    newlyReachable,
    noIncome: false,
    rateNonPositive,
    alreadyThere,
  };
}
