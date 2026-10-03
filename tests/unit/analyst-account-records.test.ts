/**
 * What the app may claim to know about an account's record. Each case is one stored
 * fact and the reading it licenses — nothing is inferred from the pattern of rows.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { accountRecords, type AccountFactsInput } from '@/lib/engine/analyst/account-records';

const TODAY = isoDate('2026-10-02');
const base = (over: Partial<AccountFactsInput> = {}): AccountFactsInput => ({
  id: 'a',
  name: 'Card',
  provider: 'plaid',
  plaidItemId: 'item-1',
  feedDroppedAt: null,
  recordStartWord: null,
  recordEndWord: null,
  ...over,
});
const build = (account: AccountFactsInput, item: { lastSyncedAt: string | null; lastSyncError: string | null } | null = null) =>
  accountRecords({
    accounts: [account],
    rows: [
      { accountId: 'a', date: '2026-03-04' },
      { accountId: 'a', date: '2025-01-09' },
      { accountId: 'a', date: '2026-09-28' },
      { accountId: 'other', date: '2026-10-01' },
    ],
    spendingAccountIds: new Set(['a']),
    terminalOf: new Map(),
    plaidItems: item ? [{ itemId: 'item-1', ...item }] : [],
    today: TODAY,
  })[0]!;

describe('accountRecords', () => {
  it('first and last row come from every row of that account, in any order', () => {
    const r = build(base(), { lastSyncedAt: '2026-10-02', lastSyncError: null });
    expect([r.firstRowDate, r.lastRowDate]).toEqual(['2025-01-09', '2026-09-28']);
  });

  it("the account's own stored span widens what the trimmed rows show; a row dated after today counts for nothing", () => {
    const run = (rawSpans?: Map<string, { first: string; last: string }>, extra: { accountId: string; date: string }[] = []) =>
      accountRecords({
        accounts: [base()],
        rows: [{ accountId: 'a', date: '2026-03-04' }, ...extra],
        rawSpans,
        spendingAccountIds: new Set(['a']),
        terminalOf: new Map(),
        plaidItems: [],
        today: TODAY,
      })[0]!;
    // A combined account's boundary handed Feb 1 … Mar 3 to the other side; the record still ran then.
    const r = run(new Map([['a', { first: '2026-02-01', last: '2026-03-04' }]]));
    expect([r.firstRowDate, r.lastRowDate]).toEqual(['2026-02-01', '2026-03-04']);
    // critic cycle 1, P2-1: a hand-typed row dated December proved the record "ran to December".
    const future = run(undefined, [{ accountId: 'a', date: '2026-12-01' }]);
    expect(future.lastRowDate).toBe('2026-03-04');
    expect(run(undefined, [{ accountId: 'a', date: '2026-10-02' }]).lastRowDate).toBe('2026-10-02'); // today itself counts
  });

  it("carries the boundary's dropped ranges through, and leaves the record's own span alone", () => {
    const r = accountRecords({
      accounts: [base()],
      rows: [{ accountId: 'a', date: '2026-03-04' }],
      rawSpans: new Map([['a', { first: '2026-01-10', last: '2026-08-20' }]]),
      droppedOf: new Map([['a', [{ from: '2026-07-16', to: '9999-12-31' }]]]),
      spendingAccountIds: new Set(['a']),
      terminalOf: new Map(),
      plaidItems: [],
      today: TODAY,
    })[0]!;
    expect([r.firstRowDate, r.lastRowDate]).toEqual(['2026-01-10', '2026-08-20']);
    expect(r.dropped).toEqual([{ from: '2026-07-16', to: '9999-12-31' }]);
    // An account nothing is dropped from carries no `dropped` at all.
    expect('dropped' in build(base())).toBe(false);
  });

  it('a healthy connection vouches through the day BEFORE its last sync, never the day of it', () => {
    const r = build(base(), { lastSyncedAt: '2026-10-01', lastSyncError: null });
    expect([r.feed, r.completeThrough]).toEqual(['live', '2026-09-30']);
    // Synced on Sep 30 itself: the rest of Sep 30 is not yet on record.
    expect(build(base(), { lastSyncedAt: '2026-09-30', lastSyncError: null }).completeThrough).toBe('2026-09-29');
  });

  it('a failing connection vouches only through the day before its last SUCCESS', () => {
    const r = build(base(), { lastSyncedAt: '2026-08-15', lastSyncError: 'ITEM_LOGIN_REQUIRED' });
    expect([r.feed, r.completeThrough]).toEqual(['failing', '2026-08-14']);
  });

  it('a connection that never succeeded vouches for nothing', () => {
    expect(build(base(), { lastSyncedAt: null, lastSyncError: null }).completeThrough).toBeNull();
  });

  it('a dropped feed, a missing item, SimpleFIN and a manual account vouch for nothing', () => {
    const healthy = { lastSyncedAt: '2026-10-02', lastSyncError: null };
    for (const account of [
      base({ feedDroppedAt: '2026-04-18' }),
      base({ plaidItemId: null }),
      base({ plaidItemId: 'item-gone' }),
      base({ provider: 'simplefin', plaidItemId: null }),
      base({ provider: 'manual', plaidItemId: null }),
      base({ provider: null, plaidItemId: null }),
    ]) {
      const r = build(account, healthy);
      expect([r.feed, r.completeThrough], JSON.stringify(account)).toEqual(['none', null]);
    }
  });

  it('only a manual account is "kept by hand"', () => {
    expect(build(base({ provider: 'manual', plaidItemId: null })).handKept).toBe(true);
    expect(build(base()).handKept).toBe(false);
    expect(build(base({ provider: 'simplefin', plaidItemId: null })).handKept).toBe(false);
  });

  it('the demo dataset is the whole record: complete through today', () => {
    const r = build(base({ provider: 'demo', plaidItemId: null }));
    expect([r.feed, r.completeThrough]).toEqual(['live', TODAY]);
  });

  it('lineage follows a confirmed reconciliation; an account on its own is its own', () => {
    const [a, b] = accountRecords({
      accounts: [base({ id: 'old' }), base({ id: 'new' })],
      rows: [],
      spendingAccountIds: new Set(),
      terminalOf: new Map([['old', 'new']]),
      plaidItems: [],
      today: TODAY,
    });
    expect([a!.lineageId, b!.lineageId]).toEqual(['new', 'new']);
    expect([a!.firstRowDate, a!.everSpent]).toEqual([null, false]);
  });

  it("carries the reader's word, and treats a malformed one as no word", () => {
    const r = build(
      base({
        recordStartWord: { forDate: '2025-01-09', verdict: 'real' },
        recordEndWord: { forDate: '2026-09-28', verdict: 'missing' },
      }),
    );
    expect(r.startWord).toEqual({ forDate: '2025-01-09', verdict: 'real' });
    expect(r.endWord).toEqual({ forDate: '2026-09-28', verdict: 'missing' });
    expect(build(base({ recordEndWord: { forDate: 'soon', verdict: 'real' } })).endWord).toBeNull();
    expect(build(base({ recordEndWord: { forDate: '2026-09-28', verdict: 'maybe' } })).endWord).toBeNull();
  });
});
