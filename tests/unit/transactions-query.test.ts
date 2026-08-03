import { describe, expect, it } from 'vitest';
import {
  type AccountView,
  type TxnView,
  countUnclassified,
  filterTransactions,
  groupAccounts,
  isLiabilityType,
  isUnclassifiedTxn,
  paginate,
  sortByDateDesc,
  summarizeTransactions,
} from '@/lib/engine/transactions/query';

describe('paginate (register pagination, ROADMAP #8)', () => {
  const rows = Array.from({ length: 250 }, (_, i) => i); // 0..249

  it('returns a full first page with correct page info', () => {
    const { items, info } = paginate(rows, 1, 100);
    expect(items).toHaveLength(100);
    expect(items[0]).toBe(0);
    expect(info).toEqual({ page: 1, pageSize: 100, pageCount: 3, total: 250, fromIndex: 1, toIndex: 100 });
  });

  it('returns the partial last page', () => {
    const { items, info } = paginate(rows, 3, 100);
    expect(items).toHaveLength(50); // 201..250
    expect(items[0]).toBe(200);
    expect(info).toMatchObject({ page: 3, pageCount: 3, fromIndex: 201, toIndex: 250 });
  });

  it('clamps an out-of-range page into [1, pageCount]', () => {
    expect(paginate(rows, 99, 100).info.page).toBe(3);
    expect(paginate(rows, 0, 100).info.page).toBe(1);
    expect(paginate(rows, -5, 100).info.page).toBe(1);
  });

  it('handles an empty list gracefully', () => {
    const { items, info } = paginate([], 1, 100);
    expect(items).toHaveLength(0);
    expect(info).toEqual({ page: 1, pageSize: 100, pageCount: 1, total: 0, fromIndex: 0, toIndex: 0 });
  });
});

/**
 * Fixture: 6 transactions across 2 accounts. Hand-verified totals below.
 *  t1 +$5,000.00 income  (Checking, 06-01)
 *  t2  -$12.50  dining   (Checking, 06-02, "SQ *BLUE BOTTLE")
 *  t3  -$80.00  groceries(Checking, 06-03)
 *  t4  -$45.00  dining   (Amex,     06-04)
 *  t5 -$1,000.00 transfer(Checking, 06-05, isTransfer)
 *  t6  +$20.00  shopping (Checking, 06-06, refund)
 */
function txn(over: Partial<TxnView> & Pick<TxnView, 'id' | 'date' | 'amountCents'>): TxnView {
  return {
    accountId: 'acct-A',
    accountName: 'Everyday Checking',
    merchantName: 'Test Merchant',
    rawDescriptor: 'TEST',
    // Default: a decided row. The unclassified tests below override it, so the
    // fixture never silently supplies the state under test.
    needsReview: false,
    categoryId: 'shopping',
    categoryName: 'Shopping',
    note: null,
    taxClass: null,
    status: 'POSTED',
    descriptorOrigin: 'bank',
    isTransfer: false,
    provenance: { kind: 'merchant-default', label: 'Known merchant', needsConfirm: false },
    excludeFromTotals: false,
    reimbursement: null,
    splitParentId: null,
    suggestion: null,
    spendClass: 'guilt-free',
    ...over,
  };
}

const ROWS: TxnView[] = [
  txn({ id: 't1', date: '2026-06-01', amountCents: 500000, categoryId: 'income', categoryName: 'Income', merchantName: 'Acme Payroll', rawDescriptor: 'ACME PAYROLL DIRECT DEP' }),
  txn({ id: 't2', date: '2026-06-02', amountCents: -1250, categoryId: 'dining', categoryName: 'Dining Out', merchantName: 'Blue Bottle Coffee', rawDescriptor: 'SQ *BLUE BOTTLE 0042' }),
  txn({ id: 't3', date: '2026-06-03', amountCents: -8000, categoryId: 'groceries', categoryName: 'Groceries', merchantName: 'Kroger' }),
  txn({ id: 't4', date: '2026-06-04', amountCents: -4500, accountId: 'acct-B', accountName: 'Amex Gold', categoryId: 'dining', categoryName: 'Dining Out', merchantName: 'The Optimist' }),
  txn({ id: 't5', date: '2026-06-05', amountCents: -100000, isTransfer: true, categoryId: 'transfer', categoryName: 'Transfer', merchantName: 'Transfer to Savings' }),
  txn({ id: 't6', date: '2026-06-06', amountCents: 2000, categoryId: 'shopping', categoryName: 'Shopping', merchantName: 'Amazon', rawDescriptor: 'AMZN Mktp US*REFUND' }),
];

