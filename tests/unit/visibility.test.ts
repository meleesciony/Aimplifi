/**
 * Category visibility helpers (DECISIONS #110) — the pure layer behind
 * "hide the categories I don't use".
 */
import { describe, expect, it } from 'vitest';
import {
  NON_HIDEABLE,
  categoryCatalog,
  isHideable,
  visibleCategories,
  visibleGroups,
} from '@/lib/engine/categorize/visibility';
import { ASSIGNABLE_CATEGORIES, type AssignableCategory } from '@/lib/engine/categorize/assign';

describe('isHideable', () => {
  it('real system categories are hideable', () => {
    expect(isHideable('dining')).toBe(true);
    expect(isHideable('entertainment')).toBe(true);
  });
  it('uncategorized is never hideable', () => {
    expect(isHideable('uncategorized')).toBe(false);
    expect(NON_HIDEABLE.has('uncategorized')).toBe(true);
  });
  it('unknown ids are not hideable', () => {
    expect(isHideable('not-a-real-category')).toBe(false);
  });
});

describe('categoryCatalog', () => {
  it('covers every assignable category exactly once, grouped by parent', () => {
    const cat = categoryCatalog([]);
    const flat = cat.flatMap((g) => g.categories);
    expect(flat.length).toBe(ASSIGNABLE_CATEGORIES.length);
    // no uncategorized in the manageable set
    expect(flat.some((c) => c.id === 'uncategorized')).toBe(false);
    // group headers are unique and preserve declaration order
    const groups = cat.map((g) => g.group);
    expect(new Set(groups).size).toBe(groups.length);
  });

  it('annotates hidden state from the provided set', () => {
    const cat = categoryCatalog(['dining', 'fuel']);
    const flat = cat.flatMap((g) => g.categories);
    expect(flat.find((c) => c.id === 'dining')?.hidden).toBe(true);
    expect(flat.find((c) => c.id === 'fuel')?.hidden).toBe(true);
    expect(flat.find((c) => c.id === 'groceries')?.hidden).toBe(false);
    expect(flat.every((c) => c.hideable)).toBe(true);
  });
});

describe('visibleCategories', () => {
  it('removes hidden ids', () => {
    const all = visibleCategories([]);
    const some = visibleCategories(['dining', 'fuel']);
    expect(some.length).toBe(all.length - 2);
    expect(some.some((c) => c.id === 'dining')).toBe(false);
    expect(some.some((c) => c.id === 'fuel')).toBe(false);
  });
  it('with nothing hidden, equals the full assignable set', () => {
    expect(visibleCategories([]).length).toBe(ASSIGNABLE_CATEGORIES.length);
  });
});

describe('visibleGroups', () => {
  it('drops a group entirely once all its members are hidden', () => {
    // Giving = gifts + charity. Hiding both should remove the whole group.
    const groups = visibleGroups(['gifts', 'charity']);
    expect(groups.some((g) => g.group === 'Giving')).toBe(false);
    // a partially-hidden group survives with the remaining members
    const partial = visibleGroups(['gifts']);
    const giving = partial.find((g) => g.group === 'Giving');
    expect(giving?.categories.map((c) => c.id)).toEqual(['charity']);
  });
  it('with nothing hidden, every group is non-empty', () => {
    const groups = visibleGroups([]);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((g) => g.categories.length > 0)).toBe(true);
  });
});

describe('custom categories in the pickers (DECISIONS #111)', () => {
  const existingGroup = ASSIGNABLE_CATEGORIES[0].group;
  const inExisting: AssignableCategory = { id: 'cust_golf', name: 'Golf', group: existingGroup };
  const inNewGroup: AssignableCategory = { id: 'cust_boat', name: 'Boat', group: 'My Hobbies' };

  it('an empty custom list is byte-identical to the system-only result', () => {
    expect(visibleCategories([], [])).toEqual(visibleCategories([]));
    expect(visibleGroups([], [])).toEqual(visibleGroups([]));
  });

  it('visibleCategories appends customs after the system set', () => {
    const base = visibleCategories([]);
    const withCustom = visibleCategories([], [inExisting, inNewGroup]);
    expect(withCustom.length).toBe(base.length + 2);
    expect(withCustom.some((c) => c.id === 'cust_golf')).toBe(true);
    expect(withCustom.some((c) => c.id === 'cust_boat')).toBe(true);
  });

  it('visibleGroups slots a custom into a matching system group (no duplicate header)', () => {
    const groups = visibleGroups([], [inExisting]);
    expect(groups.filter((x) => x.group === existingGroup).length).toBe(1);
    const g = groups.find((x) => x.group === existingGroup);
    expect(g?.categories.some((c) => c.id === 'cust_golf')).toBe(true);
  });

  it('visibleGroups opens a new group, appended last, for an unknown group name', () => {
    const groups = visibleGroups([], [inNewGroup]);
    expect(groups[groups.length - 1]).toEqual({
      group: 'My Hobbies',
      categories: [{ id: 'cust_boat', name: 'Boat' }],
    });
  });

  it('a hidden custom id is filtered out like any other', () => {
    expect(visibleCategories(['cust_golf'], [inExisting]).some((c) => c.id === 'cust_golf')).toBe(false);
    const groups = visibleGroups(['cust_golf'], [inExisting]);
    const g = groups.find((x) => x.group === existingGroup);
    expect(g?.categories.some((c) => c.id === 'cust_golf')).toBe(false);
  });
});
