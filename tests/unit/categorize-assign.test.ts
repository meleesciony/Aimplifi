import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '@/lib/engine/categorize/categories';
import { ASSIGNABLE_CATEGORIES, isRuleEligibleMerchant } from '@/lib/engine/categorize/assign';

describe('ASSIGNABLE_CATEGORIES (DECISIONS #36)', () => {
  it('excludes the internal uncategorized placeholder and nothing else', () => {
    expect(ASSIGNABLE_CATEGORIES).toHaveLength(CATEGORIES.length - 1);
    expect(ASSIGNABLE_CATEGORIES.some((c) => c.id === 'uncategorized')).toBe(false);
  });

  it('keeps the canonical order and includes the real categories a user picks', () => {
    const ids = ASSIGNABLE_CATEGORIES.map((c) => c.id);
    expect(ids).toContain('dining');
    expect(ids).toContain('groceries');
    expect(ids).toContain('income');
    expect(ids).toContain('transfer');
    // order matches CATEGORIES (minus uncategorized)
    expect(ids).toEqual(CATEGORIES.filter((c) => c.id !== 'uncategorized').map((c) => c.id));
  });

  it('carries display names', () => {
    expect(ASSIGNABLE_CATEGORIES.find((c) => c.id === 'dining')?.name).toBe('Dining Out');
  });
});

describe('isRuleEligibleMerchant (DECISIONS #36 / #23)', () => {
  it('allows merchant-wide rules for real merchants', () => {
    expect(isRuleEligibleMerchant('AMZN MKTP US*2X4')).toBe(true);
    expect(isRuleEligibleMerchant('NETFLIX.COM')).toBe(true);
  });

  it('refuses rules for aggregate pseudo-merchants (Zelle / checks)', () => {
    expect(isRuleEligibleMerchant('ZELLE PAYMENT TO JANE')).toBe(false);
    expect(isRuleEligibleMerchant('CHECK # 1042')).toBe(false);
  });
});

describe('filterCategoryOptions (#136 increment 2 — searchable picker core)', async () => {
  const { filterCategoryOptions } = await import('@/lib/engine/categorize/assign');
  const groups = [
    { group: 'Food & Dining', items: [{ id: 'groceries', name: 'Groceries' }, { id: 'dining', name: 'Dining Out' }] },
    { group: 'Entertainment', items: [{ id: 'entertainment', name: 'Entertainment' }, { id: 'custom1', name: 'Golf' }] },
  ];

  it('empty/blank query returns the SAME reference (identity — no-search render is zero-cost)', () => {
    expect(filterCategoryOptions(groups, '')).toBe(groups);
    expect(filterCategoryOptions(groups, '   ')).toBe(groups);
  });

  it('matches case-insensitively on substrings and drops empty groups', () => {
    const r = filterCategoryOptions(groups, 'GoL');
    expect(r).toEqual([{ group: 'Entertainment', items: [{ id: 'custom1', name: 'Golf' }] }]);
  });

  it('unions name matches with whole-group label matches across groups', () => {
    // 'e': hits the name "Groceries" (its group label has no 'e') AND the
    // group label "Entertainment" (whole group kept, including "Golf").
    const r = filterCategoryOptions(groups, 'e');
    expect(r.map((g) => g.group)).toEqual(['Food & Dining', 'Entertainment']);
    expect(r[0].items.map((c) => c.id)).toEqual(['groceries']);
    expect(r[1].items.map((c) => c.id)).toEqual(['entertainment', 'custom1']);
  });

  it('no matches → empty array (the picker shows its create-hint empty state)', () => {
    expect(filterCategoryOptions(groups, 'zzz-nope')).toEqual([]);
  });
});

describe('filterCategoryOptions — group-label matching (critic P1)', async () => {
  const { filterCategoryOptions } = await import('@/lib/engine/categorize/assign');
  const groups = [
    { group: 'Food & Dining', items: [{ id: 'groceries', name: 'Groceries' }, { id: 'dining', name: 'Dining Out' }] },
    { group: 'Entertainment', items: [{ id: 'entertainment', name: 'Entertainment' }, { id: 'custom1', name: 'Golf' }] },
  ];

  it('a query matching a GROUP label keeps the whole group (labels are visible in the picker)', () => {
    // "food" appears only in the group label, not in any category name.
    const r = filterCategoryOptions(groups, 'food');
    expect(r).toEqual([groups[0]]);
    expect(r[0].items.map((c) => c.id)).toEqual(['groceries', 'dining']); // ALL items kept
  });

  it('group-label matching is case-insensitive', () => {
    expect(filterCategoryOptions(groups, 'FOOD & d')).toEqual([groups[0]]);
  });
});
