/**
 * Does a detected recurring series MOVE the reader's own money — into or out of investing
 * or savings, or between their accounts — or spend or earn it? (DECISIONS #789, #792.)
 *
 * A detected series carries only its merchant's DEFAULT filing (`categoryId`). The reader's
 * own filings of the rows the series holds decide it instead whenever any of those rows is
 * filed (#792 critic cycle 2, P2-1 / P2-2): most of them filed Transfer or Investment &
 * Savings → a move; most of them filed anything else → not a move, whatever the default
 * says. A tie is a move — calling a contribution a cut is the costlier mistake. Rows not
 * filed yet do not vote.
 *
 * Reading the series' OWN rows, not every row under its merchant's name, is what keeps one
 * row's filing from deciding another's: a Venmo cash-out filed Transfer is not in the Venmo
 * rent series (an inflow is never in an outflow series), and a row no series read decides
 * nothing (the sweep that keyed this by merchant name read both signs, every row and
 * pending ones). Pure; no DB, no React.
 */
import { isMoneyMoveCategoryId } from '@/lib/engine/categorize/categories';
import type { RecurringSeriesResult } from './detect';

/** Series key → the reader's verdict ("moves money"). Absent = none of its rows is filed. */
export type MoneyMoveVerdicts = ReadonlyMap<string, boolean>;

/** One series per merchant: the detector keeps one sign per merchant (`dominantSignTxns`). */
export function seriesVerdictKey(s: Pick<RecurringSeriesResult, 'merchantCanonical'>): string {
  return s.merchantCanonical;
}

/**
 * The reader's verdict on each series, from the filings of the rows it holds. `rows` maps
 * the ids the detector was given to their stored filing; a row the map lacks is unfiled.
 */
export function moneyMoveSeriesVerdicts(
  series: readonly Pick<RecurringSeriesResult, 'merchantCanonical' | 'occurrenceRows'>[],
  rows: readonly { id: string; categoryId?: string | null }[],
): Map<string, boolean> {
  const filing = new Map<string, string | null>();
  for (const r of rows) filing.set(r.id, r.categoryId ?? null);
  const out = new Map<string, boolean>();
  for (const s of series) {
    let moves = 0;
    let other = 0;
    for (const o of s.occurrenceRows) {
      const c = filing.get(o.id);
      if (!c || c === 'uncategorized') continue;
      if (isMoneyMoveCategoryId(c)) moves += 1;
      else other += 1;
    }
    if (moves + other > 0) out.set(seriesVerdictKey(s), moves >= other);
  }
  return out;
}

/**
 * A recurring series that moves the reader's own money is never a cut candidate, never a
 * price that crept and never recurring income (#789, critic cycle 1 P0-1): cutting a
 * contribution cannot lower an FI number that no longer counts it, and a rising
 * auto-invest is more saving, not a bill that grew.
 */
export function isMoneyMoveSeries(
  s: Pick<RecurringSeriesResult, 'merchantCanonical' | 'categoryId'>,
  verdicts: MoneyMoveVerdicts = new Map(),
): boolean {
  return verdicts.get(seriesVerdictKey(s)) ?? isMoneyMoveCategoryId(s.categoryId);
}
