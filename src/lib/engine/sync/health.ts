/**
 * Connection health / data-staleness classifier (Competitive-Gap plan, Gap 1 §3–4).
 *
 * A linked bank feed (SimpleFIN, Plaid) is only useful when it is *current*. This
 * pure module answers one question from data the app already has — "how long since
 * this connection last produced fresh data?" — and grades it fresh / stale /
 * very_stale / unknown. It NEVER asserts a connection is "broken": there is no
 * persisted sync-error signal to observe, so the honest claim is about data
 * *recency*, not connection state. Copy follows the coaching guardrail — a neutral
 * heads-up, no shame, and the reconnect nudge is phrased as "you may need to", not a
 * false certainty.
 *
 * No I/O, no `Date` — all arithmetic is integer day math via dates.ts, so the same
 * inputs classify identically on every machine and in every timezone.
 */
import { type ISODate, compareDates, daysBetween } from '@/lib/dates';

export type FreshnessLevel = 'fresh' | 'stale' | 'very_stale' | 'unknown';

/**
 * Thresholds in whole days since the reference date. A healthy feed normally posts
 * within a couple of business days (a long weekend can stretch that to ~3); past two
 * weeks it almost always means the connection needs attention. Exported so tests pin
 * the exact boundary and an operator can tune without touching the logic.
 */
export const FRESH_THROUGH_DAYS = 3; //  ≤3 days  → fresh
export const STALE_THROUGH_DAYS = 13; // 4..13 days → stale; ≥14 → very_stale

export interface FreshnessResult {
  level: FreshnessLevel;
  /** Whole days from the reference date to today; null when there is no reference. */
  daysSince: number | null;
  /** The date we measured from (a last-sync date or a newest-transaction date). */
  referenceDate: ISODate | null;
}

/**
 * Grade a connection's freshness by how many days have passed since `referenceDate`
 * (its last successful sync, or its newest transaction) relative to `today`.
 *
 * - `referenceDate == null` → `unknown` (never synced / no data — not a warning).
 * - A future reference date (clock skew / a sync stamped ahead of today) counts as
 *   fresh with a non-negative `daysSince` of 0, never a negative day count.
 */
export function classifyFreshness(referenceDate: ISODate | null, today: ISODate): FreshnessResult {
  if (referenceDate == null) {
    return { level: 'unknown', daysSince: null, referenceDate: null };
  }
  const raw = daysBetween(referenceDate, today);
  const daysSince = raw < 0 ? 0 : raw; // a future reference date is not "negative days ago"
  const level: FreshnessLevel =
    daysSince <= FRESH_THROUGH_DAYS ? 'fresh' : daysSince <= STALE_THROUGH_DAYS ? 'stale' : 'very_stale';
  return { level, daysSince, referenceDate };
}

/**
 * Human copy for a single connection's freshness (UI boundary; guardrail-safe).
 * `unknown` has no day count; `very_stale` carries the gentle reconnect nudge.
 */
export function freshnessMessage(result: FreshnessResult): string {
  const { level, daysSince } = result;
  if (level === 'unknown' || daysSince == null) return 'Not synced yet';
  const ago = daysSince === 0 ? 'today' : daysSince === 1 ? 'yesterday' : `${daysSince} days ago`;
  if (level === 'fresh') return daysSince === 0 ? 'Synced today' : `Synced ${ago}`;
  if (level === 'stale') return `Last synced ${ago}`;
  return `No new data in ${daysSince} days — you may need to reconnect.`;
}

/**
 * The most recent of several candidate reference dates (nulls ignored). Used to pick the
 * best available freshness signal for a linked feed: a sync that RAN recently
 * (a connection's lastSyncedAt) proves the feed is live even when no new transactions
 * arrived, so it outranks a quiet transaction feed — this is what keeps a healthy but
 * low-activity linked account (e.g. a savings-only feed) from tripping a false "sync may
 * have stopped" banner. Returns null only when every candidate is null.
 */
export function mostRecentDate(...dates: Array<ISODate | null>): ISODate | null {
  let best: ISODate | null = null;
  for (const d of dates) {
    if (d != null && (best == null || compareDates(d, best) > 0)) best = d;
  }
  return best;
}

export interface DataFreshnessSummary {
  level: FreshnessLevel;
  daysSince: number | null;
  /** Newest transaction date across the user's *linked* (auto-syncing) accounts. */
  newestDate: ISODate | null;
  /** True only when a dashboard banner should show (stale or very_stale). */
  shouldWarn: boolean;
}

/**
 * Portfolio-level data recency for the dashboard banner, from the newest transaction
 * across the user's LINKED accounts (manual/demo accounts are excluded upstream — they
 * do not sync, so they can never be "stale"). `null` newest date → no linked data yet
 * → `unknown`, `shouldWarn=false` (a brand-new or manual-only user is never nagged).
 */
export function summarizeDataFreshness(newestLinkedTxnDate: ISODate | null, today: ISODate): DataFreshnessSummary {
  const { level, daysSince } = classifyFreshness(newestLinkedTxnDate, today);
  return {
    level,
    daysSince,
    newestDate: newestLinkedTxnDate,
    shouldWarn: level === 'stale' || level === 'very_stale',
  };
}

/**
 * Banner copy for the dashboard, or `null` when nothing should show. Speaks to the
 * whole feed ("your accounts") rather than one connection, and states the recency
 * plainly so the user can judge whether it is expected.
 */
export function dataFreshnessBanner(summary: DataFreshnessSummary): string | null {
  if (!summary.shouldWarn || summary.daysSince == null) return null;
  const days = summary.daysSince;
  const lead = `Your linked accounts haven't shown new activity in ${days} days.`;
  return summary.level === 'very_stale'
    ? `${lead} A sync may have stopped — check your connections on the Accounts page.`
    : `${lead} If that seems off, you can reconnect from the Accounts page.`;
}
