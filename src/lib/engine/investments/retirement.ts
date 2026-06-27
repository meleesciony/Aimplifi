/**
 * Retirement-projection engine — pure decumulation/accumulation simulation (DECISIONS #122).
 *
 * The investments engine (#77) values a portfolio and measures its return; the FI
 * engine (#3) answers "how long until I CAN retire" (accumulation to an FI number).
 * Neither answers the retiree's actual question: "I want to spend $X/year — will my
 * money LAST, and if not, when do I run out?" That decumulation/"will it last" lens
 * is the declared investments gap (a clear Simplifi win) this engine closes.
 *
 * Model: a deterministic month-by-month simulation in two phases —
 *  - ACCUMULATION (currentAge → retirementAge): the portfolio grows at the GEOMETRIC
 *    monthly rate, then a level monthly contribution lands (end of month).
 *  - DECUMULATION (retirementAge → endAge): the portfolio grows at the same geometric
 *    monthly rate, then a level monthly withdrawal is taken (end of month). The
 *    balance floors at zero; the first month it reaches zero is the depletion point.
 * This reuses `geometricMonthlyRate` (#3) — one compounding convention, not a second.
 *
 * Pure + deterministic: integer cents in, no I/O, no `new Date()`. Money is rounded
 * ONCE per month, half away from zero (the money.ts discipline). Returns are integer
 * cents; ages are integer years in, fractional out (depletion can land mid-year).
 *
 * Assumptions (stated so every projection carries them — the coaching guardrail):
 *  - Withdrawals and contributions are LEVEL NOMINAL amounts (no annual step-up).
 *    To model inflation, pass `annualReturnBps` as a REAL (after-inflation) return and
 *    read the dollars as today's dollars — no separate inflation knob is invented.
 *  - End-of-month cash flows (the ordinary-annuity convention, matching the FI engine).
 *  - One blended return rate across both phases (no glide path).
 */

import { geometricMonthlyRate } from '@/lib/engine/fi/fi';
import { type Cents, cents, roundHalfAwayFromZero } from '@/lib/money';

export interface RetirementInputs {
  /** Portfolio value today (≥ 0). */
  currentPortfolioCents: Cents;
  /** Whole-year ages: 0 ≤ currentAge ≤ retirementAge ≤ endAge ≤ 120, endAge > currentAge. */
  currentAge: number;
  retirementAge: number;
  endAge: number;
  /** Level monthly contribution during accumulation (≥ 0). */
  monthlyContributionCents: Cents;
  /** Level annual spending withdrawn during retirement, nominal (≥ 0). */
  annualRetirementSpendingCents: Cents;
  /** Blended annual return in basis points (≥ 0). 700 = 7%. */
  annualReturnBps: number;
  /** Safe withdrawal rate in bps (> 0), for the sustainable-withdrawal reference. */
  swrBps: number;
}

export interface RetirementYearPoint {
  age: number;
  balanceCents: Cents;
}

export interface RetirementProjection {
  /** Portfolio value at the moment of retirement (end of accumulation). */
  balanceAtRetirementCents: Cents;
  /** Portfolio value at endAge (0 if it depleted earlier). */
  endBalanceCents: Cents;
  /** 'sustained' = money lasted to endAge; 'depleted' = it hit zero first. */
  outcome: 'sustained' | 'depleted';
  /** Fractional age the portfolio first hit zero, or null if it never did. */
  depletionAge: number | null;
  /** swrBps applied to the balance at retirement — a sustainable level for reference. */
  sustainableAnnualWithdrawalCents: Cents;
  /**
   * Echo of the planned annual spend (the input), so the UI can show planned-vs-sustainable.
   * The simulation withdraws round(annual/12) each month, so the modeled annual draw can differ
   * by a few cents from this figure (e.g. $10,000 → 12 × $833.33 = $9,999.96); immaterial.
   */
  plannedAnnualWithdrawalCents: Cents;
  /** Balance at each whole-year boundary, currentAge … endAge inclusive (for charting). */
  yearlyBalances: readonly RetirementYearPoint[];
}

const MAX_AGE = 120;

/**
 * Default planning assumptions used when no birthdate/inflation preference is on file.
 * STATED assumptions the UI surfaces inline (the coaching guardrail), not fabricated facts
 * — everything else the planner uses is the user's real data. `inflationBps` lets the
 * server feed the engine a REAL (after-inflation) return so the projection is in today's
 * dollars (see the engine docstring), rather than overstating future nominal balances.
 * Lives here (a pure module) rather than the 'use server' layer, which may only export
 * async functions.
 */
