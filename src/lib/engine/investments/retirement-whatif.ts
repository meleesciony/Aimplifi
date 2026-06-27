/**
 * Retirement what-if reducers (DECISIONS #123) — the pure, deterministic logic behind the
 * interactive explorer on /investments. Extracted from the React island so the safety-
 * critical invariant it maintains is unit-testable without a DOM:
 *
 *   for EVERY sequence of user edits, the resulting plan satisfies the engine invariant
 *   currentAge ≤ retirementAge < endAge ≤ 120 (all whole years) and inflation ∈ [0,10%],
 *   so `projectRetirement` can never throw and the displayed inputs always equal the
 *   values that are projected.
 *
 * Bounds come from DIAL_LIMITS (the SAME source the Settings validator uses), so the
 * explorer can only preview a plan the user could also save. Inflation parses through the
 * exact string parser `bpsFromPercentString` (no float arithmetic), matching the rest of
 * the rate-handling code.
 */
import { DIAL_LIMITS, bpsFromPercentString } from '@/lib/engine/settings/dials';

export interface WhatIfPlan {
  retirementAge: number;
  endAge: number;
  inflationBps: number;
}

/** Round to the nearest integer and clamp into [lo, hi]; non-finite (e.g. a cleared field) snaps to lo. */
export function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(Number.isFinite(n) ? n : lo)));
}

/** The retirement-age range for the explorer: floored at the user's current age. */
export function retireRange(currentAge: number): { min: number; max: number } {
  return { min: currentAge, max: DIAL_LIMITS.retirementAge.max };
}

/** The plan-through-age range: must be at least one year after retirement. */
export function endRange(retirementAge: number): { min: number; max: number } {
  return { min: retirementAge + 1, max: DIAL_LIMITS.endAge.max };
}

/**
 * Set the retirement age, keeping the plan valid: clamp into [currentAge, max] and bump the
 * end age up if it would no longer be strictly after retirement. currentAge ≤ 100 and
 * retirementAge.max = 110, so end's floor (retire+1) ≤ 111 ≤ endAge.max (120) — the clamp
 * ranges are always well-formed (lo ≤ hi).
 */
export function setRetirement(plan: WhatIfPlan, currentAge: number, rawRetire: number): WhatIfPlan {
  const r = retireRange(currentAge);
  const retirementAge = clampInt(rawRetire, r.min, r.max);
  const e = endRange(retirementAge);
  const endAge = clampInt(Math.max(plan.endAge, e.min), e.min, e.max);
  return { ...plan, retirementAge, endAge };
}

/** Set the plan-through age, clamped to at least one year after the current retirement age. */
export function setEnd(plan: WhatIfPlan, rawEnd: number): WhatIfPlan {
  const e = endRange(plan.retirementAge);
  return { ...plan, endAge: clampInt(rawEnd, e.min, e.max) };
}

/**
 * Set inflation from a percent string ("2.5"). Parses exactly via bpsFromPercentString;
 * an out-of-grammar value (empty, >2 decimals, non-numeric) leaves the plan unchanged so a
 * mid-typing keystroke never corrupts the projection.
 */
export function setInflationPercent(plan: WhatIfPlan, rawPercent: string): WhatIfPlan {
  const bps = bpsFromPercentString(rawPercent);
  if (bps === null) return plan;
  return { ...plan, inflationBps: clampInt(bps, DIAL_LIMITS.inflationBps.min, DIAL_LIMITS.inflationBps.max) };
}
