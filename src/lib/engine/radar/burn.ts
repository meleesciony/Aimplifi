/**
 * Burn-rate module (Cash Flow Radar, DECISIONS #172 — AI plan §1.2).
 *
 * Derives the user's *day-to-day discretionary* outflow pace on the payment
 * (checking) account from recent history: the median ("typical") and p80
 * ("heavy") of complete WEEKLY outflow totals, expressed per day. The radar
 * renders these as a LABELED estimate band — they are NEVER an input to the
 * committed-only alarm line (adjudicated condition 1, AI plan §1.2).
 *
 * "Discretionary" here means: POSTED payment-account outflows that are NOT
 * transfers/card payments (isTransfer), NOT split containers, and NOT part of
 * a known committed flow (the caller passes the canonical merchants of
 * scheduled rows + detected recurring series — those dollars are already on
 * the committed line, counting them again would double-book rent as "burn").
 * Card swipes never appear here at all: they hit checking only through
 * statement dues, which the radar models as card obligations.
 *
 * Pure: integer cents, ISO-date strings, no I/O, no `new Date()`.
 */
import { type ISODate, addDays, compareDates, daysBetween, isoDate } from '@/lib/dates';
import { type Cents, ZERO, roundHalfAwayFromZero } from '@/lib/money';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import type { TransactionLike } from '@/lib/engine/cash-needed/assemble';

/** Look back 8 complete weeks of daily spend ("based on your last 8 weeks"). */
export const BURN_LOOKBACK_DAYS = 56;
/** Under 4 weeks of history the pace is not representable — show "learning your pace". */
export const BURN_MIN_HISTORY_DAYS = 28;
/** "Heavy day" percentile (nearest-rank) for the conservative band edge. */
export const BURN_HEAVY_PERCENTILE = 0.8;

export interface BurnRates {
  /** Median weekly discretionary outflow ÷ 7 — the typical daily pace (≥ 0). */
  typicalDailyCents: Cents;
  /** p80 weekly outflow ÷ 7 — the heavy-week pace (≥ typical). */
  heavyDailyCents: Cents;
  /** Days actually sampled: complete weeks within the account's real history. */
  sampleDays: number;
  /** False when the account has under BURN_MIN_HISTORY_DAYS of history. */
  hasEnoughHistory: boolean;
}

/**
 * Daily discretionary outflow totals for the `lookbackDays` COMPLETE days
 * ending YESTERDAY (today is in progress — a partial day would bias the
 * percentiles low). Index 0 = oldest day. Days without spend are 0 — a
 * no-spend day is real evidence of pace, not a missing sample.
 */
export function discretionaryDailyOutflows(
  transactions: readonly TransactionLike[],
  params: {
    paymentAccountId: string;
    /** normalizeMerchant canonicals of committed flows (scheduled rows + recurring series). */
    excludedCanonicals: ReadonlySet<string>;
    today: ISODate;
    lookbackDays?: number;
  },
): number[] {
  const lookbackDays = params.lookbackDays ?? BURN_LOOKBACK_DAYS;
  const windowStart = addDays(params.today, -lookbackDays); // inclusive
  const windowEnd = addDays(params.today, -1); // inclusive (yesterday)

  const totals = new Map<string, number>();
  for (const t of transactions) {
    if (t.accountId !== params.paymentAccountId) continue;
    if (t.status !== 'POSTED') continue;
    if (t.isTransfer) continue;
    if (t.isSplitParent) continue;
    if (t.amountCents >= 0) continue; // outflows only
    const date = isoDate(t.date);
    if (compareDates(date, windowStart) < 0) continue;
    if (compareDates(date, windowEnd) > 0) continue;
    if (params.excludedCanonicals.has(normalizeMerchant(t.rawDescriptor).canonical)) continue;
    totals.set(t.date, (totals.get(t.date) ?? 0) + -t.amountCents);
  }

  const out: number[] = [];
  for (let d = windowStart; compareDates(d, windowEnd) <= 0; d = addDays(d, 1)) {
    out.push(totals.get(d) ?? 0);
  }
  return out;
}

/** Nearest-rank percentile of a sorted-ascending array (p in (0, 1]). */
function nearestRank(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil(p * sortedAsc.length);
  return sortedAsc[Math.max(0, rank - 1)];
}

/**
 * Pace from WEEKLY totals, not daily ones: real checking spend is sparse (a
 * grocery run, an ATM pull — most days are $0), so a daily percentile
 * collapses to $0/day for a spender with hundreds of real dollars in the
 * window (critic #172 P1-2). Weekly aggregation absorbs the sparsity while
 * staying deterministic and hand-verifiable.
 *
 * Weeks are consecutive 7-day chunks counted BACK from the most recent day,
 * clamped to the account's real history (`historyDays` — the age of the
 * oldest payment-account transaction): a 30-day-old account contributes 4
 * weeks, not 8 weeks padded with pre-account zeros that would bias the pace
 * low. typical = median weekly total ÷ 7; heavy = p80 weekly total ÷ 7 (both
 * rounded half-away-from-zero once).
 */
export function computeBurnRates(
  dailyOutflowsCents: readonly number[],
  historyDays: number,
): BurnRates {
  const usableDays = Math.min(dailyOutflowsCents.length, Math.max(0, historyDays));
  const weekCount = Math.floor(usableDays / 7);
  const weekTotals: number[] = [];
  for (let w = 0; w < weekCount; w++) {
    // week 0 = the most recent 7 days at the END of the array
    const end = dailyOutflowsCents.length - w * 7;
    let total = 0;
    for (let i = end - 7; i < end; i++) total += dailyOutflowsCents[i];
    weekTotals.push(total);
  }
  weekTotals.sort((a, b) => a - b);
  const perDay = (weeklyCents: number): Cents => roundHalfAwayFromZero(weeklyCents / 7);
  return {
    typicalDailyCents: weekTotals.length ? perDay(nearestRank(weekTotals, 0.5)) : ZERO,
    heavyDailyCents: weekTotals.length ? perDay(nearestRank(weekTotals, BURN_HEAVY_PERCENTILE)) : ZERO,
    sampleDays: weekCount * 7,
    hasEnoughHistory: historyDays >= BURN_MIN_HISTORY_DAYS,
  };
}

/** Age in days of the oldest payment-account transaction (0 when none). */
export function paymentAccountHistoryDays(
  transactions: readonly TransactionLike[],
  paymentAccountId: string,
  today: ISODate,
): number {
  let oldest: ISODate | null = null;
  for (const t of transactions) {
    if (t.accountId !== paymentAccountId) continue;
    const d = isoDate(t.date);
    if (oldest === null || compareDates(d, oldest) < 0) oldest = d;
  }
  return oldest === null ? 0 : Math.max(0, daysBetween(oldest, today));
}
