/**
 * Expected-net-worth lens (Stanley & Danko / COACH_PRINCIPLES_PLAN C12).
 *
 * expected = age × yearly income ÷ 10.
 * Yearly income is an input — the caller must pass the same annualization
 * the FI card uses (average monthly income over the last N complete months
 * × 12). This module does not invent income or age.
 *
 * Age 0 / unset is idle: no expected figure, no band. Income ≤ 0 is
 * noIncome: no expected figure even with an age. Unknown is not 0%.
 *
 * Bands are above / near / under the expected number (10% inclusive =
 * near). Not PAW/UAW labels — those grade people.
 *
 * Pure: no I/O, integer cents, deterministic.
 */

import { type Cents, cents, roundHalfAwayFromZero } from '@/lib/money';

export const PAW_AGE_MIN = 0;
export const PAW_AGE_MAX = 90;
/** Inclusive "near" band: |actual − expected| / expected ≤ 10%. */
export const PAW_NEAR_BPS = 1000;

export type PawBand = 'above' | 'near' | 'under';

export interface PawLensInput {
  ageYears: number;
  annualIncomeCents: Cents | number;
  netWorthCents: Cents | number;
  /** Complete months the yearly income was averaged from. Named in copy. */
  incomeWindowMonths: number;
}

export interface PawLens {
  ageYears: number;
  annualIncomeCents: Cents;
  incomeWindowMonths: number;
  netWorthCents: Cents;
  /** Null when idle or no income — a $0 expected from a missing input is a fabrication. */
  expectedNetWorthCents: Cents | null;
  /** Null when there is no expected number, or the expected rounds to $0.00. */
  band: PawBand | null;
  idle: boolean;
  noIncome: boolean;
}

/** Same annualization the income-lever slider uses: monthly × 12. */
export function annualIncomeFromMonthly(monthlyIncomeCents: number): Cents {
  return cents(Math.max(0, Math.trunc(monthlyIncomeCents)) * 12);
}

export function normalizePawAge(ageYears: number): number {
  if (!Number.isFinite(ageYears)) return 0;
  return Math.max(PAW_AGE_MIN, Math.min(PAW_AGE_MAX, Math.trunc(ageYears)));
}

/**
 * Compare actual net worth to expected. `expectedCents <= 0` is not a
 * denominator — return null rather than inventing "above $0.00".
 */
export function pawBand(actualCents: number, expectedCents: number): PawBand | null {
  if (expectedCents <= 0) return null;
  const delta = Math.abs(actualCents - expectedCents);
  if (delta * 10000 <= expectedCents * PAW_NEAR_BPS) return 'near';
  return actualCents > expectedCents ? 'above' : 'under';
}

export function pawLens(input: PawLensInput): PawLens {
  const ageYears = normalizePawAge(input.ageYears);
  const annualIncomeCents = cents(Math.max(0, Math.trunc(Number(input.annualIncomeCents))));
  const netWorthCents = cents(Math.trunc(Number(input.netWorthCents)));
  const incomeWindowMonths = Math.max(0, Math.trunc(input.incomeWindowMonths));
  const noIncome = annualIncomeCents <= 0;
  const idle = ageYears <= 0;

  if (noIncome || idle) {
    return {
      ageYears,
      annualIncomeCents,
      incomeWindowMonths,
      netWorthCents,
      expectedNetWorthCents: null,
      band: null,
      idle,
      noIncome,
    };
  }

  const expectedNetWorthCents = roundHalfAwayFromZero((ageYears * annualIncomeCents) / 10);
  return {
    ageYears,
    annualIncomeCents,
    incomeWindowMonths,
    netWorthCents,
    expectedNetWorthCents,
    band: pawBand(netWorthCents, expectedNetWorthCents),
    idle: false,
    noIncome: false,
  };
}