describe('summarizeTransactions — totals exclude transfers', () => {
  it('sums all rows to the cent', () => {
    const s = summarizeTransactions(ROWS);
    expect(s.count).toBe(6);
    expect(s.inflowCents).toBe(502000); // 500000 + 2000
    expect(s.outflowCents).toBe(13750); // 1250 + 8000 + 4500
    expect(s.netCents).toBe(488250); // 502000 - 13750
  });

  it('a positive-amount transfer is NOT counted as income', () => {
    const s = summarizeTransactions([
      txn({ id: 'x', date: '2026-06-10', amountCents: 250000, isTransfer: true }),
    ]);
    expect(s.inflowCents).toBe(0);
    expect(s.outflowCents).toBe(0);
    expect(s.netCents).toBe(0);
    expect(s.count).toBe(1);
  });
});

describe('filterTransactions', () => {
  it('type=expense returns only non-transfer outflows', () => {
    const out = filterTransactions(ROWS, { type: 'expense' });
    expect(out.map((t) => t.id)).toEqual(['t2', 't3', 't4']);
    const s = summarizeTransactions(out);
    expect(s.outflowCents).toBe(13750);
    expect(s.inflowCents).toBe(0);
    expect(s.netCents).toBe(-13750);
  });

  it('type=income returns only non-transfer inflows', () => {
    const out = filterTransactions(ROWS, { type: 'income' });
    expect(out.map((t) => t.id)).toEqual(['t1', 't6']);
  });

  it('type=transfer returns only transfers', () => {
    const out = filterTransactions(ROWS, { type: 'transfer' });
    expect(out.map((t) => t.id)).toEqual(['t5']);
  });

  it('filters by category', () => {
    const out = filterTransactions(ROWS, { categoryId: 'dining' });
    expect(out.map((t) => t.id)).toEqual(['t2', 't4']);
    expect(summarizeTransactions(out).outflowCents).toBe(5750);
  });

  // W.7 — Fixed / Discretionary heading → every transaction under that class.
  it('filters by spendClass (Fixed vs Discretionary)', () => {
    const mixed = [
      txn({ id: 'f1', date: '2026-06-02', amountCents: -8000, categoryId: 'groceries', spendClass: 'fixed' }),
      txn({ id: 'g1', date: '2026-06-03', amountCents: -4500, categoryId: 'dining', spendClass: 'guilt-free' }),
      txn({ id: 'x1', date: '2026-06-04', amountCents: -100000, isTransfer: true, spendClass: 'out-of-scope' }),
    ];
    expect(filterTransactions(mixed, { spendClass: 'fixed' }).map((t) => t.id)).toEqual(['f1']);
    expect(filterTransactions(mixed, { spendClass: 'guilt-free' }).map((t) => t.id)).toEqual(['g1']);
    // Absent / null must be a no-op — same failure direction as unclassified.
    expect(filterTransactions(mixed, {}).length).toBe(3);
    expect(filterTransactions(mixed, { spendClass: null }).length).toBe(3);
  });

  // Owner request 2026-07-27: "make it easier to see unclassified items in activity".
  // The register had no control for this at all — and the category dropdown could
  // never have supplied one, because the 'uncategorized' placeholder is deliberately
  // stripped from every assignable list.
  describe('the unclassified filter (owner request 2026-07-27)', () => {
    // THE UNION IS THE POINT: these are provably different populations here. A row
    // can sit in 'uncategorized' without ever being flagged (backfill.ts unions all
    // three states, and tests/unit/backfill.test.ts locks exactly that divergence),
    // so a filter reading either one alone would hide the other — the same "work I
    // cannot see" the request is about.
    const flaggedOnly = txn({ id: 'u1', date: '2026-06-07', amountCents: -500, needsReview: true });
    const placeholderOnly = txn({ id: 'u2', date: '2026-06-08', amountCents: -600, categoryId: 'uncategorized' });
    const both = txn({ id: 'u3', date: '2026-06-09', amountCents: -700, needsReview: true, categoryId: 'uncategorized' });
    const rows = [...ROWS, flaggedOnly, placeholderOnly, both];

    it('finds a flagged row, a placeholder row, and one that is both — and nothing else', () => {
      expect(filterTransactions(rows, { unclassified: true }).map((t) => t.id).sort()).toEqual(['u1', 'u2', 'u3']);
      // FAIL-OLD in the direction that matters: reading `needsReview` alone would
      // drop u2, reading the category alone would drop u1.
      expect(rows.filter((t) => t.needsReview).map((t) => t.id)).toEqual(['u1', 'u3']);
      expect(rows.filter((t) => t.categoryId === 'uncategorized').map((t) => t.id)).toEqual(['u2', 'u3']);
    });

    it('is off by default and composes with the other filters rather than replacing them', () => {
      // Absent/false must be a no-op: a filter that silently narrows when unset
      // would hide decided rows from every existing caller.
      expect(filterTransactions(rows, {}).length).toBe(rows.length);
      expect(filterTransactions(rows, { unclassified: false }).length).toBe(rows.length);
      // AND semantics with an unrelated axis (u1 is on acct-A, u2/u3 too — narrow by date).
      expect(
        filterTransactions(rows, { unclassified: true, from: '2026-06-08' }).map((t) => t.id).sort(),
      ).toEqual(['u2', 'u3']);
      // It is a different axis from `type`: every one of these is an expense, so
      // type='income' plus unclassified is legitimately empty, not a bug.
      expect(filterTransactions(rows, { unclassified: true, type: 'income' })).toEqual([]);
    });

    it('isUnclassifiedTxn is the ONE question, so a count and a filter cannot drift', () => {
      expect(isUnclassifiedTxn(flaggedOnly)).toBe(true);
      expect(isUnclassifiedTxn(placeholderOnly)).toBe(true);
      expect(isUnclassifiedTxn(both)).toBe(true);
      // A decided row is not unclassified merely for being a transfer or pending.
      expect(isUnclassifiedTxn(txn({ id: 'd1', date: '2026-06-10', amountCents: -100, isTransfer: true }))).toBe(false);
      expect(rows.filter(isUnclassifiedTxn).length).toBe(
        filterTransactions(rows, { unclassified: true }).length,
      );
    });

    // The count is the button's PROMISE, and pressing the button is how the promise
    // is kept — so the only defensible count is the size of the set the press
    // produces. Counting over the unfiltered register printed a global figure onto a
    // filtered view: the control read "16" while pressing it yielded one row, and
    // under a category filter it read "16" directly above "No transactions match
    // these filters". Not an edge case — O.5's `categoryRegisterHref` sends readers
    // into this register pre-filtered by category AND month.
    it('countUnclassified equals what pressing the control actually delivers, under every other filter', () => {
      // The whole point: a narrowing filter must move the COUNT too.
      const windowed = { from: '2026-06-08' };
      expect(countUnclassified(rows, windowed)).toBe(2); // u2, u3 — NOT the global 3
      expect(countUnclassified(rows, windowed)).toBe(
        filterTransactions(rows, { ...windowed, unclassified: true }).length,
      );

      // The self-contradiction case: a filter that admits no unclassified row must
      // report zero, so the control can never sit above an empty list claiming rows.
      expect(countUnclassified(rows, { type: 'income' })).toBe(0);
      expect(countUnclassified(rows, { categoryId: 'dining' })).toBe(0);

      // FAIL-OLD: the pre-fix expression ignored the filter and would answer 3 to
      // all three of the assertions above.
      expect(rows.filter(isUnclassifiedTxn).length).toBe(3);

      // ...while still not collapsing to the page's own length once the control is
      // ON — dropping the `unclassified` axis is what keeps it legible from inside.
      expect(countUnclassified(rows, { ...windowed, unclassified: true })).toBe(
        countUnclassified(rows, windowed),
      );

      // Unfiltered, the new basis and the old one agree — so this is a fix to the
      // filtered case only, not a change to what the reader normally sees.
      expect(countUnclassified(rows, {})).toBe(rows.filter(isUnclassifiedTxn).length);
    });
  });

  it('filters by account', () => {
    const out = filterTransactions(ROWS, { accountId: 'acct-B' });
    expect(out.map((t) => t.id)).toEqual(['t4']);
  });

  it('search matches merchant, raw descriptor, or category (case-insensitive)', () => {
    expect(filterTransactions(ROWS, { search: 'blue bottle' }).map((t) => t.id)).toEqual(['t2']);
    expect(filterTransactions(ROWS, { search: 'AMZN' }).map((t) => t.id)).toEqual(['t6']);
    expect(filterTransactions(ROWS, { search: 'dining' }).map((t) => t.id)).toEqual(['t2', 't4']);
  });

  it('filters by inclusive date range', () => {
    const out = filterTransactions(ROWS, { from: '2026-06-03', to: '2026-06-05' });
    expect(out.map((t) => t.id)).toEqual(['t3', 't4', 't5']);
  });

  it('combines filters (AND semantics)', () => {
    const out = filterTransactions(ROWS, { type: 'expense', accountId: 'acct-A', categoryId: 'dining' });
    expect(out.map((t) => t.id)).toEqual(['t2']);
  });

  it('empty/whitespace search is a no-op', () => {
    expect(filterTransactions(ROWS, { search: '   ' })).toHaveLength(6);
  });

  // Merchant Pattern Lens filter (DECISIONS #250): EXACT case-insensitive match.
  it('merchant filter matches the canonical name exactly, case-insensitively', () => {
    expect(filterTransactions(ROWS, { merchant: 'blue bottle coffee' }).map((t) => t.id)).toEqual(['t2']);
    expect(filterTransactions(ROWS, { merchant: 'Blue Bottle Coffee' }).map((t) => t.id)).toEqual(['t2']);
  });

  it('merchant filter is never a substring match', () => {
    expect(filterTransactions(ROWS, { merchant: 'Blue Bottle' })).toHaveLength(0);
    expect(filterTransactions(ROWS, { merchant: 'Amazon Fresh' })).toHaveLength(0);
  });

  it('merchant filter composes with other filters; empty/whitespace is a no-op', () => {
    expect(
      filterTransactions(ROWS, { merchant: 'Blue Bottle Coffee', type: 'income' }),
    ).toHaveLength(0);
    expect(filterTransactions(ROWS, { merchant: '  ' })).toHaveLength(6);
  });
});

