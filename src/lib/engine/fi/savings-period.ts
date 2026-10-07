/**
 * A savings rate over a PERIOD the reader names — "what was my savings rate last
 * year?" (DECISIONS #796).
 *
 * The month figures are `monthlyFlows`' own: the same income and spending the /coach
 * chart draws and Ask's income answer sums, so a one-month period here is that month's
 * coach figure. Over several months the rate is POOLED, dollars over dollars —
 * (Σ income − Σ spending) ÷ Σ income — for #294's reason: a mean of monthly ratios lets
 * one thin month swamp the rest.
 *
 * One deliberate difference from the coach card's average: a month with spending and
 * no income KEEPS its spending here. Over a period, a month lived on savings is money
 * that was not kept, and dropping it would flatter the rate — the direction a savings
 * figure must never err in. The answer names such a month.
 *
 * Which months a period can honestly cover is decided from two facts only:
 *
 *   1. Today. A month still in progress is left out: a savings rate read part-way
 *      through a month mostly measures when the paychecks landed.
 *   2. The reader's records. A month before their first transaction on record has
 *      nothing to say, and the month that first transaction falls in is only partly on
 *      record unless it falls on the 1st. Both are left out and named — never read as
 *      a $0 month.
 *
 * A finished month inside the records with no counted row stays in the period (it adds
 * nothing to either side) and is reported as such, because an empty month is not a
 * fact about money.
 *
 * Pure: no I/O, no clock (`today` is passed in), integer cents, month keys.
 */
import { addMonthsToMonthKey, monthKey, type ISODate } from '@/lib/dates';
import { cents, type Cents } from '@/lib/money';
import { savingsRateBps } from './fi';
import type { MonthlyFlow } from './insights';

export interface PeriodMonth {
  month: string; // YYYY-MM
  incomeCents: Cents;
  expensesCents: Cents;
  /** False when no counted row fell in the month: it adds $0 to both sides. */
  hasActivity: boolean;
}

export type SavingsPeriod =
  /** Nothing is on record at all. */
  | { ok: false; reason: 'no-records' }
  /** No month of the window has finished yet; `firstYm` is the window's first month. */
  | { ok: false; reason: 'unfinished'; firstYm: string }
  /** Every finished month of the window falls before the first full month on record. */
  | { ok: false; reason: 'before-records'; recordsStart: ISODate; firstFullYm: string }
  | {
      ok: true;
      /** The months actually measured — the window cut to finished, on-record months. */
      fromYm: string;
      toYm: string;
      /** Every month from `fromYm` to `toYm`, ascending, including empty ones. */
      months: readonly PeriodMonth[];
      incomeCents: Cents;
      expensesCents: Cents;
      /** Income − spending; negative when spending was higher. */
      keptCents: number;
      /** Pooled, in basis points; null when no income is on record in the period. */
      rateBps: number | null;
      /** Set when the window began before the first full month on record. */
      beforeRecords: { recordsStart: ISODate; firstFullYm: string } | null;
      /** The current month, when the window reached it (it is left out). */
      inProgressYm: string | null;
    };

/** The first month whose every day is on record: the start month itself only from its 1st. */
export function firstFullMonthOnRecord(recordsStart: ISODate): string {
  const ym = monthKey(recordsStart);
  return recordsStart.slice(8, 10) === '01' ? ym : addMonthsToMonthKey(ym, 1);
}

export function savingsOverPeriod(input: {
  flows: readonly MonthlyFlow[];
  fromYm: string;
  toYm: string;
  today: ISODate;
  /** The reader's earliest transaction on record (any account), or null for none. */
  recordsStart: ISODate | null;
}): SavingsPeriod {
  const { flows, fromYm, toYm, today, recordsStart } = input;
  if (recordsStart === null) return { ok: false, reason: 'no-records' };

  const currentYm = monthKey(today);
  const lastFinishedYm = addMonthsToMonthKey(currentYm, -1);
  const end = toYm < currentYm ? toYm : lastFinishedYm;
  if (end < fromYm) return { ok: false, reason: 'unfinished', firstYm: fromYm };
  const inProgressYm = toYm >= currentYm ? currentYm : null;

  const firstFullYm = firstFullMonthOnRecord(recordsStart);
  if (end < firstFullYm) return { ok: false, reason: 'before-records', recordsStart, firstFullYm };
  const start = fromYm < firstFullYm ? firstFullYm : fromYm;
  const beforeRecords = fromYm < firstFullYm ? { recordsStart, firstFullYm } : null;

  const byMonth = new Map(flows.map((f) => [f.month, f]));
  const months: PeriodMonth[] = [];
  let income = 0;
  let expenses = 0;
  for (let ym = start; ym <= end; ym = addMonthsToMonthKey(ym, 1)) {
    const f = byMonth.get(ym);
    months.push({
      month: ym,
      incomeCents: f?.incomeCents ?? cents(0),
      expensesCents: f?.expensesCents ?? cents(0),
      hasActivity: f !== undefined,
    });
    income += f?.incomeCents ?? 0;
    expenses += f?.expensesCents ?? 0;
  }

  return {
    ok: true,
    fromYm: start,
    toYm: end,
    months,
    incomeCents: cents(income),
    expensesCents: cents(expenses),
    keptCents: income - expenses,
    rateBps: savingsRateBps(cents(income), cents(expenses)),
    beforeRecords,
    inProgressYm,
  };
}