export const RETIREMENT_ASSUMPTIONS = {
  currentAge: 40,
  retirementAge: 65,
  endAge: 95,
  inflationBps: 250, // ~2.5%/yr long-run assumption; used to derive the real return
} as const;

function assertSafe(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`projectRetirement: ${label} ${value} exceeds safe-integer range`);
  }
}

/** One month of growth at rate i, rounded once. Fails loud (engine-specific message) on overflow. */
function growOneMonth(p: number, i: number): Cents {
  const raw = p * (1 + i);
  assertSafe(Math.round(Math.abs(raw)), 'grown balance'); // fires before cents() would, with our message
  return roundHalfAwayFromZero(raw);
}

/**
 * Project a portfolio through accumulation and retirement, detecting depletion.
 * Throws on out-of-range inputs (single clear error, fail-loud).
 */
export function projectRetirement(input: RetirementInputs): RetirementProjection {
  const {
    currentPortfolioCents,
    currentAge,
    retirementAge,
    endAge,
    monthlyContributionCents,
    annualRetirementSpendingCents,
    annualReturnBps,
    swrBps,
  } = input;

  if (
    !Number.isInteger(currentAge) ||
    !Number.isInteger(retirementAge) ||
    !Number.isInteger(endAge)
  ) {
    throw new Error('projectRetirement: ages must be whole years');
  }
  if (
    currentAge < 0 ||
    endAge > MAX_AGE ||
    !(currentAge <= retirementAge && retirementAge <= endAge && currentAge < endAge)
  ) {
    throw new Error('projectRetirement: require 0 ≤ currentAge ≤ retirementAge ≤ endAge ≤ 120 and endAge > currentAge');
  }
  if (currentPortfolioCents < 0) throw new Error('projectRetirement: portfolio cannot be negative');
  if (monthlyContributionCents < 0) throw new Error('projectRetirement: contribution cannot be negative');
  if (annualRetirementSpendingCents < 0) throw new Error('projectRetirement: spending cannot be negative');
  if (annualReturnBps < 0) throw new Error('projectRetirement: return cannot be negative');
  if (swrBps <= 0) throw new Error('projectRetirement: swrBps must be positive');

  const i = geometricMonthlyRate(annualReturnBps);
  const accumMonths = (retirementAge - currentAge) * 12;
  const totalMonths = (endAge - currentAge) * 12;
  // Level monthly withdrawal, rounded once (1/12 of the annual spend).
  const monthlyWithdrawalCents = roundHalfAwayFromZero(annualRetirementSpendingCents / 12);

  let p: number = currentPortfolioCents;
  // accumMonths is always a multiple of 12 (integer ages), so retirement lands on a
  // year boundary; seed the at-retirement value for the retire-now (accumMonths === 0) case.
  let balanceAtRetirementCents: number = currentPortfolioCents;
  let depletionMonth: number | null = null;

  const yearlyBalances: RetirementYearPoint[] = [{ age: currentAge, balanceCents: cents(p) }];

  for (let m = 1; m <= totalMonths; m++) {
    const grown = growOneMonth(p, i);
    if (m <= accumMonths) {
      p = grown + monthlyContributionCents;
    } else if (depletionMonth === null) {
      p = grown - monthlyWithdrawalCents;
      if (p <= 0) {
        depletionMonth = m;
        p = 0;
      }
    } else {
      p = 0; // stay depleted; no negative balances, no phantom growth on zero
    }
    assertSafe(p, 'balance');

    if (m === accumMonths) balanceAtRetirementCents = p;
    if (m % 12 === 0) yearlyBalances.push({ age: currentAge + m / 12, balanceCents: cents(p) });
  }

  const sustainableAnnualWithdrawalCents = roundHalfAwayFromZero(
    (balanceAtRetirementCents * swrBps) / 10000,
  );

  return {
    balanceAtRetirementCents: cents(balanceAtRetirementCents),
    endBalanceCents: cents(p),
    outcome: depletionMonth === null ? 'sustained' : 'depleted',
    depletionAge: depletionMonth === null ? null : currentAge + depletionMonth / 12,
    sustainableAnnualWithdrawalCents,
    plannedAnnualWithdrawalCents: annualRetirementSpendingCents,
    yearlyBalances,
  };
}