describe('sortByDateDesc', () => {
  it('orders most-recent first, stable id tiebreak for same-day rows', () => {
    const sameDay: TxnView[] = [
      txn({ id: 'b', date: '2026-06-01', amountCents: -100 }),
      txn({ id: 'a', date: '2026-06-01', amountCents: -200 }),
      txn({ id: 'c', date: '2026-06-02', amountCents: -300 }),
    ];
    expect(sortByDateDesc(sameDay).map((t) => t.id)).toEqual(['c', 'b', 'a']);
  });

  it('test_regression__pending_stays_at_top_until_cleared', () => {
    // Mint / Simplifi: uncleared charges pin to the top of Activity, not under
    // an older authorization date below today's posted rows.
    const mixed: TxnView[] = [
      txn({ id: 'posted-today', date: '2026-08-03', amountCents: -100, status: 'POSTED' }),
      txn({ id: 'pending-old', date: '2026-08-01', amountCents: -5500, status: 'PENDING' }),
      txn({ id: 'pending-new', date: '2026-08-02', amountCents: -4000, status: 'PENDING' }),
      txn({ id: 'posted-mid', date: '2026-08-02', amountCents: -200, status: 'POSTED' }),
    ];
    expect(sortByDateDesc(mixed).map((t) => t.id)).toEqual([
      'pending-new',
      'pending-old',
      'posted-today',
      'posted-mid',
    ]);
  });
});

