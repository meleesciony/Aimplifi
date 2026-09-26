/**
 * O.11d — free-form tags: the naming contract, the filter axis, and the tag total.
 *
 * The money half deliberately has NO arithmetic of its own. A tag total IS
 * `summarizeTransactions` over the tag-filtered rows — the same function the
 * unfiltered summary strip uses — so what these tests lock is that the tag axis
 * composes with every gate that function applies: transfers never count, excluded
 * rows stay listed but leave the figures (the O.11c lesson: three figures down,
 * `count` up — a tag total is not a special case of that rule, it IS that rule),
 * and the hand-over flag counts only summed rows.
 *
 * Hand-verified values: tests/edge-cases/tags-tag-axis-and-total-o-11d.md
 */
import { describe, expect, it } from 'vitest';
import {
  filterTransactions,
  summarizeTransactions,
  type TxnView,
} from '@/lib/engine/transactions/query';
import {
  MAX_TAG_NAME,
  normalizeTagName,
  sortTagsForDisplay,
  tagNameLength,
  validateTagName,
} from '@/lib/engine/transactions/tags';

describe('normalizeTagName / validateTagName (the naming contract)', () => {
  it('trims and collapses internal whitespace — " Work  Trip " is one tag, not three', () => {
    expect(normalizeTagName('  Work   Trip \t')).toBe('Work Trip');
  });

  it('strips the invisible characters that make two chips pixel-identical (the category rules, reused)', () => {
    // U+200B zero-width space; U+202E right-to-left override. Both survive a naive
    // trim() and are byte-different while rendering the same.
    expect(normalizeTagName('Work\u200BTrip')).toBe('WorkTrip');
    expect(normalizeTagName('Work\u202ETrip')).toBe('WorkTrip');
  });

  it('refuses a name that normalizes to nothing — the empty path has ONE sentence', () => {
    expect(validateTagName('   ')).toEqual({ error: 'Give the tag a name.' });
    expect(validateTagName('\u200B')).toEqual({ error: 'Give the tag a name.' });
  });

  it('counts the cap in CODE POINTS: 40 CJK pass, 40 emoji pass, 41 of either refuse', () => {
    const cjk = '旅'.repeat(MAX_TAG_NAME);
    const emoji = '😀'.repeat(MAX_TAG_NAME); // surrogate PAIRS: 80 UTF-16 units, 40 code points
    expect(tagNameLength(cjk)).toBe(MAX_TAG_NAME);
    expect(validateTagName(cjk)).toEqual({ name: cjk });
    expect(validateTagName(emoji)).toEqual({ name: emoji });
    expect(validateTagName('旅'.repeat(MAX_TAG_NAME + 1))).toEqual({
      error: `Keep the name to ${MAX_TAG_NAME} characters.`,
    });
    expect(validateTagName('😀'.repeat(MAX_TAG_NAME + 1))).toEqual({
      error: `Keep the name to ${MAX_TAG_NAME} characters.`,
    });
  });
});

describe('sortTagsForDisplay', () => {
  it('orders by code point, never mutates the input, and is locale-independent', () => {
    const input = [
      { id: 'z', name: 'beta' },
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'apple' },
    ];
    // Code-point order puts uppercase before lowercase — the deterministic promise
    // `localeCompare` cannot make across locales.
    expect(sortTagsForDisplay(input)).toEqual([
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'apple' },
      { id: 'z', name: 'beta' },
    ]);
    expect(input.map((t) => t.id)).toEqual(['z', 'a', 'b']);
  });
});

/**
 * Fixture. Hand-verified cents: tests/edge-cases/tags-tag-axis-and-total-o-11d.md.
 * Every row states its tags, because `tags` is REQUIRED and a fixture defaulting
 * it to [] would hide the axis under test.
 *
 *  t1   -$12.50  Checking, tags [trip]
 *  t2   -$45.00  Checking, tags [trip, night-out]
 *  t3   -$80.00  Checking, tags []                     ← untagged
 *  t4 -$1500.00  Amex,     tags [trip], EXCLUDED       ← leaves the figures, stays listed
 *  t5 +$5000.00  Checking, tags [trip], TRANSFER        ← never income or expense
 *  t6   +$20.00  Checking, tags [night-out]            ← refund, inflow
 *  t7   -$30.00  Checking, tags [night-out], NEEDS REVIEW (uncategorized)
 */
function tagged(over: Partial<TxnView> & Pick<TxnView, 'id' | 'date' | 'amountCents'>): TxnView {
  return {
    accountId: 'acct-A',
    accountName: 'Everyday Checking',
    merchantName: 'Test Merchant',
    payeeRenamed: false,
    rawDescriptor: 'TEST',
    needsReview: false,
    categoryId: 'shopping',
    categoryName: 'Shopping',
    note: null,
    taxClass: null,
    status: 'POSTED',
    descriptorOrigin: 'bank',
    isTransfer: false,
    onHandoverDay: false,
    provenance: { kind: 'merchant-default', label: 'Known merchant', needsConfirm: false },
    excludeFromTotals: false,
    reimbursement: null,
    tags: [],
    splitParentId: null,
    suggestion: null,
    spendClass: 'guilt-free',
    spendClassReaderSet: false,
    ...over,
  };
}

