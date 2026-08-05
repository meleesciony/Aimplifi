/**
 * H.5 — the SimpleFIN deep-history backfill PLANNER, the add-only boundary.
 *
 * The whole slice rests on one claim: a forced 1095-day pull, which re-fetches
 * everything already stored, may only ever ADD. These are the known-answer cases
 * for that claim at the pure layer — no Prisma, no fetch. The server-level proof
 * that a full re-pull over three years of stored rows changes nothing lives in
 * tests/unit/simplefin-history-backfill-server.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  type SimplefinBackfillPlan,
  planSimplefinHistoryBackfill,
} from '@/lib/providers/simplefin-history-backfill';
import type { SimplefinAccount, SimplefinTransaction } from '@/lib/providers/simplefin-map';

const POSTED = 1781049600; // 2026-06-06

function txn(over: Partial<SimplefinTransaction> & { id: string }): SimplefinTransaction {
  return { posted: POSTED, amount: '-42.50', description: 'STARBUCKS 123', ...over };
}
function acct(id: string, transactions?: SimplefinTransaction[]): SimplefinAccount {
  return { id, name: `Acct ${id}`, balance: '100.00', ...(transactions ? { transactions } : {}) };
}
const MAP = new Map([['acc-1', 'local-1'], ['acc-2', 'local-2']]);

function refs(plan: SimplefinBackfillPlan): string[] {
  return plan.rows.map((r) => r.txn.id);
}

describe('planSimplefinHistoryBackfill — add-only by construction', () => {
  it('plans only rows that are not already stored', () => {
    const plan = planSimplefinHistoryBackfill(
      [acct('acc-1', [txn({ id: 'old-1' }), txn({ id: 'new-1' }), txn({ id: 'old-2' })])],
      new Set(['old-1', 'old-2']),
      MAP,
    );
    expect(refs(plan)).toEqual(['new-1']);
    expect(plan.skipped.alreadyExists).toBe(2);
  });

  it('THE H.5 CLAIM: a full re-pull of an entirely-stored history plans nothing', () => {
    // The realistic shape of the owner's connection: three years of rows come
    // back, every one of them already held. A plan of zero rows is what makes
    // "the backfill cannot disturb a verdict" true rather than merely intended.
    const stored = Array.from({ length: 500 }, (_, i) => `tx-${i}`);
    const plan = planSimplefinHistoryBackfill(
      [acct('acc-1', stored.map((id) => txn({ id })))],
      new Set(stored),
      MAP,
    );
    expect(plan.rows).toEqual([]);
    expect(plan.skipped.alreadyExists).toBe(500);
  });

  it('skips PENDING rows — the live sync owns the pending→posted lifecycle', () => {
    const plan = planSimplefinHistoryBackfill(
      [acct('acc-1', [txn({ id: 'p-1', pending: true }), txn({ id: 'ok-1' })])],
      new Set(),
      MAP,
    );
    expect(refs(plan)).toEqual(['ok-1']);
    expect(plan.skipped.pending).toBe(1);
  });

  it('skips rows on an account it does not map, and never invents one', () => {
    const plan = planSimplefinHistoryBackfill(
      [acct('acc-1', [txn({ id: 'ok-1' })]), acct('acc-unknown', [txn({ id: 'x-1' }), txn({ id: 'x-2' })])],
      new Set(),
      MAP,
    );
    expect(refs(plan)).toEqual(['ok-1']);
    expect(plan.skipped.unmappedAccount).toBe(2);
  });

  it('distrusts an id fetched twice with disagreeing fields (the O.12d stance)', () => {
    const plan = planSimplefinHistoryBackfill(
      [
        acct('acc-1', [
          txn({ id: 'dup', amount: '-42.50' }),
          txn({ id: 'dup', amount: '-99.00' }), // same id, different money
          txn({ id: 'fine' }),
        ]),
      ],
      new Set(),
      MAP,
    );
    expect(refs(plan)).toEqual(['fine']);
    expect(plan.skipped.inconsistentFetch).toBe(1);
  });

  it('accepts a byte-identical duplicate once, without distrusting it', () => {
    const plan = planSimplefinHistoryBackfill(
      [acct('acc-1', [txn({ id: 'dup' }), txn({ id: 'dup' })])],
      new Set(),
      MAP,
    );
    expect(refs(plan)).toEqual(['dup']);
    expect(plan.skipped.inconsistentFetch).toBe(0);
  });

  it('distrusts the same id arriving under two different accounts', () => {
    // One charge cannot belong to two accounts; picking either would file money
    // to an account the feed did not agree on.
    const plan = planSimplefinHistoryBackfill(
      [acct('acc-1', [txn({ id: 'dup' })]), acct('acc-2', [txn({ id: 'dup' })])],
      new Set(),
      MAP,
    );
    expect(plan.rows).toEqual([]);
    expect(plan.skipped.inconsistentFetch).toBe(1);
  });

  it('counts a malformed row instead of planning it', () => {
    const plan = planSimplefinHistoryBackfill(
      [acct('acc-1', [{ id: '', posted: POSTED, amount: '-1.00' }, txn({ id: 'ok-1' })])],
      new Set(),
      MAP,
    );
    expect(refs(plan)).toEqual(['ok-1']);
    expect(plan.skipped.malformed).toBe(1);
  });

  it('treats a MISSING transactions array as no rows, never as a signal', () => {
    // The #124 shape: a partial response omits the array. The backfill only adds,
    // so an absent array can only ever mean "nothing to add here" — it must not
    // throw, and there is no removal path it could feed.
    const plan = planSimplefinHistoryBackfill([acct('acc-1'), acct('acc-2', [])], new Set(), MAP);
    expect(plan.rows).toEqual([]);
    expect(plan.skipped).toEqual({
      pending: 0,
      unmappedAccount: 0,
      alreadyExists: 0,
      inconsistentFetch: 0,
      malformed: 0,
      undatable: 0,
    });
  });

  it('skips a row it cannot DATE, rather than minting it into the current month', () => {
    // `posted: 0` is the spec's still-pending sentinel, and
    // `prepareSimplefinTransaction` falls back to `transacted_at` and then to TODAY.
    // That is fine for a 5-day window and a money bug across three years: an
    // undatable row would land in the CURRENT month's spending, and the oldest-first
    // cap would rank it first.
    const plan = planSimplefinHistoryBackfill(
      [
        acct('acc-1', [
          txn({ id: 'no-date', posted: 0 }),
          txn({ id: 'fallback-ok', posted: 0, transacted_at: POSTED }), // datable after all
          txn({ id: 'ok-1' }),
        ]),
      ],
      new Set(),
      MAP,
    );
    expect(refs(plan)).toEqual(['fallback-ok', 'ok-1']);
    expect(plan.skipped.undatable).toBe(1);
  });

  it('an already-stored row is counted as existing even when it is also pending', () => {
    // Reason precedence matters for the audit row: an existing row is not our
    // business whatever else is true of it, so it may not be reported as a
    // pending skip (which would read as "the feed had it and we declined it").
    const plan = planSimplefinHistoryBackfill(
      [acct('acc-1', [txn({ id: 'held', pending: true })])],
      new Set(['held']),
      MAP,
    );
    expect(plan.rows).toEqual([]);
    expect(plan.skipped.alreadyExists).toBe(1);
    expect(plan.skipped.pending).toBe(0);
  });

  it('carries each planned row to the right local account id', () => {
    const plan = planSimplefinHistoryBackfill(
      [acct('acc-1', [txn({ id: 'a' })]), acct('acc-2', [txn({ id: 'b' })])],
      new Set(),
      MAP,
    );
    expect(plan.rows.map((r) => [r.txn.id, r.accountId])).toEqual([
      ['a', 'local-1'],
      ['b', 'local-2'],
    ]);
  });

  it('is idempotent: replanning with the first plan stored yields nothing', () => {
    const accounts = [acct('acc-1', [txn({ id: 'a' }), txn({ id: 'b' })])];
    const first = planSimplefinHistoryBackfill(accounts, new Set(), MAP);
    expect(refs(first)).toEqual(['a', 'b']);
    const second = planSimplefinHistoryBackfill(accounts, new Set(refs(first)), MAP);
    expect(second.rows).toEqual([]);
  });
});