describe('groupAccounts — assets, liabilities, net worth', () => {
  const accounts: AccountView[] = [
    { id: 'a', name: 'Everyday Checking', type: 'CHECKING', mask: '1234', currentBalanceCents: 1234567 },
    { id: 's', name: 'Emergency Savings', type: 'SAVINGS', mask: '5678', currentBalanceCents: 5000000 },
    { id: 'i', name: 'Brokerage', type: 'INVESTMENT', mask: null, currentBalanceCents: 10000000 },
    { id: 'c', name: 'Amex Gold', type: 'CREDIT', mask: '9999', currentBalanceCents: 250000 },
    { id: 'l', name: 'Auto Loan', type: 'LOAN', mask: null, currentBalanceCents: 1500000 },
  ];

  it('splits and subtotals to the cent', () => {
    const g = groupAccounts(accounts);
    expect(g.assets.accounts.map((a) => a.id)).toEqual(['a', 's', 'i']);
    expect(g.liabilities.accounts.map((a) => a.id)).toEqual(['c', 'l']);
    expect(g.assets.subtotalCents).toBe(16234567); // 1234567 + 5000000 + 10000000
    expect(g.liabilities.subtotalCents).toBe(1750000); // 250000 + 1500000
    expect(g.netWorthCents).toBe(14484567); // 16234567 - 1750000
  });

  it('classifies CREDIT and LOAN as liabilities, everything else as assets', () => {
    expect(isLiabilityType('CREDIT')).toBe(true);
    expect(isLiabilityType('LOAN')).toBe(true);
    expect(isLiabilityType('CHECKING')).toBe(false);
    expect(isLiabilityType('SAVINGS')).toBe(false);
    expect(isLiabilityType('INVESTMENT')).toBe(false);
  });

  it('handles an empty account list', () => {
    const g = groupAccounts([]);
    expect(g.netWorthCents).toBe(0);
    expect(g.assets.subtotalCents).toBe(0);
    expect(g.liabilities.subtotalCents).toBe(0);
  });
});
