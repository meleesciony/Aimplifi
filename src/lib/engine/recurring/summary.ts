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
import { isSeriesActive } from './detect';
import type { Cadence, RecurringSeriesResult } from './detect';

/**
 * Charges per month, for monthly-equivalent normalization — as an exact
 * NUMERATOR/DENOMINATOR pair, never a float.
 *
 * `52 / 12` is inexact in binary, so `amount × (26/12)` and `amount × 26 / 12`
 * are not the same number: at $999.99 biweekly the first lands just under a .5
 * boundary and rounds down, giving $2,166.64 here against the spending plan's
 * $2,166.65 for the same series. The L.24 money critic brute-forced every
 * amount to 2,000,000 cents and found 120,989 such amounts — every
 * `cents ≡ 3 (mod 6)` — including a $2,307.69 paycheck, i.e. an ordinary
 * $60k salary. One cent, but two surfaces disagreeing about one fact is the
 * L.23 defect in miniature, and the plan's integer form is the correct one.
 * The pairs match `monthlyRateCents`' divisors exactly; a test fuzzes the
 * agreement across residues rather than trusting divisible examples.
 */
const PER_MONTH: Record<Cadence, readonly [number, number]> = {
  WEEKLY: [52, 12],
  BIWEEKLY: [26, 12],
  MONTHLY: [1, 1],
  QUARTERLY: [1, 3],
  SEMIANNUAL: [1, 6],
  ANNUAL: [1, 12],
  IRREGULAR: [0, 1],
};

// The active/lapsed cutoff lives in detect.ts as `isSeriesActive` (L.23): the
// projection filter needs the identical rule, and when the two disagreed a
// lapsed series read $0/month here and a full monthly rate inside the spending
// plan. Same arithmetic as before — cadence days × 1.5, rounded.

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
  /** Active EXPENSE series with a detected price increase (income raises excluded). */
  priceIncreases: RecurringItem[];
}

export function summarizeRecurring(
  series: readonly RecurringSeriesResult[],
  today: string,
): RecurringSummary {
  const t = isoDate(today);

  const items: RecurringItem[] = series.map((s) => {
    const [num, den] = PER_MONTH[s.cadence];
    const monthlyEquivalentCents = Math.round((Math.abs(s.typicalAmountCents) * num) / den);
    const daysSinceLast = daysBetween(isoDate(s.lastSeenAt), t);
    const active = isSeriesActive(s, t);
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
  // A "price increase" is a COST signal, so only expenses belong here. A recurring
  // INCOME series whose amount rose is a pay raise — excluding `isIncome` keeps a
  // raise out of the red "prices rose" warning (REC-2). The seed has no income
  // raise, so demo/golden values are unchanged.
  const priceIncreases = items.filter(
    (i) =>
      i.active &&
      !i.isIncome &&
      i.previousAmountCents !== null &&
      Math.abs(i.lastAmountCents) > Math.abs(i.previousAmountCents),
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

export type PriceChangeTone = 'favorable' | 'adverse';

/**
 * Presentation helper (REC-2): how a recurring series' last price change reads from
 * the USER's perspective. A rising bill is `adverse` (red); a rising paycheck is
 * `favorable` (green); a falling bill is favorable; a falling paycheck adverse.
 * Returns `null` when there is no recorded change. Pure, so the per-row badge logic
 * in recurring-view.tsx is unit-testable without a DOM — the seed has flat payroll,
 * so no e2e ever renders a rising-income row.
 */
export function priceChangeBadge(
  item: Pick<RecurringSeriesResult, 'isIncome' | 'lastAmountCents' | 'previousAmountCents'>,
): { increased: boolean; tone: PriceChangeTone; previousMagnitudeCents: number } | null {
  if (item.previousAmountCents === null) return null;
  const mag = Math.abs(item.lastAmountCents);
  const prev = Math.abs(item.previousAmountCents);
  if (mag === prev) return null;
  const increased = mag > prev;
  // Income: a rise helps. Expense: a fall helps.
  const favorable = item.isIncome ? increased : !increased;
  return { increased, tone: favorable ? 'favorable' : 'adverse', previousMagnitudeCents: prev };
}
