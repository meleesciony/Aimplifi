/**
 * No-subscription-creep streak (AI plan §Later #17 streaks half, DECISIONS #254).
 *
 * Pure retrospective walk over the detected recurring series — no persistence,
 * no LLM. Hand math in EDGE_CASES §Habit Streaks.
 *
 * Basis (stated inline in the coach copy):
 *  - universe = detected series with `isSubscription` (income and
 *    non-subscription bills excluded); zero subscriptions → abstain (null) — a
 *    vacuous "no creep" over nothing tracked is not an achievement;
 *  - a CREEP EVENT is a detected price INCREASE (`priceChangedAt` set and
 *    |typical| > |previous|; decreases never break) at month monthKey(priceChangedAt).
 *    The detector keeps at most one price change per series (two-plateau rule)
 *    and drops noisier series entirely, so within its history window every
 *    knowable increase is visible;
 *  - the walk runs FULL months descending from monthKey(today)−1, capped at
 *    `windowMonths` (disclosed in copy); an increase inside the current partial
 *    month is invisible by construction — the copy says "full months"
 *    (lag-honest, #252 precedent); same-month news belongs to the
 *    price-increase opportunity surface, not this streak.
 */
import { addMonthsToMonthKey, monthKey, type ISODate } from '@/lib/dates';
import type { RecurringSeriesResult } from './detect';

export interface CreepEvent {
  merchantCanonical: string;
  /** Old price, absolute cents. */
  fromCents: number;
  /** New price, absolute cents. */
  toCents: number;
  /** YYYY-MM of the first charge at the new price. */
  month: string;
}

export interface NoCreepStreakResult {
  /** Full months without a subscription price increase; null = abstain (no subscriptions tracked). */
  streakMonths: number | null;
  /** The walk's cap, disclosed in copy. */
  windowMonths: number;
  /** Subscription series in the universe. */
  subscriptionCount: number;
  /** The increase that stopped the walk (facts for copy), or null. */
  brokeOn: CreepEvent | null;
}

const prevYm = (month: string) => addMonthsToMonthKey(month, -1);

export function computeNoCreepStreak(
  series: readonly RecurringSeriesResult[],
  today: ISODate,
  windowMonths = 12,
): NoCreepStreakResult {
  const subs = series.filter((s) => s.isSubscription);
  if (subs.length === 0) {
    return { streakMonths: null, windowMonths, subscriptionCount: 0, brokeOn: null };
  }

  const eventsByMonth = new Map<string, CreepEvent[]>();
  for (const s of subs) {
    if (s.priceChangedAt === null || s.previousAmountCents === null) continue;
    const from = Math.abs(s.previousAmountCents);
    const to = Math.abs(s.typicalAmountCents);
    if (to <= from) continue; // decrease (or no-op): never creep
    const month = monthKey(s.priceChangedAt);
    const list = eventsByMonth.get(month) ?? [];
    list.push({ merchantCanonical: s.merchantCanonical, fromCents: from, toCents: to, month });
    eventsByMonth.set(month, list);
  }

  let streakMonths = 0;
  let brokeOn: CreepEvent | null = null;
  let m = prevYm(monthKey(today)); // latest FULL month
  for (let i = 0; i < windowMonths; i++, m = prevYm(m)) {
    const events = eventsByMonth.get(m);
    if (events !== undefined) {
      // same-month tie: largest increase, then merchant ascending (deterministic)
      brokeOn = [...events].sort(
        (a, b) => b.toCents - b.fromCents - (a.toCents - a.fromCents) ||
          a.merchantCanonical.localeCompare(b.merchantCanonical),
      )[0];
      break;
    }
    streakMonths++;
  }

  return { streakMonths, windowMonths, subscriptionCount: subs.length, brokeOn };
}
