/**
 * Planner for the one-time Plaid deep-history backfill (owner request
 * 2026-08-04: "why are we only pulling 6 months of data?"). The backfill is
 * ADD-ONLY — it closes gaps in an existing item's history and must never
 * disturb a row the cursor sync already stored — so every uncertainty is a
 * counted SKIP, never a guess (same stance as the O.12d provider-category
 * backfill, plaid-backfill.ts).
 */
import { describe, expect, it } from 'vitest';
import type { PlaidTransaction } from '@/lib/providers/plaid-map';
import { planHistoryBackfill } from '@/lib/providers/plaid-history-backfill';

function txn(over: Partial<PlaidTransaction> & Pick<PlaidTransaction, 'transaction_id' | 'account_id'>): PlaidTransaction {
  return {
    date: '2024-11-03',
    amount: 12.34,
    name: 'OLDER HISTORY ROW',
    pending: false,
    ...over,
  };
}

const ACCOUNTS = new Map([
  ['plaid-acct-1', 'local-acct-1'],
  ['plaid-acct-2', 'local-acct-2'],
]);

describe('planHistoryBackfill', () => {
  it('ingests a posted row we do not already hold, on its mapped account', () => {
    const plan = planHistoryBackfill([txn({ transaction_id: 't1', account_id: 'plaid-acct-1' })], new Set(), ACCOUNTS);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].accountId).toBe('local-acct-1');
    expect(plan.rows[0].txn.transaction_id).toBe('t1');
    expect(plan.skipped).toEqual({ pending: 0, unmappedAccount: 0, alreadyExists: 0, inconsistentFetch: 0 });
  });

  it('skips a row whose transaction_id is already stored — the backfill is add-only', () => {
    const plan = planHistoryBackfill(
      [txn({ transaction_id: 't-held', account_id: 'plaid-acct-1' })],
      new Set(['t-held']),
      ACCOUNTS,
    );
    expect(plan.rows).toHaveLength(0);
    expect(plan.skipped.alreadyExists).toBe(1);
  });

  it('keeps a pending row OUT — live sync owns the pending→posted lifecycle', () => {
    const plan = planHistoryBackfill(
      [txn({ transaction_id: 't-pending', account_id: 'plaid-acct-1', pending: true })],
      new Set(),
      ACCOUNTS,
    );
    expect(plan.rows).toHaveLength(0);
    expect(plan.skipped.pending).toBe(1);
  });

  it('skips a row whose account maps to nothing local', () => {
    const plan = planHistoryBackfill(
      [txn({ transaction_id: 't-orphan', account_id: 'plaid-acct-gone' })],
      new Set(),
      ACCOUNTS,
    );
    expect(plan.rows).toHaveLength(0);
    expect(plan.skipped.unmappedAccount).toBe(1);
  });

  it('distrusts a transaction_id fetched twice with disagreeing fields (the O.12d stance)', () => {
    const plan = planHistoryBackfill(
      [
        txn({ transaction_id: 't-dup', account_id: 'plaid-acct-1', amount: 12.34 }),
        txn({ transaction_id: 't-dup', account_id: 'plaid-acct-1', amount: 99.99 }),
      ],
      new Set(),
      ACCOUNTS,
    );
    expect(plan.rows).toHaveLength(0);
    expect(plan.skipped.inconsistentFetch).toBe(1);
  });

  it('dedupes an identical double-fetch to one row, not two', () => {
    const row = txn({ transaction_id: 't-dup-ok', account_id: 'plaid-acct-2' });
    const plan = planHistoryBackfill([row, { ...row }], new Set(), ACCOUNTS);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].accountId).toBe('local-acct-2');
  });

  it('counts each skip reason separately on a mixed fetch', () => {
    const plan = planHistoryBackfill(
      [
        txn({ transaction_id: 'new-1', account_id: 'plaid-acct-1' }),
        txn({ transaction_id: 'held', account_id: 'plaid-acct-1' }),
        txn({ transaction_id: 'pend', account_id: 'plaid-acct-1', pending: true }),
        txn({ transaction_id: 'orphan', account_id: 'plaid-acct-x' }),
        txn({ transaction_id: 'new-2', account_id: 'plaid-acct-2' }),
      ],
      new Set(['held']),
      ACCOUNTS,
    );
    expect(plan.rows.map((r) => r.txn.transaction_id)).toEqual(['new-1', 'new-2']);
    expect(plan.skipped).toEqual({ pending: 1, unmappedAccount: 1, alreadyExists: 1, inconsistentFetch: 0 });
  });

  it('plans nothing on an empty fetch', () => {
    const plan = planHistoryBackfill([], new Set(['anything']), ACCOUNTS);
    expect(plan.rows).toHaveLength(0);
    expect(plan.skipped).toEqual({ pending: 0, unmappedAccount: 0, alreadyExists: 0, inconsistentFetch: 0 });
  });
});
