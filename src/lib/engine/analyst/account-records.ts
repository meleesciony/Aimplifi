/**
 * What is known about each account's record — the facts the same-account engine
 * decides on, gathered from what the app already stores. Nothing here is inferred from
 * the pattern of rows.
 *
 *   - Lineage: a reconciliation the reader confirmed (`terminalOf`, the same map every
 *     other surface scopes combined accounts with).
 *   - First and last row: over every row the account has on record, spending or not —
 *     a paycheck on the 30th proves the record ran to the 30th. Taken from the account's
 *     OWN record, before a combined account's boundary hands some of its days to the
 *     other side (`rawSpans`): a row trimmed as the other side's duplicate still proves
 *     this record ran that far, and without it every handover would look like a hole.
 *     A row dated after today proves nothing about today and is not counted.
 *   - The feed: only a connection that is still live and whose LAST sync succeeded
 *     vouches for silence. It vouches through the day BEFORE that sync, never the day
 *     of it: the sync ran at some hour of that day, and the rest of the day is not yet
 *     on record.
 *       plaid, item healthy            → live, complete through (last sync − 1 day)
 *       plaid, last sync failed        → failing, complete through (last success − 1 day)
 *       plaid, feed dropped / no item  → none
 *       simplefin                      → none (a retired bridge: its last success says
 *                                        nothing about one account)
 *       manual                         → none, kept by hand
 *       demo                           → live through today: the seeded dataset IS the
 *                                        whole record
 *   - The reader's word about an edge, with the date it was given for.
 *
 * Pure: the caller does the reads and passes `today`.
 */
import { addDays, compareDates, isoDate, type ISODate } from '@/lib/dates';
import type { AccountRecord, EdgeWord } from './same-account';

export interface AccountFactsInput {
  id: string;
  /** The label the reader sees for this account. */
  name: string;
  provider: string | null;
  plaidItemId: string | null;
  /** YYYY-MM-DD the bank stopped sharing this account, else null. */
  feedDroppedAt: string | null;
  recordStartWord: { forDate: string; verdict: string } | null;
  recordEndWord: { forDate: string; verdict: string } | null;
}

export interface PlaidItemFacts {
  itemId: string;
  /** YYYY-MM-DD of the last SUCCESSFUL sync, else null. */
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

function wordOf(w: { forDate: string; verdict: string } | null): EdgeWord | null {
  if (!w || (w.verdict !== 'real' && w.verdict !== 'missing')) return null;
  try {
    return { forDate: isoDate(w.forDate), verdict: w.verdict };
  } catch {
    return null; // a malformed stored date is no word at all
  }
}

function dayBefore(date: string | null): ISODate | null {
  if (!date) return null;
  try {
    return addDays(isoDate(date), -1);
  } catch {
    return null;
  }
}

export function accountRecords(input: {
  accounts: readonly AccountFactsInput[];
  /** Every row on record: the account it belongs to and its date. */
  rows: readonly { accountId: string; date: string }[];
  /**
   * Each account's first and last row in its own stored record, before any combined
   * account's boundary trimmed it (and capped at today by the reader of the store).
   * Optional: when absent, `rows` are the record.
   */
  rawSpans?: ReadonlyMap<string, { first: string; last: string }>;
  /**
   * For each account a combined-account link touches, the date ranges its rows are NOT
   * kept in (`reconciliationDroppedRanges` — the boundary's own rule). Absent = all kept.
   */
  droppedOf?: ReadonlyMap<string, readonly { from: string; to: string }[]>;
  /** Ids of accounts that have at least one spending row, by the app's own predicate. */
  spendingAccountIds: ReadonlySet<string>;
  /** Predecessor id → the live account that carries it on. Absent = its own lineage. */
  terminalOf: ReadonlyMap<string, string>;
  plaidItems: readonly PlaidItemFacts[];
  today: ISODate;
}): AccountRecord[] {
  const span = new Map<string, { first: ISODate; last: ISODate }>();
  const note = (accountId: string, date: string) => {
    const d = date as ISODate;
    if (compareDates(d, input.today) > 0) return; // a future-dated row is no proof of anything yet
    const s = span.get(accountId);
    if (!s) span.set(accountId, { first: d, last: d });
    else {
      if (compareDates(d, s.first) < 0) s.first = d;
      if (compareDates(d, s.last) > 0) s.last = d;
    }
  };
  for (const r of input.rows) note(r.accountId, r.date);
  for (const [accountId, raw] of input.rawSpans ?? []) {
    note(accountId, raw.first);
    note(accountId, raw.last);
  }
  const items = new Map(input.plaidItems.map((i) => [i.itemId, i]));

  return input.accounts.map((a) => {
    let feed: AccountRecord['feed'] = 'none';
    let completeThrough: ISODate | null = null;
    if (a.provider === 'demo') {
      feed = 'live';
      completeThrough = input.today;
    } else if (a.provider === 'plaid' && !a.feedDroppedAt && a.plaidItemId) {
      const item = items.get(a.plaidItemId);
      if (item) {
        feed = item.lastSyncError ? 'failing' : 'live';
        completeThrough = dayBefore(item.lastSyncedAt);
      }
    }
    const s = span.get(a.id);
    const dropped = input.droppedOf?.get(a.id)?.map((d) => ({ from: d.from as ISODate, to: d.to as ISODate }));
    return {
      id: a.id,
      name: a.name,
      lineageId: input.terminalOf.get(a.id) ?? a.id,
      firstRowDate: s?.first ?? null,
      lastRowDate: s?.last ?? null,
      ...(dropped && dropped.length > 0 ? { dropped } : {}),
      completeThrough,
      feed,
      startWord: wordOf(a.recordStartWord),
      endWord: wordOf(a.recordEndWord),
      everSpent: input.spendingAccountIds.has(a.id),
      handKept: a.provider === 'manual',
    };
  });
}
