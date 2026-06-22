/**
 * Reports engine known-answer tests (DECISIONS #67).
 */
import { describe, expect, it } from 'vitest';
import { spendingByCategory, type ReportTxn } from '@/lib/engine/reports/reports';

const T = (date: string, amountCents: number, categoryId: string | null, extra: Partial<ReportTxn> = {}): ReportTxn => ({
  date,
  amountCents,
  categoryId,
  ...extra,
});

describe('spendingByCategory', () => {
  const txns: ReportTxn[] = [
    T('2026-06-02', -5000, 'dining'),
    T('2026-06-05', -3000, 'dining'),
    T('2026-06-07', -8000, 'groceries'),
    T('2026-06-09', 2000, 'dining'), // refund nets down dining
    T('2026-06-10', 400000, 'income'), // income excluded
    T('2026-06-11', -10000, 'transfer'), // transfer excluded
    T('2026-06-12', -1000, 'dining', { isSplitParent: true }), // split parent excluded
    T('2026-05-30', -9999, 'dining'), // out of range (May)
  ];

  it('sums expenses by category, nets refunds, excludes income/transfer/splits/out-of-range', () => {
    const r = spendingByCategory(txns, { fromYm: '2026-06', toYm: '2026-06' });
    const dining = r.byCategory.find((c) => c.categoryId === 'dining');
    expect(dining?.amountCents).toBe(6000); // 5000 + 3000 − 2000 refund
    const groceries = r.byCategory.find((c) => c.categoryId === 'groceries');
    expect(groceries?.amountCents).toBe(8000);
    expect(r.byCategory.find((c) => c.categoryId === 'income')).toBeUndefined();
    expect(r.byCategory.find((c) => c.categoryId === 'transfer')).toBeUndefined();
    expect(r.totalCents).toBe(14000);
  });

  it('sorts categories descending and rolls up to parent groups', () => {
    const r = spendingByCategory(txns, { fromYm: '2026-06', toYm: '2026-06' });
    expect(r.byCategory[0].categoryId).toBe('groceries'); // 8000 > 6000
    const foodGroup = r.byGroup.find((g) => g.group === 'Food & Dining');
    expect(foodGroup?.amountCents).toBe(14000); // dining + groceries both Food & Dining
    expect(foodGroup?.categories.length).toBe(2);
  });

  it('a category that nets to a refund (positive) is dropped', () => {
    const refundOnly: ReportTxn[] = [T('2026-06-01', -1000, 'shopping'), T('2026-06-02', 3000, 'shopping')];
    const r = spendingByCategory(refundOnly, { fromYm: '2026-06', toYm: '2026-06' });
    expect(r.byCategory.find((c) => c.categoryId === 'shopping')).toBeUndefined();
    expect(r.totalCents).toBe(0);
  });
});
