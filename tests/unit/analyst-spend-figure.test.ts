/**
 * The comparison's figure IS the app's figure: for every month of the demo dataset and
 * every way of naming a target, `spendFigureFor` returns the cents the existing Ask
 * answers print for that month. If these ever part, a month inside a comparison would
 * disagree with "how much did I spend in <that month>" — two answers to one question.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { buildSeedData } from '@/lib/seed/build';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import { spendingByCategory, type ReportTxn } from '@/lib/engine/reports/reports';
import { answerSpendByCategory, answerSpendTotal } from '@/lib/engine/assistant/answer';
import type { SpendTarget } from '@/lib/engine/assistant/intent';
import { comparisonPeriods, periodOfFirstDays, periodOfMonth, spendFigureFor, windowOfPeriod } from '@/lib/engine/analyst/spend-figure';

const seed = buildSeedData();
const txns = seed.transactions as unknown as ReportTxn[];
const months = [...new Set(txns.map((t) => t.date.slice(0, 7)))].sort();
const NONE = new Set<string>();
const tf = (ym: string) => ({ fromYm: ym, toYm: ym, label: ym });
const ctx = (target: SpendTarget | null) => ({ meta: CATEGORY_BY_ID, handoverKeys: NONE, target });

describe('spendFigureFor — the same cents the existing answers print', () => {
  it('has months and spending to compare', () => {
    expect(months.length).toBeGreaterThanOrEqual(3);
  });

  it('all spending, every month', () => {
    const figure = spendFigureFor(ctx(null));
    let nonZero = 0;
    for (const ym of months) {
      const breakdown = spendingByCategory(txns, { fromYm: ym, toYm: ym });
      const f = figure(txns, periodOfMonth(ym));
      expect(f.totalCents, ym).toBe(answerSpendTotal(breakdown, tf(ym)).headlineCents ?? 0);
      expect(f.groups.reduce((n, g) => n + g.cents, 0), `${ym} groups`).toBe(f.totalCents);
      if (f.totalCents > 0) nonZero++;
    }
    expect(nonZero).toBeGreaterThanOrEqual(3);
  });

  it('every category, every group, and a family of categories, every month', () => {
    const categoryIds = [...new Set(txns.map((t) => t.categoryId ?? 'uncategorized'))];
    const groups = [...new Set(categoryIds.map((id) => CATEGORY_BY_ID.get(id)?.group).filter((g): g is string => !!g))];
    const targets: SpendTarget[] = [
      ...categoryIds.map((id): SpendTarget => ({ type: 'category', categoryId: id, label: CATEGORY_BY_ID.get(id)?.name ?? id })),
      ...groups.map((group): SpendTarget => ({ type: 'group', group, label: group })),
      { type: 'categories', categoryIds: categoryIds.slice(0, 4), label: 'a family' },
    ];
    let checked = 0;
    for (const target of targets) {
      const figure = spendFigureFor(ctx(target));
      for (const ym of months) {
        const breakdown = spendingByCategory(txns, { fromYm: ym, toYm: ym });
        const f = figure(txns, periodOfMonth(ym));
        expect(f.totalCents, `${target.label} ${ym}`).toBe(answerSpendByCategory(breakdown, target, tf(ym)).headlineCents ?? 0);
        expect(f.groups.reduce((n, g) => n + g.cents, 0), `${target.label} ${ym} groups`).toBe(f.totalCents);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('nets a refund inside its category and drops a category that nets to zero or less — as the app does', () => {
    const rows: ReportTxn[] = [
      { accountId: 'a', date: '2026-05-03', amountCents: -5000, categoryId: 'dining' },
      { accountId: 'a', date: '2026-05-09', amountCents: 2000, categoryId: 'dining' }, // refund
      { accountId: 'a', date: '2026-05-10', amountCents: 9000, categoryId: 'groceries' }, // a net refund month
      { accountId: 'a', date: '2026-05-11', amountCents: -1000, categoryId: 'groceries' },
      { accountId: 'a', date: '2026-05-12', amountCents: -700, categoryId: 'transfer', isTransfer: true },
    ];
    const f = spendFigureFor(ctx(null))(rows, periodOfMonth('2026-05'));
    expect(f.totalCents).toBe(3000); // dining 5000 − 2000; groceries nets −8000 and is dropped
    expect(f.groups.map((g) => [g.key, g.cents])).toEqual([['dining', 3000]]);
  });

  it('a period is a calendar month or its first days — nothing else', () => {
    expect(windowOfPeriod(periodOfMonth('2024-02'))).toEqual({ fromYm: '2024-02', toYm: '2024-02' });
    expect(periodOfMonth('2024-02')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(periodOfFirstDays('2026-05', 9)).toEqual({ start: '2026-05-01', end: '2026-05-09' });
    expect(windowOfPeriod(periodOfFirstDays('2026-05', 9))).toEqual({ fromYm: '2026-05', toYm: '2026-05', asOf: '2026-05-09' });
    expect(() => windowOfPeriod({ start: isoDate('2026-05-02'), end: isoDate('2026-05-31') })).toThrow(/first days/);
    expect(() => windowOfPeriod({ start: isoDate('2026-05-01'), end: isoDate('2026-06-01') })).toThrow(/first days/);
  });

  it('the first days of a month count the rows dated in them, by the same netting', () => {
    const rows: ReportTxn[] = [
      { accountId: 'a', date: '2026-05-03', amountCents: -5000, categoryId: 'dining' },
      { accountId: 'a', date: '2026-05-09', amountCents: 2000, categoryId: 'dining' }, // refund, day 9
      { accountId: 'a', date: '2026-05-10', amountCents: -1000, categoryId: 'groceries' }, // day 10
    ];
    const f = spendFigureFor(ctx(null));
    expect(f(rows, periodOfFirstDays('2026-05', 2)).totalCents).toBe(0);
    expect(f(rows, periodOfFirstDays('2026-05', 8)).totalCents).toBe(5000);
    expect(f(rows, periodOfFirstDays('2026-05', 9)).totalCents).toBe(3000); // 5000 − 2000
    expect(f(rows, periodOfFirstDays('2026-05', 10)).totalCents).toBe(4000); // + groceries 1000
  });
});

describe('comparisonPeriods — a month in progress is compared day for day', () => {
  const d = isoDate;
  it('two finished months: the whole months', () => {
    expect(comparisonPeriods('2026-09', '2026-08', d('2026-10-12'))).toEqual({
      current: periodOfMonth('2026-09'),
      baseline: periodOfMonth('2026-08'),
      soFarDays: null,
    });
  });
  it('the month in progress: its finished days (through yesterday) against the same days of the other', () => {
    expect(comparisonPeriods('2026-10', '2026-09', d('2026-10-12'))).toEqual({
      current: { start: '2026-10-01', end: '2026-10-11' },
      baseline: { start: '2026-09-01', end: '2026-09-11' },
      soFarDays: 11,
    });
    // Either side may be the live one.
    expect(comparisonPeriods('2025-10', '2026-10', d('2026-10-02')).soFarDays).toBe(1);
  });
  it('capped at the other month’s length', () => {
    expect(comparisonPeriods('2026-03', '2026-02', d('2026-03-31'))).toEqual({
      current: { start: '2026-03-01', end: '2026-03-28' },
      baseline: { start: '2026-02-01', end: '2026-02-28' },
      soFarDays: 28,
    });
  });
  it('on the 1st nothing has finished: the whole months, for the engine to refuse by name', () => {
    expect(comparisonPeriods('2026-10', '2026-09', d('2026-10-01')).soFarDays).toBeNull();
  });
});
