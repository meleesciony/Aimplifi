/**
 * What the app records of a user's balances, and when (TASKS U.4).
 *
 * Until this shipped, ONLY `prisma/seed.ts` wrote `BalanceSnapshot`, so the
 * net-worth trend was a demo-only feature: a real user's /accounts detail panel
 * truthfully read "No balance history recorded" forever, because nothing on any
 * sync path had ever written a row.
 *
 * ── Why the plan is per USER and not per provider sync ────────────────────────
 * `netWorthSeries` buckets snapshots by EXACT date and sums whatever rows carry
 * that date; its own docblock states the assumption this planner has to honour —
 * *"providers snapshot every account per period"*. So a bucket that is missing an
 * account is not "one account absent from a list", it is a **net-worth figure
 * that silently understates by that account's balance**, rendered as money on
 * two pages. A writer that ran per provider would stamp the SimpleFIN accounts
 * on one date and the Plaid accounts on another (they sync independently, and
 * on the owner's live corpus that is 25 accounts against 13), so every historical
 * point would be a partial sum and the trend line would zigzag between two wrong
 * numbers.
 *
 * The same date key is also what lets the shipped reconciliation de-duplication
 * work at all: `reconcile-boundary.keepsSnapshot` drops a linked pair's duplicate
 * copy ONLY on an exact-date collision, and a reconciled pair here is by
 * definition cross-provider (a SimpleFIN predecessor re-linked through Plaid).
 * Per-provider dates would never collide, so the boundary could never fire and
 * both copies of one real-world account would count.
 *
 * Hence the invariant this module exists to hold:
 *
 *   **Every snapshot date a user has carries one row for EVERY account that user
 *   held at that moment — the same account set the live "today" point sums.**
 *
 * ── Which accounts ───────────────────────────────────────────────────────────
 * All of them, including manual rows and accounts whose feed has gone quiet.
 * A manual account (a hand-added mortgage — U.3's own case) is never touched by
 * a sync, and an account with `feedDroppedAt` set keeps its last balance and
 * keeps counting everywhere by documented decision (schema: *"Adjusts NO figure"*).
 * Recording only what a sync refreshed would drop both from every historical
 * point, which for a liability makes the past look BETTER than it was — the
 * dangerous direction. What the app holds is what gets recorded; the freshness
 * surfaces are what say how old it is.
 *
 * ── Which date ───────────────────────────────────────────────────────────────
 * The date the balance was actually read, never a synthesized month-end. Stamping
 * the month's last day would either write a FUTURE-dated row (invisible until the
 * month closes — `netWorthSeries` filters `date <= today` — and then asserting as
 * a month-end balance a figure observed weeks earlier), or force the row to be
 * rewritten all month, which is no longer an additive write. `netWorthPointBasis`
 * already derives its sentence from the date itself (O.20f P2-g), so a mid-month
 * row reads "balance on <date>" and never claims to be a month-end.
 *
 * Once per calendar month, because that is the granularity the trend renders and
 * the shape the seed established. The month is claimed by the FIRST covered sync
 * in it: later syncs that month write nothing, so the recorded figure is always
 * one real observation rather than a running overwrite.
 */
import { type ISODate, addMonthsToMonthKey, monthKey } from '@/lib/dates';

/**
 * How far back the two surfaces that DRAW the trend read snapshots.
 *
 * Before U.4 both read every row a user owned, which was 162 for the seeded demo
 * and zero for everyone else. Now it grows — roughly accounts × 12 a year, ~456
 * for the owner's 38 accounts — and every one of those rows is serialized into
 * the page payload, the dead weight O.20b was opened for. 19 months is one more
 * than the 18 points the chip strip renders (and the 12 the PDF prints), so
 * nothing that reaches a reader is dropped: this bounds the payload, it does not
 * cap what is shown. The per-account detail panel deliberately stays unwindowed
 * — it renders its whole recorded set (the O.20f no-silent-caps rule).
 */
export const TREND_HISTORY_MONTHS = 19;

/** The earliest snapshot date the trend surfaces load, inclusive. */
export function trendHistoryFloor(today: ISODate): string {
  return `${addMonthsToMonthKey(monthKey(today), -TREND_HISTORY_MONTHS)}-01`;
}

export interface SnapshotPlanAccount {
  id: string;
  /** Stored positive, exactly as `Account.currentBalanceCents` is; `type` decides the sign at read. */
  currentBalanceCents: number;
}

export interface PlannedBalanceSnapshot {
  accountId: string;
  date: ISODate;
  balanceCents: number;
}

export function planMonthlyBalanceSnapshots(input: {
  /** EVERY account the user holds — see "Which accounts" above. */
  accounts: readonly SnapshotPlanAccount[];
  /** The dates this user already has snapshots on. Only the ones in `today`'s month decide anything. */
  existingSnapshotDates: readonly string[];
  today: ISODate;
}): PlannedBalanceSnapshot[] {
  const month = monthKey(input.today);
  // Already claimed this month: the recorded figure stays the first observation,
  // and — the load-bearing half — a second date in one month would be a SECOND
  // bucket holding the same accounts, i.e. two points a day apart on the trend.
  if (input.existingSnapshotDates.some((d) => monthKey(d) === month)) return [];
  // All-or-nothing, deliberately: a partial plan is the incomplete bucket this
  // module exists to prevent. An account linked after this month was claimed
  // therefore waits for next month rather than opening a bucket of its own.
  return input.accounts.map((a) => ({
    accountId: a.id,
    date: input.today,
    balanceCents: a.currentBalanceCents,
  }));
}
