/**
 * Household mark: this cycle of a repeating bill is paid (DECISIONS #584).
 *
 * Detection projects the next occurrence from the last REAL charge. A household
 * can pay outside the feed (cash, another account, a charge that has not landed)
 * and still see that date as due on Recurring, Calendar, and cash-needed.
 * This overlay records the occurrence date they marked paid. It never writes a
 * transaction, never moves a balance, and never changes the monthly Fixed rate.
 *
 * Applied inside `detectRecurring` so every surface that projects a bill reads
 * one next date. Pure: no I/O. Does not import detect.ts (that module applies
 * the overlay, and a cycle would hide a missing export).
 */
import { type ISODate, isoDate } from '@/lib/dates';
import { overrideKey } from '@/lib/engine/recurring/override';

export interface RecurringPaidThroughInput {
  merchantCanonical: string;
  /** YYYY-MM-DD — the occurrence date marked paid. */
  paidThrough: string;
}

export const NO_RECURRING_PAID_THROUGH: readonly RecurringPaidThroughInput[] = [];

export function buildPaidThroughMap(
  rows: readonly RecurringPaidThroughInput[],
): Map<string, ISODate> {
  const map = new Map<string, ISODate>();
  for (const r of rows) {
    const key = overrideKey(r.merchantCanonical);
    if (!key || map.has(key)) continue;
    if (typeof r.paidThrough !== 'string' || r.paidThrough.length < 10) continue;
    map.set(key, isoDate(r.paidThrough));
  }
  return map;
}

export function paidThisCycleRefusal(item: {
  isIncome: boolean;
  active: boolean;
  cadence: string;
  paidThisCycle?: boolean;
} | null): string | null {
  if (!item) return "That repeating bill isn't on Recurring, so nothing changed.";
  if (item.isIncome) return "Income isn't a bill to mark paid.";
  if (!item.active) return "This doesn't look like it's still charging.";
  if (item.cadence === 'IRREGULAR') {
    return "Aimplifi doesn't have a rhythm for this, so there is no cycle to mark paid.";
  }
  if (item.paidThisCycle) return 'This cycle is already marked paid.';
  return null;
}
