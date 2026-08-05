/**
 * Pure planner for the Plaid deep-history BACKFILL (owner request 2026-08-04:
 * "why are we only pulling 6 months of data? Can we get at least 2-3 years?").
 *
 * WHY THIS EXISTS: `transactions.days_requested` applies only where Transactions
 * has NOT already been initialized on an Item (plaid.com/docs/api/link/), so every
 * Item linked before PLAID_DAYS_REQUESTED=730 shipped (2026-07-31) carries only
 * Plaid's 90-day default, and nothing about ordinary sync grows it — /transactions/sync
 * never re-sends history it already delivered. Plaid's documented way to read an
 * Item's older rows without destroying the credential is the date-ranged
 * /transactions/get (the same endpoint the O.12d provider-category backfill uses),
 * which DOES return already-delivered rows and, for most institutions, up to about
 * two years of them (institution-dependent — some carry less; asking wider than
 * the bank holds simply returns what the bank has).
 *
 * FAILURE DIRECTION: the backfill is ADD-ONLY. It never updates or deletes a row
 * the cursor sync already stored, so the worst it can do is add less than the
 * bank holds — never disturb a verdict, a split, or a correction. Every
 * uncertainty is therefore a SKIP with a named reason:
 *   - PENDING rows stay out: live sync owns the pending→posted lifecycle (with
 *     its verdict-transplant machinery), and a backfilled pending duplicate
 *     would double-count until the posted twin arrived;
 *   - rows whose `account_id` maps to no local account are skipped (an
 *     investment/loan account the item reports but we do not ingest, or an
 *     account removed after link);
 *   - rows whose `transaction_id` we ALREADY hold are skipped by definition —
 *     the backfill must never refresh an existing row, only close gaps;
 *   - a `transaction_id` fetched TWICE with disagreeing fields (possible when
 *     offset pagination shifts under a concurrent update) is distrusted
 *     entirely, the O.12d stance.
 *
 * Pure function on typed inputs: no Prisma, no fetch, unit-tested with
 * known-answer cases (tests/unit/plaid-history-backfill.test.ts). The server
 * side (PlaidProvider.backfillItemHistory) supplies the fetched window plus the
 * set of providerRefs it already stores, and re-checks uniqueness at create
 * (unique-violation → counted skip), so the plan stays idempotent under races.
 */
import type { PlaidTransaction } from '@/lib/providers/plaid-map';

export interface HistoryBackfillSkipped {
  /** `pending: true` — live sync owns the pending→posted lifecycle. */
  pending: number;
  /** Fetched row's `account_id` does not map to a local account. */
  unmappedAccount: number;
  /** `transaction_id` already stored — the backfill is add-only. */
  alreadyExists: number;
  /** Fetched twice with disagreeing fields — distrusted, the O.12d stance. */
  inconsistentFetch: number;
  /**
   * Threw in `prepareIngestedTransaction` (unparseable amount / date) — a
   * SERVER-side counter: the planner itself never sets it. Counted so a bad
   * row is skipped exactly as the live ingest skips it, never aborts the run,
   * and is never charged to the per-run cap (it can never be stored, so
   * charging it would let one bad row pin the cap on every future run — the
   * H.5 cycle-2 finding, mirrored).
   */
  malformed: number;
}

export interface HistoryBackfillRow {
  txn: PlaidTransaction;
  /** Our Account id the row must be created on. */
  accountId: string;
}

export interface HistoryBackfillPlan {
  rows: HistoryBackfillRow[];
  skipped: HistoryBackfillSkipped;
}

/** The fields an additive ingest actually persists or derives from — a
 *  duplicate id whose copy disagrees on any of them cannot be trusted. */
function sameFetchedTxn(a: PlaidTransaction, b: PlaidTransaction): boolean {
  return (
    a.account_id === b.account_id &&
    a.amount === b.amount &&
    a.date === b.date &&
    (a.name ?? null) === (b.name ?? null) &&
    (a.pending ?? false) === (b.pending ?? false)
  );
}

export function planHistoryBackfill(
  fetched: readonly PlaidTransaction[],
  /** Every providerRef already stored for this user's Plaid accounts. */
  existingRefs: ReadonlySet<string>,
  /** Plaid `account_id` → our Account id (PlaidProvider.plaidAccountIdMap). */
  accountIdByPlaidId: ReadonlyMap<string, string>,
): HistoryBackfillPlan {
  const byId = new Map<string, PlaidTransaction>();
  const distrusted = new Set<string>();
  for (const t of fetched) {
    const prior = byId.get(t.transaction_id);
    if (prior && !sameFetchedTxn(prior, t)) distrusted.add(t.transaction_id);
    else byId.set(t.transaction_id, t);
  }

  const plan: HistoryBackfillPlan = {
    rows: [],
    skipped: { pending: 0, unmappedAccount: 0, alreadyExists: 0, inconsistentFetch: 0, malformed: 0 },
  };

  for (const txn of byId.values()) {
    if (distrusted.has(txn.transaction_id)) {
      plan.skipped.inconsistentFetch++;
      continue;
    }
    if (existingRefs.has(txn.transaction_id)) {
      plan.skipped.alreadyExists++;
      continue;
    }
    if (txn.pending) {
      plan.skipped.pending++;
      continue;
    }
    const accountId = accountIdByPlaidId.get(txn.account_id);
    if (!accountId) {
      plan.skipped.unmappedAccount++;
      continue;
    }
    plan.rows.push({ txn, accountId });
  }
  return plan;
}
