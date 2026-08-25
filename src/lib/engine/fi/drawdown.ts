/**
 * W.6(d) — Housel's "reasonable > rational": what a one-time portfolio
 * drawdown does to the FI date.
 *
 * Sibling to W.1's ±2pp *return* sensitivity on the wealth-target card, and to
 * P.1's cut counterfactual (same `monthsToFI` walk, same real rate). This shock
 * hits the *starting portfolio*, not the rate dial: a sequence illustration,
 * not a second return assumption.
 *
 * The shock is fixed at 30% (TASKS W.6(d) / COACH_PRINCIPLES_PLAN). It is an
 * illustration of a bad starting path, not a forecast — the copy that renders
 * this result says so and names the same return/inflation basis as the FI card.
 *
 * Pure: no I/O, integer cents, deterministic.
 */

import { type Cents, cents, roundHalfAwayFromZero } from '@/lib/money';
import { monthsToFI } from '@/lib/engine/fi/fi';

/** 30% drop — keep 70% of the starting portfolio. */
export const DRAWDOWN_SHOCK_BPS = 3000;

export interface DrawdownCounterfactualInput {
  portfolioCents: Cents;
  monthlySavingsCents: Cents;
  /** The rate the /coach FI walk compounds at — the REAL return, never the nominal dial. */
  realReturnBps: number;
  fiTargetCents: Cents;
  /**
   * Drop in basis points of the starting portfolio (default `DRAWDOWN_SHOCK_BPS`).
   * 3000 → keep 70%. Clamped to [0, 10000].
   */
  shockBps?: number;
}

export interface DrawdownCounterfactual {
  shockBps: number;
  baselineMonths: number | null;
  shockedMonths: number | null;
  shockedPortfolioCents: Cents;
  /**
   * How many more months FI takes after the shock. 0 when nothing moves —
   * already FI both ways, identical dates, or both unreachable. A surface must
   * say NOTHING about delay in those cases.
   *
   * Only defined when both walks produce a date (`baselineMonths` and
   * `shockedMonths` non-null). Otherwise 0 and the caller reads
   * `newlyUnreachable` / silence instead.
   */
  monthsLater: number;
  /**
   * True when the standing basis reaches FI inside the 100-year cap and the
   * shocked portfolio does not. No month delta exists for that transition.
   */
  newlyUnreachable: boolean;
}

/**
 * Apply a one-time portfolio shock and re-run the standing FI walk.
 *
 * Savings rate and FI target are unchanged — the illustration is "same plan,
 * worse starting balance", not a change in spending or the withdrawal rate.
 */
export function drawdownCounterfactual(
  input: DrawdownCounterfactualInput,
): DrawdownCounterfactual {
  const raw = input.shockBps ?? DRAWDOWN_SHOCK_BPS;
  const shockBps = Math.max(0, Math.min(10000, Math.trunc(raw)));
  const keepBps = 10000 - shockBps;
  const shockedPortfolioCents = roundHalfAwayFromZero(
    (input.portfolioCents * keepBps) / 10000,
  );

  const baselineMonths = monthsToFI(
    input.portfolioCents,
    input.monthlySavingsCents,
    input.realReturnBps,
    input.fiTargetCents,
  );
  const shockedMonths = monthsToFI(
    shockedPortfolioCents,
    input.monthlySavingsCents,
    input.realReturnBps,
    input.fiTargetCents,
  );

  const newlyUnreachable = baselineMonths !== null && shockedMonths === null;
  const monthsLater =
    baselineMonths !== null && shockedMonths !== null
      ? Math.max(0, shockedMonths - baselineMonths)
      : 0;

  return {
    shockBps,
    baselineMonths,
    shockedMonths,
    shockedPortfolioCents: cents(shockedPortfolioCents),
    monthsLater,
    newlyUnreachable,
  };
}
