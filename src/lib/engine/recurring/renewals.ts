/**
 * Upcoming renewals (AI plan §3.4, DECISIONS #246) — the forward half of the
 * subscription radar: expand each ACTIVE recurring EXPENSE series from its
 * `nextExpectedAt` by cadence into dated expected charges over the next 90
 * days, bucketed into nested 7/30/90-day horizons.
 *
 * Pure and deterministic — no LLM, no I/O, integer cents, calendar-date math
 * via the shared date module only. The predicted amount of every occurrence is
 * the magnitude of the series' most recent REAL charge (after a detected price
 * change, that is the new price) — copied verbatim, never computed. What that
 * number MEANS ("expected, based on the last charge") is labeled at the UI
 * boundary (docs/lessons/verbatim-value-not-verbatim-meaning.md).
 *
 * Inclusion reuses upstream truth rather than re-deriving it
 * (docs/lessons/a-guard-must-read-what-it-guards.md): `active` comes from
 * summarizeRecurring, cadence stepping is detect.ts's own `nextDate`, and the
 * price-increase flag is `priceChangeBadge`. ANNUAL series are included —
 * detection's ≥3-occurrence gate means one only exists on ~3 years of real
 * history, which is exactly the caveat AI_DIFFERENTIATION_PLAN §3.4 demanded.
 */
import { type ISODate, addDays, compareDates, daysBetween, isoDate } from '@/lib/dates';
import { type Cadence, nextDate } from './detect';
import { priceChangeBadge, type RecurringItem } from './summary';

export interface UpcomingRenewal {
  date: ISODate;
  /** Days from `today` (0 = expected today). */
  daysOut: number;
  merchantCanonical: string;
  categoryId: string;
  accountId: string;
  /** Magnitude of the last real charge — the expected next amount, verbatim. */
  amountCents: number;
  cadence: Cadence;
  isSubscription: boolean;
  /**
   * The shipped two-plateau signal carried onto the schedule (REC-2): when the
   * series' price INCREASED, the magnitude it rose FROM — else null. Carrying
   * the magnitude (not a bare boolean) lets the UI make the same honest,
   * time-claim-free statement the row badge makes ("↑ was $15.49") instead of
   * an adverb the detector never recorded (critic #246 P2-1).
   */
  increasedFromCents: number | null;
}

export interface RenewalHorizon {
  days: 7 | 30 | 90;
  count: number;
  /** Sum of expected charges due within `days` — an estimate by construction. */
  totalCents: number;
}

export interface UpcomingRenewals {
  /** All expected charges within 90 days, date-ascending then merchant. */
  occurrences: UpcomingRenewal[];
  /** Nested buckets: 7d ⊆ 30d ⊆ 90d. */
  horizons: [RenewalHorizon, RenewalHorizon, RenewalHorizon];
}

export const RENEWAL_HORIZON_DAYS = [7, 30, 90] as const;

export function upcomingRenewals(items: readonly RecurringItem[], today: string): UpcomingRenewals {
  const t = isoDate(today);
  const end = addDays(t, 90);

  const occurrences: UpcomingRenewal[] = [];
  for (const it of items) {
    // Renewals are ACTIVE EXPENSE series only: a lapsed series has nothing
    // scheduled, and recurring income (payroll) is not a charge. IRREGULAR is
    // skipped explicitly — detection never emits one, but this exported pure
    // function must not invent a monthly schedule for a cadence-less series if
    // handed one (critic #246 P2-2).
    if (!it.active || it.isIncome || it.cadence === 'IRREGULAR') continue;
    const badge = priceChangeBadge(it);
    const increasedFromCents = badge?.increased ? badge.previousMagnitudeCents : null;
    // nextExpectedAt is already >= detection-day; re-advance so a stale input
    // (e.g. a persisted row read later) can never emit a past date.
    let n = isoDate(it.nextExpectedAt);
    while (compareDates(n, t) < 0) n = nextDate(n, it.cadence);
    while (compareDates(n, end) <= 0) {
      occurrences.push({
        date: n,
        daysOut: daysBetween(t, n),
        merchantCanonical: it.merchantCanonical,
        categoryId: it.categoryId,
        accountId: it.accountId,
        amountCents: Math.abs(it.lastAmountCents),
        cadence: it.cadence,
        isSubscription: it.isSubscription,
        increasedFromCents,
      });
      n = nextDate(n, it.cadence);
    }
  }

  occurrences.sort(
    (a, b) => compareDates(a.date, b.date) || a.merchantCanonical.localeCompare(b.merchantCanonical),
  );

  const horizons = RENEWAL_HORIZON_DAYS.map((days) => {
    const inWindow = renewalsWithin(occurrences, days);
    return { days, count: inWindow.length, totalCents: inWindow.reduce((s, o) => s + o.amountCents, 0) };
  }) as [RenewalHorizon, RenewalHorizon, RenewalHorizon];

  return { occurrences, horizons };
}

/**
 * The one bucket predicate — used by the horizon totals above AND the UI's
 * next-30-days list, so the tile count and the rows beneath it can never
 * desync (critic #246 P2-3: shared code, not parallel predicates).
 */
export function renewalsWithin(
  occurrences: readonly UpcomingRenewal[],
  days: number,
): UpcomingRenewal[] {
  return occurrences.filter((o) => o.daysOut <= days);
}
