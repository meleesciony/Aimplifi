/**
 * Display formatting for the allocation bar and legend (O.20d/O.20f). Pure and
 * separately tested because the percent label's own rules are what the O.20d-FU
 * critics broke twice: a sub-0.5% position must not announce "0% of the
 * portfolio" (one decimal still renders "0.0%" for a $3.00 position in a
 * $1,000,000.00 portfolio), and "whole percent when exact" cannot be decided by
 * IEEE754 residue — an exact 50/29/14/7 split renders "50%" · "29.0%" · "14%" ·
 * "7.0%" because 0.29 × 100 is not an integer. Both rules are decided on the
 * ROUNDED one-decimal side here: 0 rounds to "0", a rounded 0.0 is "<0.1", and
 * a rounded whole is whole.
 */

/**
 * Format a segment's weight (0–1 share of the portfolio) as a percent label,
 * WITHOUT the trailing "%" (callers append it).
 *
 * - exactly zero      → "0"   (a $0.00 position IS 0% — exact, not a rounding artifact)
 * - rounded to 0.0    → "<0.1" (a $3.00 position in a $1M portfolio must not announce "0.0%")
 * - rounded whole     → "29"  (29.999…% from 0.29 × 100 is the exact 29% the split was)
 * - otherwise         → one decimal ("29.4")
 */
export function allocationPercent(weight: number): string {
  const v = weight * 100;
  if (v === 0) return '0';
  const tenths = Math.round(v * 10);
  if (tenths === 0) return '<0.1';
  return tenths % 10 === 0 ? `${tenths / 10}` : (tenths / 10).toFixed(1);
}
