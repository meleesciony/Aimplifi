/**
 * Household correction of a transaction's calendar date.
 *
 * The write is the row's date (YYYY-MM-DD). Amount, payee, category, and
 * descriptor stay put. A transaction always has a date — blank is refused.
 */
import { isoDate } from '@/lib/dates';

export function txnDateError(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return 'Enter a date.';
  try {
    isoDate(trimmed);
    return undefined;
  } catch {
    return 'Enter a valid calendar date.';
  }
}
