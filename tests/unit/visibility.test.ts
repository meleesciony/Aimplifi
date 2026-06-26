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
import { ASSIGNABLE_CATEGORIES } from '@/lib/engine/categorize/assign';

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
