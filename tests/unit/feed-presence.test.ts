/**
 * `reconcileFeedPresence` — deciding when a bank has STOPPED sharing an account (TASKS L.14).
 *
 * ABSTENTION FIRST, and in the majority, for the same reason every other identity engine in this
 * repo is written that way: the two mistakes cost wildly different amounts. A MISSED drop leaves
 * the row exactly as the app has always left it — stale, still counted, the bug being fixed. A
 * FALSE drop pulls a real account out of somebody's net worth and cash-needed on the strength of
 * one bad HTTP response. So every `skip` test below is load-bearing: it is the engine refusing to
 * act on a payload it cannot prove is a complete census of the connection.
 *
 * The precedent being followed is #290, where a truncated `/investments/holdings/get` body pruned
 * positions the user still held, and the fix was "prune only on a clean run".
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import {
  reconcileFeedPresence,
  type FeedPresenceRow,
} from '@/lib/engine/account/feed-presence';

const TODAY = isoDate('2026-07-25');

function row(over: Partial<FeedPresenceRow> = {}): FeedPresenceRow {
  return { id: 'row-checking', providerRef: 'plaid-acc-1', feedDroppedAt: null, ...over };
}

describe('reconcileFeedPresence — refusing to act on a payload it cannot trust', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an object', { accounts: [] }],
    ['a string', 'plaid-acc-1'],
    ['a number', 3],
  ])('skips when the account list is %s — a body that carried no list says nothing', (_label, payload) => {
    const d = reconcileFeedPresence([row()], payload, TODAY);
    expect(d).toEqual({ kind: 'skip', reason: 'payload-not-an-array' });
  });

  it('skips an EMPTY list rather than dropping every account at once', () => {
    // "The bank returned nothing" is overwhelmingly more likely to be an error state than "the
    // user unticked all four accounts in one sitting", and mass-dropping a whole net worth on one
    // response is the most expensive mistake this engine can make.
    const d = reconcileFeedPresence([row(), row({ id: 'row-savings', providerRef: 'plaid-acc-2' })], [], TODAY);
    expect(d).toEqual({ kind: 'skip', reason: 'payload-empty' });
  });

  it.each([
    ['a null id', null],
    ['an undefined id', undefined],
    ['a numeric id', 7],
    ['an empty-string id', ''],
    ['an object id', {}],
  ])('skips the WHOLE run when one entry is %s, sparing its readable neighbours', (_label, bad) => {
    // The damaged entry might BE the row we are about to drop. A list with a hole in it is not a
    // census, so no absence in it is evidence — including for the entries that read fine.
    const rows = [row(), row({ id: 'row-savings', providerRef: 'plaid-acc-2' })];
    const d = reconcileFeedPresence(rows, ['plaid-acc-1', bad], TODAY);
    expect(d).toEqual({ kind: 'skip', reason: 'payload-unreadable-entry' });
  });
});

describe('reconcileFeedPresence — a row the feed no longer returns', () => {
  it('stamps a row the connection stopped returning', () => {
    const rows = [row(), row({ id: 'row-savings', providerRef: 'plaid-acc-2' })];
    const d = reconcileFeedPresence(rows, ['plaid-acc-1'], TODAY);
    expect(d).toEqual({ kind: 'reconcile', drop: ['row-savings'], restore: [], droppedAt: TODAY });
  });

  it('leaves an already-stamped row alone — the FIRST date is the truthful one', () => {
    // The disclosure says when sharing stopped. Re-stamping on every sync would turn a fixed fact
    // about the past into a date that walks forward forever.
    const rows = [row({ id: 'row-savings', providerRef: 'plaid-acc-2', feedDroppedAt: '2026-07-01' })];
    const d = reconcileFeedPresence(rows, ['plaid-acc-1'], TODAY);
    expect(d).toEqual({ kind: 'reconcile', drop: [], restore: [], droppedAt: TODAY });
  });

  it('never drops a row with no provider id — its absence is a fact about our row, not the bank', () => {
    const rows = [row({ id: 'row-manualish', providerRef: null })];
    const d = reconcileFeedPresence(rows, ['plaid-acc-9'], TODAY);
    expect(d).toEqual({ kind: 'reconcile', drop: [], restore: [], droppedAt: TODAY });
  });

  it('never drops a row whose provider id is the empty string', () => {
    const rows = [row({ id: 'row-blank', providerRef: '' })];
    const d = reconcileFeedPresence(rows, ['plaid-acc-9'], TODAY);
    expect(d).toEqual({ kind: 'reconcile', drop: [], restore: [], droppedAt: TODAY });
  });

  it('stamps with the date it was given, not one it derived', () => {
    const other = isoDate('2027-01-02');
    const d = reconcileFeedPresence([row({ providerRef: 'gone' })], ['plaid-acc-1'], other);
    expect(d).toMatchObject({ drop: ['row-checking'], droppedAt: other });
  });
});

describe('reconcileFeedPresence — a row that comes back', () => {
  it('clears the stamp when the connection returns the account again (the re-tick)', () => {
    const rows = [row({ feedDroppedAt: '2026-07-01' })];
    const d = reconcileFeedPresence(rows, ['plaid-acc-1'], TODAY);
    expect(d).toEqual({ kind: 'reconcile', drop: [], restore: ['row-checking'], droppedAt: TODAY });
  });

  it('restores and drops in the same run without confusing the two', () => {
    const rows = [
      row({ id: 'row-back', providerRef: 'plaid-acc-1', feedDroppedAt: '2026-07-01' }),
      row({ id: 'row-gone', providerRef: 'plaid-acc-2', feedDroppedAt: null }),
      row({ id: 'row-steady', providerRef: 'plaid-acc-3', feedDroppedAt: null }),
    ];
    const d = reconcileFeedPresence(rows, ['plaid-acc-1', 'plaid-acc-3'], TODAY);
    expect(d).toEqual({
      kind: 'reconcile',
      drop: ['row-gone'],
      restore: ['row-back'],
      droppedAt: TODAY,
    });
  });

  it('is a no-op when every row is present and none was ever dropped', () => {
    const rows = [row(), row({ id: 'row-savings', providerRef: 'plaid-acc-2' })];
    const d = reconcileFeedPresence(rows, ['plaid-acc-1', 'plaid-acc-2'], TODAY);
    expect(d).toEqual({ kind: 'reconcile', drop: [], restore: [], droppedAt: TODAY });
  });

  it('tolerates a connection with no stored rows at all (first link)', () => {
    const d = reconcileFeedPresence([], ['plaid-acc-1'], TODAY);
    expect(d).toEqual({ kind: 'reconcile', drop: [], restore: [], droppedAt: TODAY });
  });

  it('tolerates a repeated id in the payload without restoring twice', () => {
    const rows = [row({ feedDroppedAt: '2026-07-01' })];
    const d = reconcileFeedPresence(rows, ['plaid-acc-1', 'plaid-acc-1'], TODAY);
    expect(d).toMatchObject({ restore: ['row-checking'] });
  });
});
