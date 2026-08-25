/**
 * P1.5 — fee-drag illustration: 1% of TODAY's invested balance, every year
 * for 30 years, as a LEVEL monthly leak, grown with the same opportunity
 * primitive the /coach list uses.
 *
 * This is NOT a 1% AUM fee on a growing pile (that would be FV(r) − FV(r−1%)).
 * It is NOT their actual expense ratio (we do not collect one). The copy that
 * renders this result says both.
 *
 * Why `opportunityValueTodayCents`, not `opportunityFVCents` on the printed
 * figure: W.10. The plan's 2026-07 sketch named the annuity FV; /coach prints
 * today's money. The annuity primitive is still called — today's-money is
 * built from it — and `costNominalCents` is exposed so the reuse is pinned.
 *
 * Pure: no I/O, integer cents, deterministic.
 */

import { type Cents, cents, roundHalfAwayFromZero } from '@/lib/money';
import {
  OPPORTUNITY_HORIZON_MONTHS,
  opportunityFVCents,
  opportunityValueTodayCents,
} from '@/lib/engine/fi/fi';

/** 1% yearly leak of today's balance — the Collins/Sethi illustration. */
export const FEE_DRAG_BPS = 100;

/** Same 30-year horizon the opportunity list prints. One author. */
export const FEE_DRAG_MONTHS = OPPORTUNITY_HORIZON_MONTHS[2];

export interface FeeDragInput {
  portfolioCents: Cents;
  /** The reader's NOMINAL return dial — same unit `opportunityFVCents` takes. */
  nominalReturnBps: number;
  inflationBps: number;
  /** Default `FEE_DRAG_BPS`. Clamped to ≥ 0. */
  feeBps?: number;
  /** Default `FEE_DRAG_MONTHS`. Clamped to ≥ 0. */
  months?: number;
}

export interface FeeDrag {
  portfolioCents: Cents;
  monthlyLeakCents: Cents;
  feeBps: number;
  months: number;
  nominalReturnBps: number;
  inflationBps: number;
  /** Today's-money cost of the level leak — what /coach prints. */
  costTodayCents: Cents;
  /** Nominal FV of the leak (`opportunityFVCents`). Pinned, not printed. */
  costNominalCents: Cents;
}

/**
 * 1% of today's invested balance, leaked every year as a level monthly
 * contribution, grown at the nominal dial and deflated at inflation.
 *
 * Null when there is nothing to leak (no portfolio, no fee, no horizon, or
 * the monthly leak rounds to $0.00).
 */
export function feeDrag(input: FeeDragInput): FeeDrag | null {
  const portfolioCents = cents(Math.max(0, Math.trunc(input.portfolioCents)));
  const feeBps = Math.max(0, Math.trunc(input.feeBps ?? FEE_DRAG_BPS));
  const months = Math.max(0, Math.trunc(input.months ?? FEE_DRAG_MONTHS));
  if (portfolioCents <= 0 || feeBps <= 0 || months <= 0) return null;

  const monthlyLeakCents = roundHalfAwayFromZero(
    (portfolioCents * feeBps) / 10000 / 12,
  );
  if (monthlyLeakCents <= 0) return null;

  return {
    portfolioCents,
    monthlyLeakCents,
    feeBps,
    months,
    nominalReturnBps: input.nominalReturnBps,
    inflationBps: input.inflationBps,
    costNominalCents: opportunityFVCents(
      monthlyLeakCents,
      months,
      input.nominalReturnBps,
    ),
    costTodayCents: opportunityValueTodayCents(
      monthlyLeakCents,
      months,
      input.nominalReturnBps,
      input.inflationBps,
    ),
  };
}
