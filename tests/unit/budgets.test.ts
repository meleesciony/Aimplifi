/**
 * Budgets engine — known-answer tests for summarizeBudgets (the display rows +
 * over/remaining/pct status) and parseBudgetTargetCents (target validation).
 */
import { describe, expect, it } from 'vitest';
import {
  isBudgetable,
  netSpendByCategory,
  parseBudgetTargetCents,
  summarizeBudgets,
} from '@/lib/engine/budgets/status';

const NAME = (id: string) => ({ dining: 'Dining Out', groceries: 'Groceries', rent: 'Rent' }[id] ?? id);
const DIALS = new Set(['Dining Out']);
const meta = { name: NAME, isDial: (id: string) => DIALS.has(NAME(id)) };

describe('summarizeBudgets', () => {
  it('unions categories with spend OR a target, sorted by spend desc', () => {
    const spend = new Map([['dining', 5000], ['groceries', 3000]]);
    const budgets = new Map([['dining', 4000], ['rent', 200000]]); // rent has a target but no spend
    const rows = summarizeBudgets(spend, budgets, meta);
    expect(rows.map((r) => r.categoryId)).toEqual(['dining', 'groceries', 'rent']);
  });

  it('computes over / remaining / pct against the target', () => {
    const rows = summarizeBudgets(new Map([['dining', 5000]]), new Map([['dining', 4000]]), meta);
    const dining = rows[0];
    expect(dining).toMatchObject({
      categoryId: 'dining',
      name: 'Dining Out',
      spentCents: 5000,
      budgetCents: 4000,
      isDial: true,
      over: true,
      remainingCents: -1000, // 4000 − 5000
      pct: 100, // min(100, round(125)) clamps
    });
  });

  it('a target with no spend yet → 0% used, full remaining, not over', () => {
    const rows = summarizeBudgets(new Map(), new Map([['rent', 200000]]), meta);
    expect(rows[0]).toMatchObject({
      spentCents: 0,
      budgetCents: 200000,
      over: false,
      remainingCents: 200000,
      pct: 0,
    });
  });

  it('spend with no target → null budget/remaining/pct, never over', () => {
    const rows = summarizeBudgets(new Map([['groceries', 3000]]), new Map(), meta);
    expect(rows[0]).toMatchObject({
      spentCents: 3000,
      budgetCents: null,
      over: false,
      remainingCents: null,
      pct: null,
    });
  });

  it('under-budget: pct rounds, remaining positive, not over', () => {
    const rows = summarizeBudgets(new Map([['dining', 3000]]), new Map([['dining', 4000]]), meta);
    expect(rows[0]).toMatchObject({ over: false, remainingCents: 1000, pct: 75 });
  });

  it('empty inputs → no rows', () => {
    expect(summarizeBudgets(new Map(), new Map(), meta)).toEqual([]);
  });
});

describe('netSpendByCategory (refunds netted against spend)', () => {
  it('nets a same-category refund so spend reflects the true outlay', () => {
    // $450 spent on dining, $100 returned → net $350 spend (NOT $450).
    const spend = netSpendByCategory([
      { categoryId: 'dining', amountCents: -45000 },
      { categoryId: 'dining', amountCents: 10000 }, // refund/return
    ]);
    expect(spend.get('dining')).toBe(35000);
  });

  it('plain outflows sum to positive spend', () => {
    const spend = netSpendByCategory([
      { categoryId: 'dining', amountCents: -2000 },
      { categoryId: 'dining', amountCents: -1500 },
      { categoryId: 'groceries', amountCents: -3000 },
    ]);
    expect(spend.get('dining')).toBe(3500);
    expect(spend.get('groceries')).toBe(3000);
  });

  it('a category that nets to an inflow (income, or fully-refunded) is omitted', () => {
    const spend = netSpendByCategory([
      { categoryId: 'income', amountCents: 500000 },
      { categoryId: 'dining', amountCents: -2000 },
      { categoryId: 'dining', amountCents: 2000 }, // fully refunded → net 0
    ]);
    expect(spend.has('income')).toBe(false);
    expect(spend.has('dining')).toBe(false); // net 0 is not an outflow
  });

  it('null categoryId folds into uncategorized', () => {
    const spend = netSpendByCategory([{ categoryId: null, amountCents: -1000 }]);
    expect(spend.get('uncategorized')).toBe(1000);
  });
});

describe('isBudgetable', () => {
  it('excludes income, transfer, and uncategorized; allows real spending categories', () => {
    expect(isBudgetable('dining')).toBe(true);
    expect(isBudgetable('cash')).toBe(true);
    expect(isBudgetable('fees')).toBe(true);
    expect(isBudgetable('income')).toBe(false);
    expect(isBudgetable('transfer')).toBe(false);
    expect(isBudgetable('uncategorized')).toBe(false);
  });
});

describe('parseBudgetTargetCents', () => {
  const cases: [string, number | null][] = [
    ['500', 50000],
    ['500.50', 50050],
    ['0.01', 1],
    ['1', 100],
    ['0', null], // not positive — clearing is a separate action
    ['-5', null],
    ['', null],
    ['   ', null],
    ['abc', null],
    ['$5', null],
    ['5.555', null],
  ];
  it.each(cases)('%s -> %s', (input, expected) => {
    expect(parseBudgetTargetCents(input)).toBe(expected);
  });
});
