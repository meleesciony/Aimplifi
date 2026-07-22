/**
 * The one median. Five engines — money signature, anomaly radar, merchant lens,
 * FI insights, recurring detection — each carried their own copy (2026-07-21
 * agent review, finding B4), and the copies had DRIFTED on the even-count case:
 * three floored, one rounded, one returned the raw average.
 *
 * That drift is why this module returns the EXACT median and leaves rounding to
 * the caller, instead of picking one convention and quietly re-rounding four
 * engines' money figures. Rounding money is a decision each engine states out
 * loud at its own call site:
 *   - `Math.floor(medianOfSorted(xs))` — the integer-cents radar convention
 *     (signature, anomaly, merchant lens);
 *   - `Math.round(median(xs))` — recurring cadence, in days, not money;
 *   - raw — FI insights' half-over-half growth, where the median feeds a ratio.
 *
 * (Whether those three conventions SHOULD converge is a money-math question with
 * a 1-cent blast radius per engine, recorded in docs/STATUS.md — not something a
 * redundancy cleanup gets to decide silently.)
 *
 * Empty input returns NaN — the exact value all five copies already produced
 * (`undefined + undefined` → NaN), so no caller's behaviour changes here. Every
 * current caller gates on a minimum sample size before asking.
 */

/**
 * Median of an ASCENDING-SORTED list. Even counts return the average of the two
 * middle values, unrounded. Nothing is sorted here — sorting a "sorted" input
 * would hide a caller bug rather than expose it.
 */
export function medianOfSorted(sorted: readonly number[]): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Median of an unsorted list — sorts a COPY (never mutates the caller's array). */
export function median(values: readonly number[]): number {
  return medianOfSorted([...values].sort((a, b) => a - b));
}
