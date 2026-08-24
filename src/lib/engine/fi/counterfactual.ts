/**
 * P.1 second half — the counterfactual behind "what should I cut?".
 *
 * A cut is a decision with a counterfactual (TASKS.md Wave P, row P.1): the
 * answer may not just list opportunities, it must say what MOVES if the reader
 * acts. This module re-runs the standing FI projection over the proposed change
 * — the same `monthsToFI` walk the /coach FI card prints, at the same real
 * (after-inflation) rate — and reports the delta, with an honest zero when
 * nothing moves.
 *
 * A PERMANENT cut moves the FI math twice, and both effects are computed, not
 * asserted:
 *
 *  1. The target drops. The FI number is `annualExpenses ÷ SWR` — it is built
 *     from what the reader spends, and a cut is spending that stops. At a 4%
 *     withdrawal rate every $1/mo cut is $300 less that has to be accumulated.
 *  2. The pace quickens. The freed amount is modelled as going to savings, so
 *     the monthly contribution grows by exactly the cut.
 *
 * Both effects assume the cut is permanent and the money is actually redirected
 * to savings — the copy that renders this result says so, names the assumption
 * set as the same one the /coach figures use, and carries the
 * illustration-not-advice clause (the coach guardrails).
 *
 * The rate passed in must be the reader's REAL projection rate
 * (`coach.fi.projectionReturnBps`, i.e. `realReturnBps(return, inflation)`) —
 * the W.2 unit rule: the FI walk compounds at the real rate, never the nominal
 * dial, and a counterfactual that compounded at a different rate than the
 * standing figure it claims to move would be a second definition of the basis.
 *
 * Pure: no I/O, integer cents everywhere, deterministic.
 */

import { type Cents, cents } from '@/lib/money';
import { fiNumberCents, monthsToFI } from '@/lib/engine/fi/fi';
import type { Opportunity } from '@/lib/engine/fi/insights';

export interface CutCounterfactualInput {
  portfolioCents: Cents;
  monthlySavingsCents: Cents;
  /** The trailing-spending basis the standing FI number is built from. */
  annualExpensesCents: Cents;
  /** The rate the /coach FI walk compounds at — the REAL return, never the nominal dial. */
  realReturnBps: number;
  swrBps: number;
  /** The total permanent monthly cut being evaluated (see `sumCutMonthlyCents`). */
  cutMonthlyCents: Cents;
}

export interface CutCounterfactual {
  /** Months to FI on the standing basis (null = not within the 100-year cap). */
  baselineMonths: number | null;
  /** Months to FI with the cuts applied (null = still not within the cap). */
  cutMonths: number | null;
  /**
   * How much sooner FI arrives, in whole months. 0 when nothing moves — the
   * honest null; a surface must say NOTHING about FI movement in that case,
   * never a rounded-down "about 0 months sooner".
   *
   * Never negative by construction: a cut only lowers the target and raises
   * the savings rate, and `monthsToFI` is monotonic in both, so a cut cannot
   * delay FI. The `max(0, …)` is a floor against rounding, not a clamp hiding
   * a regression.
   */
  monthsSooner: number;
  /**
   * True when the cuts make FI reachable inside the 100-year cap and the
   * standing basis was not. No month delta exists for that transition (the
   * baseline has no date), so it is its own fact, not a `monthsSooner`.
   */
  newlyReachable: boolean;
  baselineFiTargetCents: Cents;
  cutFiTargetCents: Cents;
  /** How much less has to be accumulated (baseline target − cut target). ≥ 0. */
  targetDropCents: Cents;
}

export function cutCounterfactual(input: CutCounterfactualInput): CutCounterfactual {
  const baselineFiTargetCents = fiNumberCents(input.annualExpensesCents, input.swrBps);
  // The cut is spending that STOPS, so it leaves the expense basis the target
  // is built from. Floored at 0 — a cut larger than the whole basis is a
  // $0-spending world, never a negative FI number.
  const cutAnnualExpensesCents = cents(
    Math.max(0, input.annualExpensesCents - 12 * input.cutMonthlyCents),
  );
  const cutFiTargetCents = fiNumberCents(cutAnnualExpensesCents, input.swrBps);
  const cutMonthlySavingsCents = cents(input.monthlySavingsCents + input.cutMonthlyCents);

  const baselineMonths = monthsToFI(
    input.portfolioCents,
    input.monthlySavingsCents,
    input.realReturnBps,
    baselineFiTargetCents,
  );
  const cutMonths = monthsToFI(
    input.portfolioCents,
    cutMonthlySavingsCents,
    input.realReturnBps,
    cutFiTargetCents,
  );

  const newlyReachable = baselineMonths === null && cutMonths !== null;
  const monthsSooner =
    baselineMonths !== null && cutMonths !== null
      ? Math.max(0, baselineMonths - cutMonths)
      : 0;

  return {
    baselineMonths,
    cutMonths,
    monthsSooner,
    newlyReachable,
    baselineFiTargetCents,
    cutFiTargetCents,
    targetDropCents: cents(baselineFiTargetCents - cutFiTargetCents),
  };
}

/**
 * Per-merchant monthly cut (largest row wins).
 *
 * One merchant can produce two rows — a subscription whose price rose AND that
 * looks unused — and cancelling it saves the full amount ONCE. Summing both
 * rows would count the price-increase delta on top of the full amount, i.e.
 * promise money no action frees. The radar re-walk consumes this same map so
 * the FI sentence and the cash-flow sentence cannot disagree about how much
 * of a merchant is being cut.
 *
 * Estimate rows (`isEstimate` — the ~15% insurance re-shop, the flat $20
 * retention offer) are included: they are the agreed standing answer to "what
 * should I cut", and the copy that renders a total including them names the
 * estimates as estimates.
 */
export function cutByMerchant(opportunities: readonly Opportunity[]): Map<string, Cents> {
  const byMerchant = new Map<string, Cents>();
  for (const o of opportunities) {
    const prev = byMerchant.get(o.merchant) ?? 0;
    if (o.monthlyCents > prev) byMerchant.set(o.merchant, o.monthlyCents);
  }
  return byMerchant;
}

/** The total monthly cut a LIST of opportunities adds up to. See `cutByMerchant`. */
export function sumCutMonthlyCents(opportunities: readonly Opportunity[]): Cents {
  let total = 0;
  for (const monthly of cutByMerchant(opportunities).values()) total += monthly;
  return cents(total);
}
