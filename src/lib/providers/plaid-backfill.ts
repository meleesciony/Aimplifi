/**
 * O.12d — pure planner for the Plaid provider-category BACKFILL.
 *
 * WHY THIS EXISTS: L.12 (commit 57e3576, 2026-07-24) added `providerCategoryId` /
 * `providerCategoryConfidenceBps` with exactly one writer — live `/transactions/sync`
 * ingest — and `/transactions/sync` never re-sends a row it has already delivered, so
 * every Plaid row ingested before that deploy carries a permanent null in the column
 * the triage inbox's "Plaid's guess" tier reads (measured on the owner's data:
 * 1,279 of 1,312 Plaid spending rows; 97 of his 173 queued review rows). The repair
 * fetches the historical window via the date-ranged `/transactions/get` (which DOES
 * return already-delivered rows) and fills the two provider columns — nothing else.
 *
 * FAILURE DIRECTION (from TASKS O.12d): a WRONG guess written here is offered to the
 * reader as a confident-looking ONE-TAP mis-file, so every uncertainty is a SKIP with
 * a named reason, never a guess:
 *   - the row's `providerRef` must match a fetched `transaction_id` EXACTLY;
 *   - the fetched row's `account_id` must map to the SAME local account;
 *   - the fetched amount (through `plaidAmountToCents`, the ingest conversion) must
 *     equal the stored `amountCents` byte-for-byte;
 *   - a `transaction_id` the fetch returned TWICE with disagreeing fields (possible
 *     when `/transactions/get` pagination shifts under a concurrent update) is
 *     distrusted entirely;
 *   - and the guess itself comes from `persistedProviderGuess` — the SAME author,
 *     including the #44/F4 sign guard, that live ingest uses — so the backfill can
 *     never write a guess ingest would have refused.
 *
 * Pure function on typed inputs: no Prisma, no fetch, unit-tested with known-answer
 * cases. The server side (PlaidProvider.backfillProviderCategories) supplies rows
 * whose provider columns are BOTH null and re-asserts that as a compare-and-set in
 * the UPDATE's WHERE clause, so the plan is idempotent by construction: a second run
 * finds no null rows to plan over, and a concurrent sync writing the column first
 * turns the write into a counted no-op.
 */
import {
  persistedProviderGuess,
  plaidAmountToCents,
  type PlaidTransaction,
} from '@/lib/providers/plaid-map';

/** A local row eligible for repair: Plaid-account row with BOTH provider columns null. */
export interface BackfillCandidateRow {
  id: string;
  /** Plaid `transaction_id` as stored at ingest (plaid-map.ts `providerRef`). */
  providerRef: string;
  accountId: string;
  /** Pulse-signed cents (outflow negative), as stored. */
  amountCents: number;
}

/** The subset of a `/transactions/get` row the planner reads. */
export type FetchedPlaidTxn = Pick<
  PlaidTransaction,
  'transaction_id' | 'account_id' | 'amount' | 'personal_finance_category'
>;

export interface ProviderBackfillWrite {
  id: string;
  providerCategoryId: string;
  providerCategoryConfidenceBps: number;
  /** The stored amount the plan MATCHED on — and the amount the F4 sign guard was
   * evaluated against. The writer re-asserts it in the UPDATE's WHERE, so a row a
   * concurrent sync re-amounts between plan and write becomes a counted no-op
   * rather than a guess whose sign guard ran on a stale sign (critic A P3-1). */
  amountCents: number;
}

export interface ProviderBackfillPlan {
  writes: ProviderBackfillWrite[];
  /** Candidates NOT written, bucketed by the reason — reported, never silent. */
  skipped: {
    /** `providerRef` absent from the fetched window (e.g. history beyond what the
     * institution returns, or a pending id whose posted twin replaced it). */
    notReturned: number;
    /** Fetched twice with disagreeing account/amount/category fields — distrusted. */
    inconsistentFetch: number;
    /** Fetched row's `account_id` does not map to this row's account. */
    accountMismatch: number;
    /** Fetched amount ≠ stored amount (through the ingest conversion). */
    amountMismatch: number;
    /** Matched exactly, but Plaid has no usable guess for the row (absent/UNKNOWN
     * PFC, unmapped taxonomy, or the F4 sign guard) — the null is CORRECT. */
    noGuess: number;
  };
}

/** The server method's report (PlaidProvider.backfillProviderCategories). */
export interface ProviderCategoryBackfillResult {
  /** Rows found with BOTH provider columns null (the repair population). */
  candidates: number;
  /** Rows the plan matched exactly and would write. */
  planned: number;
  /** Rows actually written — ≤ planned, because the UPDATE's WHERE re-asserts
   * both-null, so a row a concurrent sync populated first is a counted no-op. */
  written: number;
  itemsQueried: number;
  itemsFailed: number;
  skipped: ProviderBackfillPlan['skipped'];
}

function sameFetchedTxn(a: FetchedPlaidTxn, b: FetchedPlaidTxn): boolean {
  return (
    a.account_id === b.account_id &&
    a.amount === b.amount &&
    (a.personal_finance_category?.primary ?? null) === (b.personal_finance_category?.primary ?? null) &&
    (a.personal_finance_category?.detailed ?? null) === (b.personal_finance_category?.detailed ?? null) &&
    (a.personal_finance_category?.confidence_level ?? null) ===
      (b.personal_finance_category?.confidence_level ?? null)
  );
}

export function planProviderCategoryBackfill(
  rows: readonly BackfillCandidateRow[],
  fetched: readonly FetchedPlaidTxn[],
  /** Plaid `account_id` → our Account id (PlaidProvider.plaidAccountIdMap). */
  accountIdByPlaidId: ReadonlyMap<string, string>,
): ProviderBackfillPlan {
  const byId = new Map<string, FetchedPlaidTxn>();
  const distrusted = new Set<string>();
  for (const t of fetched) {
    const prior = byId.get(t.transaction_id);
    if (prior && !sameFetchedTxn(prior, t)) distrusted.add(t.transaction_id);
    else byId.set(t.transaction_id, t);
  }

  const plan: ProviderBackfillPlan = {
    writes: [],
    skipped: { notReturned: 0, inconsistentFetch: 0, accountMismatch: 0, amountMismatch: 0, noGuess: 0 },
  };

  for (const row of rows) {
    if (distrusted.has(row.providerRef)) {
      plan.skipped.inconsistentFetch++;
      continue;
    }
    const txn = byId.get(row.providerRef);
    if (!txn) {
      plan.skipped.notReturned++;
      continue;
    }
    if (accountIdByPlaidId.get(txn.account_id) !== row.accountId) {
      plan.skipped.accountMismatch++;
      continue;
    }
    // A non-finite fetched amount cannot match anything (plaidAmountToCents THROWS
    // on it, which would abort the whole user's repair) — skip the one row instead,
    // the skip-not-guess rule applied to a malformed payload (critic A P3-2).
    if (!Number.isFinite(txn.amount) || plaidAmountToCents(txn.amount) !== row.amountCents) {
      plan.skipped.amountMismatch++;
      continue;
    }
    const guess = persistedProviderGuess(row.amountCents, txn.personal_finance_category);
    if (!guess) {
      plan.skipped.noGuess++;
      continue;
    }
    plan.writes.push({
      id: row.id,
      providerCategoryId: guess.categoryId,
      providerCategoryConfidenceBps: guess.confidenceBps,
      amountCents: row.amountCents,
    });
  }
  return plan;
}
