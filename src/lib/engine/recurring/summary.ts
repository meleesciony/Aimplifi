/**
 * Recurring summary (DECISIONS #71) — pure derivation on top of the detection
 * engine (`detect.ts`). Normalizes each series to a per-month figure, splits the
 * detected series into subscriptions / bills / income / inactive, and totals the
 * monthly recurring spend — the headline number that makes this the feature
 * people switch apps for.
 *
 * Pure: integer cents in/out, ISO dates, no I/O, no `new Date()`.
 */
import { daysBetween, isoDate } from '@/lib/dates';
import type { Cadence, RecurringSeriesResult } from './detect';

/** Charges per month, for monthly-equivalent normalization. */
const PER_MONTH: Record<Cadence, number> = {
  WEEKLY: 52 / 12,
  BIWEEKLY: 26 / 12,
  MONTHLY: 1,
  ANNUAL: 1 / 12,
  IRREGULAR: 0,
};

/** Nominal cadence length in days, for the active/lapsed cutoff. */
const CADENCE_DAYS: Record<Cadence, number> = {
  WEEKLY: 7,
  BIWEEKLY: 14,
  MONTHLY: 30,
  ANNUAL: 365,
  IRREGULAR: 0,
};

export interface RecurringItem extends RecurringSeriesResult {
  /** Magnitude (always positive) normalized to a per-month figure. */
  monthlyEquivalentCents: number;
  /** Still charging? false once overdue by more than half a cadence again. */
  active: boolean;
  daysSinceLast: number;
}

export interface RecurringSummary {
  items: RecurringItem[]; // all, active first then monthly-equivalent desc
  subscriptions: RecurringItem[]; // active, isSubscription
  bills: RecurringItem[]; // active recurring expenses that aren't subscriptions/income
  income: RecurringItem[]; // active, isIncome
  inactive: RecurringItem[]; // appears to have stopped
  /** Active subscriptions + bills, per month — the headline. */
  monthlyRecurringSpendCents: number;
  /** Active recurring income, per month. */
  monthlyIncomeCents: number;
  activeSubscriptionCount: number;
  /** Active series with a detected price increase. */
  priceIncreases: RecurringItem[];
}

export function summarizeRecurring(
  series: readonly RecurringSeriesResult[],
  today: string,
): RecurringSummary {
  const t = isoDate(today);

  const items: RecurringItem[] = series.map((s) => {
    const monthlyEquivalentCents = Math.round(Math.abs(s.typicalAmountCents) * PER_MONTH[s.cadence]);
    const daysSinceLast = daysBetween(isoDate(s.lastSeenAt), t);
    const active = daysSinceLast <= Math.round(CADENCE_DAYS[s.cadence] * 1.5);
    return { ...s, monthlyEquivalentCents, active, daysSinceLast };
  });

  items.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (b.monthlyEquivalentCents !== a.monthlyEquivalentCents) {
      return b.monthlyEquivalentCents - a.monthlyEquivalentCents;
    }
    return a.merchantCanonical.localeCompare(b.merchantCanonical);
  });

  const subscriptions = items.filter((i) => i.active && i.isSubscription);
  const income = items.filter((i) => i.active && i.isIncome);
  const bills = items.filter((i) => i.active && !i.isIncome && !i.isSubscription);
  const inactive = items.filter((i) => !i.active);
  const priceIncreases = items.filter(
    (i) => i.active && i.previousAmountCents !== null && Math.abs(i.lastAmountCents) > Math.abs(i.previousAmountCents),
  );

  const monthlyRecurringSpendCents =
    subscriptions.reduce((s, i) => s + i.monthlyEquivalentCents, 0) +
    bills.reduce((s, i) => s + i.monthlyEquivalentCents, 0);
  const monthlyIncomeCents = income.reduce((s, i) => s + i.monthlyEquivalentCents, 0);

  return {
    items,
    subscriptions,
    bills,
    income,
    inactive,
    monthlyRecurringSpendCents,
    monthlyIncomeCents,
    activeSubscriptionCount: subscriptions.length,
    priceIncreases,
  };
}
