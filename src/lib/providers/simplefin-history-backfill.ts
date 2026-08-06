/**
 * Pure planner for the SimpleFIN deep-history BACKFILL (H.5; owner report
 * 2026-08-04: *"why aren't they showing, i see a max date of march this year"*).
 *
 * WHY THIS EXISTS: `SIMPLEFIN_INITIAL_LOOKBACK_DAYS` is applied ONLY on a
 * connection's first-ever pull, or to an account first seen mid-sync. An EXISTING
 * connection always fetches from `lastSyncedAt - 5d` (simplefin.ts) — so a
 * connection whose first pull ran under the old 90-day default keeps that floor
 * for the rest of its life, and no amount of ordinary syncing ever grows it. The
 * owner's March ceiling is that floor, not a bank limit. `opts.fullLookbackDays`
 * existed to force a wide window and had zero callers; this planner is what makes
 * calling it safe.
 *
 * FAILURE DIRECTION: the backfill is ADD-ONLY, and that is enforced HERE rather
 * than promised in a comment. A forced full pull re-fetches everything already
 * stored — years of overlap instead of the incremental path's five days —
 * and the live sync's ingest answers an already-stored row with
 * `guardedVerdictRefresh`, which rewrites `categoryId` / `needsReview` /
 * `isTransfer` on every row the user has not explicitly corrected. Routing a
 * full-window pull through that path would silently re-file years of history
 * against today's rules, moving every report total with no user action and no
 * audit trail. So the planner emits ONLY rows that do not exist yet, and the
 * caller creates exactly those: the worst this can do is add less than the bank
 * holds — never disturb a verdict, a split, a correction, or a pending row.
 *
 * Every uncertainty is a SKIP with a named reason:
 *   - rows whose `id` we ALREADY hold are skipped by definition — the backfill
 *     closes gaps, it never refreshes;
 *   - PENDING rows stay out: the live sync owns the pending→posted lifecycle
 *     (verdict transplant, split dissolve, the #128 reconcile), and a backfilled
 *     pending duplicate would double-count until its posted twin arrived;
 *   - rows on an account we do not map are skipped — an investment/loan account
 *     whose transactions this app never ingests, or an account not yet created
 *     locally. The backfill never CREATES an account: account discovery belongs
 *     to the sync, which runs its own first-seen backfill pass (DECISIONS #73);
 *   - an `id` fetched TWICE with disagreeing fields is distrusted entirely (the
 *     O.12d stance) — one feed cannot be two truths about the same charge.
 *
 * Pure function on typed inputs: no Prisma, no fetch, unit-tested with
 * known-answer cases (tests/unit/simplefin-history-backfill.test.ts). The server
 * side supplies the fetched window plus the providerRefs it already stores, and
 * re-checks uniqueness at create (unique violation → counted skip), so the plan
 * stays idempotent under two racing syncs.
 */
import type { SimplefinAccount, SimplefinTransaction } from '@/lib/providers/simplefin-map';

export interface SimplefinBackfillSkipped {
  /** `pending: true` — the live sync owns the pending→posted lifecycle. */
  pending: number;
  /** The row's account maps to no local spending account. */
  unmappedAccount: number;
  /** `id` already stored — the backfill is add-only. */
  alreadyExists: number;
  /** Fetched twice with disagreeing fields — distrusted, the O.12d stance. */
  inconsistentFetch: number;
  /** Unusable row shape (missing/empty id) — never ingested, never counted as absent. */
  malformed: number;
  /** No usable date: `posted` is the spec's 0 sentinel and no `transacted_at`. */
  undatable: number;
}

export interface SimplefinBackfillRow {
  txn: SimplefinTransaction;
  /** Our Account id the row must be created on. */
  accountId: string;
}

export interface SimplefinBackfillPlan {
  rows: SimplefinBackfillRow[];
  skipped: SimplefinBackfillSkipped;
}

/**
 * The fields an additive ingest actually persists or derives from — a duplicate
 * id whose copy disagrees on any of them cannot be trusted. `posted` and
 * `transacted_at` are both here because the date falls back through them
 * (simplefin-map.ts), so a disagreement on either is a disagreement on the date.
 */
