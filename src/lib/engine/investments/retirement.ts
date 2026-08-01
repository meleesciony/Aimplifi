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

/**
 * The grounded financial figures the projection rests on (the user's real data,
 * surfaced by /coach). Already floored at 0 by the caller — kept as plain numbers
 * so this builder is pure and reusable on both the server and the client what-if.
 */
export interface RetirementBaseInputs {
  currentPortfolioCents: number;
  monthlyContributionCents: number;
  annualRetirementSpendingCents: number;
  /** The user's NOMINAL expected-return dial, in bps. */
  nominalReturnBps: number;
  swrBps: number;
}

/** The planning ASSUMPTIONS the user can edit (DECISIONS #123) — ages + inflation. */
export interface RetirementPlanningInputs {
  currentAge: number;
  retirementAge: number;
  endAge: number;
  inflationBps: number;
}

/**
 * The REAL (after-inflation) return fed to the engine so the projection is in
 * today's dollars (the engine's documented inflation convention). Floored at 0 —
 * the engine rejects a negative return, and a sub-inflation nominal return is
 * treated as no real growth. The single definition shared by every caller.
 *
 * BOTH ends are clamped. The outer `Math.max` was always here; the inner one closes a
 * hole a W.2 critic found by execution: a NEGATIVE `inflationBps` made the subtraction
 * ADD, so the real rate came out ABOVE the reader's own nominal dial (`-250` → 9.50% off
 * a 7.00% assumption) and `isRealReturnFloored` said nothing was clamped, so the card
 * would print "grown at 9.50% — your 7.00% return assumption less your -2.50% inflation
 * assumption": a projection more optimistic than the dial it claims to derive from, on a
 * card whose entire thesis is the opposite. `validateDials` bounds inflation to [0, 1000]
 * and is the only writer today, but `User.inflationBps` carries no DB constraint, so a
 * seed, a direct write, or a second writer reaches it — and this engine is shared by
 * /coach, /investments, the assistant and the wealth planner. One clamp here is cheaper
 * than trusting four callers and every future fifth.
 */
export function realReturnBps(nominalReturnBps: number, inflationBps: number): number {
  return Math.max(0, nominalReturnBps - Math.max(0, inflationBps));
}

/**
 * Whether `realReturnBps()` returned its FLOOR rather than the subtraction — i.e. the
 * nominal assumption is at or below the inflation assumption.
 *
 * Extracted (W.2) because two cards on /coach now print a basis sentence off this same
 * fact, and the floored branch is the one that may NOT show its working: 7.00% less
 * 10.00% is not 0.00%, and a reader can do that arithmetic in their head
 * (`the-arithmetic-was-never-the-risk`, rule "a clamped output may not print its
 * inputs"). Two hand-written copies of `nominal - inflation <= 0` is exactly how the two
 * cards would come to disagree about whether the reader is being shown a clamp.
 *
 * Note the boundary is `<= 0`, not `< 0`: an exactly-equal pair yields 0 bps of real
 * growth from the subtraction itself, and a sentence offering to show that working would
 * print "7.00% less 7.00%" beside a projection that never grows — true arithmetic, but it
 * reads as a rounding artifact rather than the standstill it actually is.
 *
 * Mirrors `realReturnBps`'s inner clamp so the pair cannot disagree: without it, a
 * negative inflation row would report "not floored" about a rate that had been clamped.
 */
export function isRealReturnFloored(nominalReturnBps: number, inflationBps: number): boolean {
  return nominalReturnBps - Math.max(0, inflationBps) <= 0;
}

/**
 * Assemble `RetirementInputs` from the grounded financial figures + the planning
 * assumptions. ONE builder used by both `getRetirementOutlook` (server) and the
 * client-side what-if, so the explorer at the saved values is byte-identical to the
 * server projection by construction — it cannot drift. Financial figures are floored
 * at 0; the real return is derived once via `realReturnBps`.
 */
export function buildRetirementInputs(
  base: RetirementBaseInputs,
  planning: RetirementPlanningInputs,
): RetirementInputs {
  return {
    currentPortfolioCents: cents(Math.max(0, base.currentPortfolioCents)),
    currentAge: planning.currentAge,
    retirementAge: planning.retirementAge,
    endAge: planning.endAge,
    monthlyContributionCents: cents(Math.max(0, base.monthlyContributionCents)),
    annualRetirementSpendingCents: cents(Math.max(0, base.annualRetirementSpendingCents)),
    annualReturnBps: realReturnBps(base.nominalReturnBps, planning.inflationBps),
    swrBps: base.swrBps,
  };
}

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
