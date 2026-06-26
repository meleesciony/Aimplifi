/**
 * Per-user category-meta resolver (DECISIONS #111) — the pure overlay that makes
 * custom categories resolve everywhere. The critical invariant: an EMPTY custom
 * list yields a value-identical copy of the static map, so every engine that
 * defaults to CATEGORY_BY_ID stays byte-identical (golden tests untouched).
 */
import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  CATEGORY_BY_ID,
  categoryName,
  mergeCategoryMeta,
} from '@/lib/engine/categorize/categories';

const GOLF = { id: 'cust_golf', name: 'Golf', group: 'Entertainment', discretionary: true };

describe('mergeCategoryMeta', () => {
  it('empty custom list is value-identical to the static system map', () => {
    const m = mergeCategoryMeta([]);
    expect(m.size).toBe(CATEGORY_BY_ID.size);
    for (const c of CATEGORIES) {
      const got = m.get(c.id);
      expect(got).toEqual({ name: c.name, group: c.group, discretionary: c.discretionary });
    }
  });

  it('overlays a custom category without disturbing system entries', () => {
    const m = mergeCategoryMeta([GOLF]);
    expect(m.size).toBe(CATEGORY_BY_ID.size + 1);
    expect(m.get('cust_golf')).toEqual({ name: 'Golf', group: 'Entertainment', discretionary: true });
    // a system entry is unchanged
    expect(m.get('dining')?.name).toBe('Dining Out');
  });

  it('a custom row sharing an id overrides (last-write-wins overlay)', () => {
    const m = mergeCategoryMeta([{ id: 'dining', name: 'My Dining', group: 'Food & Dining', discretionary: false }]);
    expect(m.get('dining')).toEqual({ name: 'My Dining', group: 'Food & Dining', discretionary: false });
    expect(m.size).toBe(CATEGORY_BY_ID.size); // same id → no new entry
  });
});

describe('categoryName with optional meta', () => {
  it('resolves a custom id only when given the merged map', () => {
    const meta = mergeCategoryMeta([GOLF]);
    expect(categoryName('cust_golf', meta)).toBe('Golf');
    // default (static map) cannot see custom ids
    expect(categoryName('cust_golf')).toBe('Uncategorized');
  });

  it('system ids resolve identically with or without a meta arg', () => {
    const meta = mergeCategoryMeta([GOLF]);
    expect(categoryName('dining')).toBe('Dining Out');
    expect(categoryName('dining', meta)).toBe('Dining Out');
    expect(categoryName(null)).toBe('Uncategorized');
    expect(categoryName(undefined)).toBe('Uncategorized');
  });
});