function sameFetchedTxn(a: SimplefinTransaction, b: SimplefinTransaction): boolean {
  return (
    a.amount === b.amount &&
    a.posted === b.posted &&
    (a.transacted_at ?? null) === (b.transacted_at ?? null) &&
    (a.description ?? null) === (b.description ?? null) &&
    (a.payee ?? null) === (b.payee ?? null) &&
    (a.memo ?? null) === (b.memo ?? null) &&
    (a.pending ?? false) === (b.pending ?? false)
  );
}

export function planSimplefinHistoryBackfill(
  /** The fetched accounts, exactly as `fetchSimplefinAccounts` returned them. */
  fetched: readonly SimplefinAccount[],
  /** Every providerRef already stored for this user's SimpleFIN accounts. */
  existingRefs: ReadonlySet<string>,
  /**
   * SimpleFIN account id → our Account id, for SPENDING accounts only. An id
   * absent from this map is skipped, never created: investment and loan accounts
   * do not take transaction rows on this path, and an account that does not exist
   * locally yet is the sync's job to create.
   */
  accountIdByRef: ReadonlyMap<string, string>,
): SimplefinBackfillPlan {
  const plan: SimplefinBackfillPlan = {
    rows: [],
    skipped: { pending: 0, unmappedAccount: 0, alreadyExists: 0, inconsistentFetch: 0, malformed: 0, undatable: 0 },
  };

  // Dedupe by SimpleFIN transaction id ACROSS the whole response, not per account.
  // SimpleFIN ids are globally unique, and the same id arriving under two accounts
  // is exactly the kind of disagreement `sameFetchedTxn` exists to distrust — so
  // the account is part of the identity check, via the entry that carries it.
  const byId = new Map<string, { txn: SimplefinTransaction; accountRef: string }>();
  const distrusted = new Set<string>();

  for (const acct of fetched) {
    // A MISSING transactions field is a partial response, not "no transactions"
    // (the #124 guard the sync applies one file over). Nothing to plan either way
    // here — the backfill only ever ADDS, so an absent array simply contributes
    // no rows; it can never be read as a signal to remove one.
    if (!acct.transactions) continue;
    for (const txn of acct.transactions) {
      if (typeof txn?.id !== 'string' || txn.id.length === 0) {
        plan.skipped.malformed++;
        continue;
      }
      const prior = byId.get(txn.id);
      if (prior && (prior.accountRef !== acct.id || !sameFetchedTxn(prior.txn, txn))) {
        distrusted.add(txn.id);
      } else if (!prior) {
        byId.set(txn.id, { txn, accountRef: acct.id });
      }
    }
  }

  for (const [id, entry] of byId) {
    if (distrusted.has(id)) {
      plan.skipped.inconsistentFetch++;
      continue;
    }
    // Existence first: an already-stored row is not our business whatever else is
    // true of it, and counting it under any other reason would misreport the run.
    if (existingRefs.has(id)) {
      plan.skipped.alreadyExists++;
      continue;
    }
    if (entry.txn.pending) {
      plan.skipped.pending++;
      continue;
    }
    // `posted: 0` is the spec's still-pending sentinel. `prepareSimplefinTransaction`
    // falls back to `transacted_at` and then to TODAY — a sane default for the live
    // sync, whose window is five days wide, and a money bug here: a three-year
    // backfill would mint an undatable row into the CURRENT month's spending, and
    // the oldest-first cap would rank it first. A row we cannot date is not a fact
    // about history; the live sync still owns it.
    if (!(entry.txn.posted > 0) && !(entry.txn.transacted_at && entry.txn.transacted_at > 0)) {
      plan.skipped.undatable++;
      continue;
    }
    const accountId = accountIdByRef.get(entry.accountRef);
    if (!accountId) {
      plan.skipped.unmappedAccount++;
      continue;
    }
    plan.rows.push({ txn: entry.txn, accountId });
  }
  return plan;
}
