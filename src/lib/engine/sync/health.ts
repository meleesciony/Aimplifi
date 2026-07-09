/**
 * Connection health / data-staleness classifier (Competitive-Gap plan, Gap 1 §3–4).
 *
 * A linked bank feed (SimpleFIN, Plaid) is only useful when it is *current*. This
 * pure module answers two questions from data the app already has:
 *
 *  1. *Recency* — "how long since this connection last produced fresh data?" — graded
 *     fresh / stale / very_stale / unknown (`classifyFreshness` and friends).
 *  2. *Connection state* — "did the last sync actually fail?" — graded ok / broken /
 *     unknown (`classifyConnectionHealth`, Gap 1 §4).
 *
 * The state question is answered ONLY from a PERSISTED sync-error signal that the
 * provider writes on a caught failure and CLEARS on every success — never inferred
 * from recency. This is the no-fabrication rule at product scope: a "connection
 * broken" claim shown to the user must trace to a real, recorded failure, not to a
 * quiet feed that might simply have had no new activity. A stale-but-working feed is
 * `stale`, not `broken`. The persisted reason is a sanitized label (never the raw
 * provider error, which can carry a credentialed URL — #5), and the user-facing copy
 * never echoes it. Copy follows the coaching guardrail — a neutral heads-up, no shame.
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

export interface AccountFreshnessInput {
  id: string;
  /** True only for real external feeds (SimpleFIN/Plaid). Manual/demo accounts don't
   *  sync, so they have no freshness concept — the server decides this from the provider. */
  isLinkedFeed: boolean;
  /** Account type — INVESTMENT accounts are valued by holdings, not a transaction feed. */
  type: string;
  /** Newest transaction date on THIS account, or null when it has none. */
  newestTxnDate: ISODate | null;
  /** The linked connection's last successful sync, when known (SimpleFIN); else null. A
   *  recent whole-connection sync proves a quiet account is still live (see mostRecentDate). */
  connectionLastSyncedAt: ISODate | null;
}

/**
 * Per-account data freshness for the /accounts rows (Gap 1 §3 follow-up — the connection
 * story #171 shipped at the dashboard/whole-connection level, this brings it to each row).
 * Returns a map id → result, with `null` for accounts that have no freshness concept:
 * non-linked (manual/demo — no feed to go stale) and INVESTMENT accounts (holdings-valued,
 * not a transaction feed). A linked account's reference date is the MORE RECENT of its
 * newest transaction and its connection's last sync (via mostRecentDate), so a legitimately
 * quiet feed that synced recently reads fresh instead of tripping a false "reconnect" nudge.
 */
export function perAccountFreshness(
  accounts: readonly AccountFreshnessInput[],
  today: ISODate,
): Record<string, FreshnessResult | null> {
  const out: Record<string, FreshnessResult | null> = {};
  for (const a of accounts) {
    if (!a.isLinkedFeed || a.type === 'INVESTMENT') {
      out[a.id] = null;
      continue;
    }
    out[a.id] = classifyFreshness(mostRecentDate(a.newestTxnDate, a.connectionLastSyncedAt), today);
  }
  return out;
}

// ── Connection state: did the last sync actually fail? (Gap 1 §4) ──────────────────
//
// Distinct from freshness (above), which is about data age. This grades whether a
// linked connection is currently in a FAILED state, and it does so from ONE signal
// only: a persisted `lastSyncError` that the provider sets on a caught sync failure
// and clears (to null) on the next success. `lastSyncError != null` is therefore an
// exact, non-inferred statement that the most recent sync attempt failed — the only
// honest basis for telling a user "reconnect". No recency heuristic ever promotes a
// merely-stale feed to "broken".

export type ConnectionState = 'ok' | 'broken' | 'unknown';

export interface ConnectionHealthInput {
  /** Stable id of the linked connection row (SimpleFinConnection.id / PlaidItem.id). */
  connectionId: string;
  /** Provider label for copy ("SimpleFIN", "Plaid"). */
  provider: string;
  /** Institution name when known (Plaid), else null — for a friendlier alert. */
  institution: string | null;
  /** When the last sync ATTEMPT ran (success or failure); null = never attempted. */
  lastSyncAttemptAt: ISODate | null;
  /** Sanitized reason recorded on the last FAILED attempt, cleared on success. Its
   *  presence is the sole "broken" signal; its text is never shown to the user. */
  lastSyncError: string | null;
}

export interface ConnectionHealthResult {
  connectionId: string;
  provider: string;
  institution: string | null;
  state: ConnectionState;
  /** Whole days since the last attempt; null when never attempted. */
  daysSinceAttempt: number | null;
}

/**
 * Grade one connection: `broken` iff a failure is currently recorded, else `ok` if it
 * has ever been attempted, else `unknown` (never synced). Recency is reported for copy
 * only — it never changes the state.
 */
export function classifyConnectionHealth(
  input: ConnectionHealthInput,
  today: ISODate,
): ConnectionHealthResult {
  const daysSinceAttempt =
    input.lastSyncAttemptAt == null ? null : Math.max(0, daysBetween(input.lastSyncAttemptAt, today));
  const state: ConnectionState =
    input.lastSyncError != null ? 'broken' : input.lastSyncAttemptAt == null ? 'unknown' : 'ok';
  return {
    connectionId: input.connectionId,
    provider: input.provider,
    institution: input.institution,
    state,
    daysSinceAttempt,
  };
}

export interface ConnectionAlert {
  connectionId: string;
  provider: string;
  institution: string | null;
  daysSinceAttempt: number | null;
  message: string;
}

/**
 * The reconnect alerts to surface — one per currently-broken connection, provider then
 * id order (deterministic). Healthy and never-synced connections yield nothing, so this
 * is empty for the demo user and for any user whose feeds last synced cleanly.
 */
export function selectConnectionAlerts(
  connections: readonly ConnectionHealthInput[],
  today: ISODate,
): ConnectionAlert[] {
  const alerts: ConnectionAlert[] = [];
  for (const c of connections) {
    const h = classifyConnectionHealth(c, today);
    if (h.state !== 'broken') continue;
    alerts.push({
      connectionId: h.connectionId,
      provider: h.provider,
      institution: h.institution,
      daysSinceAttempt: h.daysSinceAttempt,
      message: connectionAlertMessage(h),
    });
  }
  return alerts.sort(
    (a, b) => a.provider.localeCompare(b.provider) || a.connectionId.localeCompare(b.connectionId),
  );
}

/**
 * Guardrail-safe reconnect copy for a broken connection. States the fact (the sync
 * failed) and the one action (reconnect on Accounts) without echoing the recorded
 * error text or blaming the user. `daysSinceAttempt` softens the timing when known.
 */
export function connectionAlertMessage(h: ConnectionHealthResult): string {
  const who = h.institution ? `${h.institution} (${h.provider})` : `${h.provider}`;
  const when =
    h.daysSinceAttempt == null
      ? ''
      : h.daysSinceAttempt === 0
        ? ' in the latest sync'
        : h.daysSinceAttempt === 1
          ? ' since yesterday'
          : ` for ${h.daysSinceAttempt} days`;
  return `Your ${who} connection couldn't sync${when}. Reconnect it on the Accounts page so your numbers stay current.`;
}
