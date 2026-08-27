import type { ISODate } from '@/lib/dates';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import type { RadarResult } from './radar';

/**
 * C2+C15 · Housel — the dashboard cushion line that pairs a projected dip with
 * the reader's own runway cushion (COACH_PRINCIPLES_PLAN.md §4 Dashboard row).
 *
 * Three gates, all three proven: the sentence exists only when the radar card
 * actually PRINTS a dip (status `alert` AND a first-negative date), only when
 * the reader has a cushion to name, and the copy never claims what the
 * projection already sees. The cover transfer above the line handles the KNOWN
 * dip (the radar sees it); this line is about what no projection sees — the
 * cushion. The distinction is the point of the sentence, so the line never
 * names the dip date or amount and never calls the cushion a recommendation.
 *
 * A non-finite (no expenses yet), zero or negative month count is an ABSENCE,
 * not a cushion: "your 0-month cushion handles what no forecast sees" would be
 * a fabricated function, so the line refuses and the card's plain dip/cover
 * copy stands alone. The month count is printed as-is — same convention as
 * `stayingWealthyRunway` (`2.1-month cushion`), never rounded.
 */
export function cushionLineFor(
  status: RadarResult['status'],
  firstNegativeDate: ISODate | null,
  runwayMonths: number | null,
): string | null {
  if (status !== 'alert' || firstNegativeDate == null) return null;
  if (runwayMonths == null || !Number.isFinite(runwayMonths) || runwayMonths <= 0) return null;
  return COACH_COPY.cushionLine(runwayMonths);
}