const TRIP = 'tag-trip';
const NIGHT = 'tag-night';

const ROWS: TxnView[] = [
  tagged({ id: 't1', date: '2026-06-02', amountCents: -1250, tags: [{ id: TRIP, name: 'trip' }] }),
  tagged({
    id: 't2',
    date: '2026-06-04',
    amountCents: -4500,
    accountId: 'acct-B',
    accountName: 'Amex Gold',
    tags: [
      { id: TRIP, name: 'trip' },
      { id: NIGHT, name: 'night-out' },
    ],
  }),
  tagged({ id: 't3', date: '2026-06-05', amountCents: -8000 }),
  tagged({
    id: 't4',
    date: '2026-06-06',
    amountCents: -150000,
    accountId: 'acct-B',
    accountName: 'Amex Gold',
    tags: [{ id: TRIP, name: 'trip' }],
    excludeFromTotals: true,
  }),
  tagged({
    id: 't5',
    date: '2026-06-07',
    amountCents: 500000,
    isTransfer: true,
    categoryId: 'transfer',
    categoryName: 'Transfer',
    tags: [{ id: TRIP, name: 'trip' }],
  }),
  tagged({ id: 't6', date: '2026-06-08', amountCents: 2000, tags: [{ id: NIGHT, name: 'night-out' }] }),
  tagged({
    id: 't7',
    date: '2026-06-09',
    amountCents: -3000,
    needsReview: true,
    categoryId: 'uncategorized',
    categoryName: 'Uncategorized',
    tags: [{ id: NIGHT, name: 'night-out' }],
  }),
];

describe('filterTransactions — the tag axis', () => {
  it('keeps exactly the rows carrying the tag', () => {
    expect(filterTransactions(ROWS, { tag: TRIP }).map((t) => t.id)).toEqual(['t1', 't2', 't4', 't5']);
    expect(filterTransactions(ROWS, { tag: NIGHT }).map((t) => t.id)).toEqual(['t2', 't6', 't7']);
  });

  it('an absent or null tag is the axis OFF — the untagged row still shows', () => {
    expect(filterTransactions(ROWS, {}).some((t) => t.id === 't3')).toBe(true);
    expect(filterTransactions(ROWS, { tag: null }).some((t) => t.id === 't3')).toBe(true);
  });

  it('a stale or foreign tag id matches NOTHING (visible empty, never a wrong subset)', () => {
    expect(filterTransactions(ROWS, { tag: 'tag-deleted-or-foreign' })).toEqual([]);
  });

  it('composes with the other axes (AND, like every axis here)', () => {
    expect(filterTransactions(ROWS, { tag: TRIP, accountId: 'acct-B' }).map((t) => t.id)).toEqual(['t2', 't4']);
    expect(filterTransactions(ROWS, { tag: NIGHT, unclassified: true }).map((t) => t.id)).toEqual(['t7']);
    // type=income keeps only the tagged NON-transfer positive (t5 is a transfer,
    // so the flow axis drops it — the tag axis never overrides the type matcher).
    expect(filterTransactions(ROWS, { tag: NIGHT, type: 'income' }).map((t) => t.id)).toEqual(['t6']);
    // And the transfer shows up exactly where its own axis puts it.
    expect(filterTransactions(ROWS, { tag: TRIP, type: 'transfer' }).map((t) => t.id)).toEqual(['t5']);
  });
});

describe('the tag total — summarizeTransactions over the tag-filtered set', () => {
  it('trip: $57.50 out, transfers never in, the excluded row listed but out of the figures', () => {
    const s = summarizeTransactions(filterTransactions(ROWS, { tag: TRIP }));
    // Hand-verified: -12.50 + -45.00 = -$57.50 outflow. t4 (−$1,500) is excluded —
    // LISTED (count 4) but nowhere in the money. t5 (+$5,000) is a transfer — never
    // income. net = outflow = -57.50, inflow 0. count counts the rows, excludedCount
    // names the one the figures dropped. This is the shared basis (the O.11c rule:
    // figures down, count up) with no tag-specific branch anywhere.
    expect(s).toMatchObject({ count: 4, excludedCount: 1, inflowCents: 0, outflowCents: 5750, netCents: -5750 });
  });

  it('night-out: the refund is inflow, the uncategorized row still counts', () => {
    const s = summarizeTransactions(filterTransactions(ROWS, { tag: NIGHT }));
    // -45.00 + -30.00 = -75.00 out; +20.00 refund in; net -$55.00; nothing excluded.
    expect(s).toMatchObject({ count: 3, excludedCount: 0, inflowCents: 2000, outflowCents: 7500, netCents: -5500 });
  });

  it('an unknown tag totals to visible zeros, not to the unfiltered total', () => {
    const s = summarizeTransactions(filterTransactions(ROWS, { tag: 'tag-ghost' }));
    expect(s).toMatchObject({ count: 0, inflowCents: 0, outflowCents: 0, netCents: 0, excludedCount: 0 });
  });
});
