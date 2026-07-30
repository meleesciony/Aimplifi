/**
 * O.15 slice 2 — reimbursement tracker. Hand-verified expectations
 * (docs/EDGE_CASES.md §Reimbursement tracker). The property under guard:
 * the tracker is informational — nothing here ever changes a sum — and the
 * outstanding line counts each awaiting purchase exactly once.
 */
import { describe, expect, it } from 'vitest';
import {
  REIMBURSEMENT_MATCH_WINDOW_DAYS,
  findOffsettingInflow,
  outstandingReimbursements,
  reimbursementState,
} from '@/lib/engine/transactions/reimbursement';
import { monthlyFlows } from '@/lib/engine/fi/insights';
import { isSpendRow } from '@/lib/engine/reports/reports';

const txn = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  date: '2026-06-10',
  amountCents: -12550,
  reimbursement: null as string | null,
  ...over,
});

describe('reimbursementState — narrowing the stored string', () => {
  it('recognizes the two states and reads anything else as untracked', () => {
    expect(reimbursementState('awaiting')).toBe('awaiting');
    expect(reimbursementState('received')).toBe('received');
    expect(reimbursementState(null)).toBeNull();
    expect(reimbursementState(undefined)).toBeNull();
    expect(reimbursementState('AWAITING')).toBeNull(); // exact slug, no coercion
    expect(reimbursementState('pending')).toBeNull();
  });
});

describe('outstandingReimbursements — the "still owed" line', () => {
  it('sums awaiting outflow magnitudes, each row once', () => {
    const out = outstandingReimbursements([
      txn({ id: 'a', reimbursement: 'awaiting' }), // 12550
      txn({ id: 'b', amountCents: -2450, reimbursement: 'awaiting' }), // 2450
      txn({ id: 'c', reimbursement: 'received' }), // came back — off the line
      txn({ id: 'd' }), // untracked
    ]);
    expect(out).toEqual({ count: 2, totalCents: 15000 }); // 12550 + 2450, by hand
  });

  it('never counts inflows, split containers, transfers, or unrecognized states', () => {
    const out = outstandingReimbursements([
      txn({ id: 'inflow', amountCents: 9900, reimbursement: 'awaiting' }),
      txn({ id: 'parent', isSplitParent: true, reimbursement: 'awaiting' }),
      // Critic P1-3: transfer detection can re-flag a tracked row at any sync;
      // an owed-money claim about own-account movement contradicts every total.
      txn({ id: 'xfer', isTransfer: true, reimbursement: 'awaiting' }),
      txn({ id: 'junk', reimbursement: 'maybe' }),
    ]);
    expect(out).toEqual({ count: 0, totalCents: 0 });
  });

  it('an awaiting row that is ALSO excluded from totals still counts — cash owed is not a budget figure', () => {
    const out = outstandingReimbursements([
      txn({ id: 'a', reimbursement: 'awaiting', excludeFromTotals: true }),
    ]);
    expect(out).toEqual({ count: 1, totalCents: 12550 });
  });
});

describe('findOffsettingInflow — a suggestion, never a link', () => {
  const purchase = txn({ id: 'p', amountCents: -12550, reimbursement: 'received' });

  it('proposes the earliest exact-magnitude POSTED inflow on/after the purchase', () => {
    const match = findOffsettingInflow(purchase, [
      txn({ id: 'later', date: '2026-06-25', amountCents: 12550 }),
      txn({ id: 'earlier', date: '2026-06-15', amountCents: 12550 }),
      txn({ id: 'wrong-amount', date: '2026-06-12', amountCents: 12500 }),
    ]);
    expect(match).toEqual({ id: 'earlier', date: '2026-06-15', amountCents: 12550 });
  });

  it('refuses: before the purchase, beyond the window, transfers, split parents, PENDING, tracked rows, itself', () => {
    expect(findOffsettingInflow(purchase, [txn({ id: 'before', date: '2026-06-01', amountCents: 12550 })])).toBeNull();
    // Window edge, by hand: 2026-06-10 + 90 days = 2026-09-08 (in), 09-09 is day 91 (out).
    expect(REIMBURSEMENT_MATCH_WINDOW_DAYS).toBe(90);
    expect(findOffsettingInflow(purchase, [txn({ id: 'edge', date: '2026-09-08', amountCents: 12550 })])).not.toBeNull();
    expect(findOffsettingInflow(purchase, [txn({ id: 'late', date: '2026-09-09', amountCents: 12550 })])).toBeNull();
    expect(findOffsettingInflow(purchase, [txn({ id: 'x', date: '2026-06-15', amountCents: 12550, isTransfer: true })])).toBeNull();
    expect(findOffsettingInflow(purchase, [txn({ id: 'x', date: '2026-06-15', amountCents: 12550, isSplitParent: true })])).toBeNull();
    expect(findOffsettingInflow(purchase, [txn({ id: 'x', date: '2026-06-15', amountCents: 12550, status: 'PENDING' })])).toBeNull();
    expect(findOffsettingInflow(purchase, [txn({ id: 'x', date: '2026-06-15', amountCents: 12550, reimbursement: 'awaiting' })])).toBeNull();
    expect(findOffsettingInflow(txn({ id: 'p', amountCents: 12550 }), [txn({ id: 'q', amountCents: -12550 })])).toBeNull();
  });

  it('same-date candidates tiebreak by id, deterministically', () => {
    const match = findOffsettingInflow(purchase, [
      txn({ id: 'z', date: '2026-06-15', amountCents: 12550 }),
      txn({ id: 'a', date: '2026-06-15', amountCents: 12550 }),
    ]);
    expect(match?.id).toBe('a');
  });
});

describe('the tracker never changes a sum (the double-count guard)', () => {
  it('marking awaiting/received leaves monthlyFlows and isSpendRow byte-identical', () => {
    const rows = [
      {
        date: '2026-06-10',
        amountCents: -12550,
        rawDescriptor: 'HOTEL',
        accountId: 'a1',
        isTransfer: false,
        status: 'POSTED',
        categoryId: 'travel',
      },
    ];
    const tracked = rows.map((r) => ({ ...r, reimbursement: 'awaiting' }));
    expect(monthlyFlows(tracked)).toEqual(monthlyFlows(rows));
    expect(isSpendRow({ ...rows[0], reimbursement: 'received' } as never, { fromYm: '2026-06', toYm: '2026-06' })).toBe(
      isSpendRow(rows[0], { fromYm: '2026-06', toYm: '2026-06' }),
    );
  });
});
