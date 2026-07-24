/**
 * Display formatting for the savings-rate card (TASKS L.11). Pure and separately tested,
 * because these two rules are exactly what a fresh-context critic broke in the first cut:
 * the "−855105.8%" the owner reported RECURS whenever the pooled window has a single
 * near-zero-income month, and a "1-month average" is a comparison of this month with
 * itself. The engine keeps the true bps; presentation is floored and gated here.
 */

/** −100%. A savings rate past this has stopped being a meaningful percentage — it only
 *  balloons as the income denominator shrinks toward zero — so it is never shown precisely. */
export const RATE_FLOOR_BPS = -10_000;

/** An "average" needs at least two contributing months; one income month IS the current
 *  month, so a "1-month average" compares this month to itself. */
export const MIN_AVERAGE_MONTHS = 2;

/**
 * Format a savings rate (bps) for display. Below −100% renders as "below −100%": still
 * true, never a fabricated giant number. At or above the floor, one-decimal percent.
 */
export function formatSavingsRateBps(bps: number): string {
  // ASCII hyphen to match toFixed()'s own sign on the same surface (no mixed minus glyphs).
  return bps < RATE_FLOOR_BPS ? 'below -100%' : `${(bps / 100).toFixed(1)}%`;
}

/** Whether the "N-month average" comparison line should be shown at all. */
export function showsAverageComparison(
  currentRateBps: number | null,
  avgBps: number | null,
  avgMonths: number,
): boolean {
  return currentRateBps !== null && avgBps !== null && avgMonths >= MIN_AVERAGE_MONTHS;
}
