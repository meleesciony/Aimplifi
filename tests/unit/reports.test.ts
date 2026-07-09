/**
 * Reports engine known-answer tests (DECISIONS #67 + #171 MoM series).
 */
import { describe, expect, it } from 'vitest';
import { monthDateBounds } from '@/lib/dates';
import {
  categorySpendSeries,
  isSpendDrilldownCategory,
  spendingByCategory,
  type ReportTxn,
} from '@/lib/engine/reports/reports';

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

/**
 * Hand-verified MoM fixture (EDGE_CASES §Category MoM):
 * Dining Apr $40, May $50, Jun $60 (after $20 refund). Groceries only in Jun.
 * Income / transfer / split / out-of-window rows must not leak into the series.
 */
describe('categorySpendSeries', () => {
  const txns: ReportTxn[] = [
    T('2026-04-10', -4000, 'dining'),
    T('2026-05-12', -5000, 'dining'),
    T('2026-06-02', -5000, 'dining'),
    T('2026-06-05', -3000, 'dining'),
    T('2026-06-09', 2000, 'dining'), // refund → Jun dining = 6000
    T('2026-06-07', -8000, 'groceries'),
    T('2026-06-10', 400000, 'income'),
    T('2026-06-11', -10000, 'transfer'),
    T('2026-06-12', -1000, 'dining', { isSplitParent: true }),
    T('2026-03-30', -9999, 'dining'), // before the 3-month window
  ];

  it('builds oldest→newest series with MoM delta and pctChange (hand-verified)', () => {
    // Apr 4000, May 5000, Jun 6000 → delta +1000, pct = 1000/5000 = 0.2
    const s = categorySpendSeries(txns, 'dining', '2026-06', 3);
    expect(s.categoryId).toBe('dining');
    expect(s.name).toBe('Dining Out');
    expect(s.group).toBe('Food & Dining');
    expect(s.months).toEqual([
      { ym: '2026-04', amountCents: 4000 },
      { ym: '2026-05', amountCents: 5000 },
      { ym: '2026-06', amountCents: 6000 },
    ]);
    expect(s.currentCents).toBe(6000);
    expect(s.priorCents).toBe(5000);
    expect(s.deltaCents).toBe(1000);
    expect(s.pctChange).toBe(0.2);
  });

  it('keeps zero months for chart continuity and returns null pct when prior is 0', () => {
    // Groceries only in Jun → Apr/May = 0, prior=0 → pctChange null, delta = +8000
    const s = categorySpendSeries(txns, 'groceries', '2026-06', 3);
    expect(s.months.map((m) => m.amountCents)).toEqual([0, 0, 8000]);
    expect(s.currentCents).toBe(8000);
    expect(s.priorCents).toBe(0);
    expect(s.deltaCents).toBe(8000);
    expect(s.pctChange).toBeNull();
  });

  it('matches spendingByCategory for the anchor month (one spend definition)', () => {
    const breakdown = spendingByCategory(txns, { fromYm: '2026-06', toYm: '2026-06' });
    const series = categorySpendSeries(txns, 'dining', '2026-06', 1);
    expect(series.currentCents).toBe(
      breakdown.byCategory.find((c) => c.categoryId === 'dining')?.amountCents,
    );
  });

  it('rejects a non-positive monthCount', () => {
    expect(() => categorySpendSeries(txns, 'dining', '2026-06', 0)).toThrow(/monthCount/);
  });
});

describe('isSpendDrilldownCategory', () => {
  it('allows spend leaves and uncategorized; rejects income and transfer', () => {
    expect(isSpendDrilldownCategory('dining')).toBe(true);
    expect(isSpendDrilldownCategory('uncategorized')).toBe(true);
    expect(isSpendDrilldownCategory('paycheck')).toBe(false);
    expect(isSpendDrilldownCategory('income')).toBe(false);
    expect(isSpendDrilldownCategory('transfer')).toBe(false);
    expect(isSpendDrilldownCategory('not-a-real-category')).toBe(false);
  });
});

describe('monthDateBounds (register deep-link helper)', () => {
  it('returns inclusive first/last day for a 31-day and a February month', () => {
    expect(monthDateBounds('2026-06')).toEqual({ from: '2026-06-01', to: '2026-06-30' });
    expect(monthDateBounds('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(monthDateBounds('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});
