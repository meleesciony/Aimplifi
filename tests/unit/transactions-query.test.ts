import { describe, expect, it } from 'vitest';
import {
  type AccountView,
  type TxnView,
  filterTransactions,
  groupAccounts,
  hasActiveTxnFilters,
  isLiabilityType,
  paginate,
  registerEmptyReason,
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
    categoryId: 'shopping',
    categoryName: 'Shopping',
    status: 'POSTED',
    isTransfer: false,
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

describe('hasActiveTxnFilters + registerEmptyReason (#173)', () => {
  it('treats empty / type=all as inactive; any other dimension as active', () => {
    expect(hasActiveTxnFilters({})).toBe(false);
    expect(hasActiveTxnFilters({ type: 'all' })).toBe(false);
    expect(hasActiveTxnFilters({ search: '  ' })).toBe(false);
    expect(hasActiveTxnFilters({ search: 'Costco' })).toBe(true);
    expect(hasActiveTxnFilters({ accountId: 'a1' })).toBe(true);
    expect(hasActiveTxnFilters({ categoryId: 'dining' })).toBe(true);
    expect(hasActiveTxnFilters({ from: '2026-06-01' })).toBe(true);
    expect(hasActiveTxnFilters({ to: '2026-06-30' })).toBe(true);
    expect(hasActiveTxnFilters({ type: 'expense' })).toBe(true);
  });

  it('returns no-data when both counts are zero; no-match when filters hid rows', () => {
    expect(registerEmptyReason(0, 0)).toBe('no-data');
    expect(registerEmptyReason(0, 42)).toBe('no-match');
    expect(registerEmptyReason(5, 42)).toBeNull();
    expect(registerEmptyReason(5, 0)).toBeNull(); // defensive: filtered can't exceed unfiltered in practice
  });
});
