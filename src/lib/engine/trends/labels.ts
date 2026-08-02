/**
 * Shared Trends copy helpers — pure, no React. The dashboard summary card and
 * the /trends page must describe the same windows with the same words; a local
 * copy of either label is how they drift (CALC_AUDIT 2026-08-02 P1-2 / P1-5).
 */
import { formatMonth } from '@/lib/dates';

/** Short month name for a YYYY-MM (e.g. "Jun"). */
export function shortMonth(ym: string): string {
  return formatMonth(ym, 'short');
}

/**
 * Baseline window for category movers. `months` is most-recent-first (the
 * engine's order); the label reads oldest→newest so a 3-month average becomes
 * "Apr–Jun", not "Jun–Apr".
 *
 * Note (C.17 / audit P2): a gapped set still prints as a contiguous range.
 * That is a separate finding; this helper matches the shipped /trends wording.
 */
export function baselineLabel(months: string[]): string {
  if (months.length === 0) return 'earlier months';
  if (months.length === 1) return shortMonth(months[0]!);
  const oldest = shortMonth(months[months.length - 1]!);
  const newest = shortMonth(months[0]!);
  return `${oldest}–${newest}`;
}

/** "in the first 2 days" — the divisor the pace projection hides when omitted. */
export function paceDaysPhrase(daysElapsed: number): string {
  return `in the first ${daysElapsed} day${daysElapsed === 1 ? '' : 's'}`;
}

/**
 * How the projected month compares to last month. A zero delta is its own
 * relation — "on pace for $0.00 less" with a green tint was the P1-3 lie.
 */
export function paceDeltaRelation(
  deltaVsPriorCents: number,
): { absCents: number; relation: 'more' | 'less' | 'same' } {
  if (deltaVsPriorCents === 0) return { absCents: 0, relation: 'same' };
  return {
    absCents: Math.abs(deltaVsPriorCents),
    relation: deltaVsPriorCents > 0 ? 'more' : 'less',
  };
}

/** Assumption stated beside every pace figure (dashboard + /trends). */
export const PACE_ASSUMPTION =
  'Assumes spending continues at the current daily rate — a projection, not a prediction.';

/**
 * Window the top mover describes. Null when movers have no compared month
 * (not enough history) — the caller must not invent an "this month" label.
 */
export function moverWindowLabel(
  comparedYm: string | null,
  baselineMonths: string[],
): string | null {
  if (comparedYm === null) return null;
  return `${shortMonth(comparedYm)} vs ${baselineLabel(baselineMonths)} average`;
}
