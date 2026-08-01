/**
 * Bounds for the FI card's "what if I saved" slider.
 *
 * The thumb must be able to sit on the reader's CURRENT pace. A hard 70% ceiling
 * forced every saver above that into a clamped initial value, so the first paint
 * took `sliderCaption`'s CHANGED branch ("Lowering your savings rate from 85% to
 * 70%…") before anyone touched anything — beside a `sliderContext` line that still
 * claimed the slider was at the 6-month average (W.11 / DECISIONS #364).
 *
 * Floor stays 0; ceiling is at least 70% and never below the current pace, so a
 * typical saver can still raise toward 70% and a high saver can sit on (or lower
 * from) their real rate.
 */

/** Inclusive upper bound of the slider, in basis points. */
export function fiSliderMaxBps(currentRateBps: number): number {
  return Math.max(7000, Math.max(0, Math.trunc(currentRateBps)));
}

/** Initial thumb position: the current pace, floored at 0 and never above the max. */
export function fiSliderInitialBps(currentRateBps: number): number {
  return Math.min(fiSliderMaxBps(currentRateBps), Math.max(0, Math.trunc(currentRateBps)));
}
