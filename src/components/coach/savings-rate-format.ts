/**
 * Display formatting for the savings-rate card (TASKS L.11). Pure and separately tested,
 * because these two rules are exactly what a fresh-context critic broke in the first cut:
 * the "−855105.8%" the owner reported RECURS whenever the pooled window has a single
 * near-zero-income month, and a "1-month average" is a comparison of this month with
 * itself. The engine keeps the true bps; presentation is floored and gated here.
 *
 * #796: the floor and the one-decimal rule now live in the engine (`savingsRatePct`), so
 * Ask's savings answers print every rate exactly as this card does.
 */
import { RATE_FLOOR_BPS, savingsRatePct } from '@/lib/engine/assistant/trace-view';

export { RATE_FLOOR_BPS };

/** An "average" needs at least two contributing months; one income month IS the current
 *  month, so a "1-month average" compares this month to itself. */
export const MIN_AVERAGE_MONTHS = 2;

/**
 * Format a savings rate (bps) for display. Below −100% renders as "below -100%": still
 * true, never a fabricated giant number. At or above the floor, one-decimal percent.
 */
export function formatSavingsRateBps(bps: number): string {
  return savingsRatePct(bps);
}

/** Whether the "N-month average" comparison line should be shown at all. */
export function showsAverageComparison(
  currentRateBps: number | null,
  avgBps: number | null,
  avgMonths: number,
): boolean {
  return currentRateBps !== null && avgBps !== null && avgMonths >= MIN_AVERAGE_MONTHS;
}
