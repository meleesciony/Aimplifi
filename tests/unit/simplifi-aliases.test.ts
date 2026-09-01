import { describe, expect, it } from 'vitest';
import { filterCategoryOptions } from '@/lib/engine/categorize/assign';
import {
  expandSimplifiAliasRows,
  canonicalCategoryName,
  SIMPLIFI_LEAF_ALIASES,
} from '@/lib/engine/categorize/simplifi-aliases';

describe('Simplifi alias rows (O.17 refused duplicates)', () => {
  const food = [
    { id: 'dining', name: 'Dining Out' },
    { id: 'food-delivery', name: 'Food Delivery' },
    { id: 'groceries', name: 'Groceries' },
  ];

  it('adds a clickable Restaurants row that files dining, not a new leaf', () => {
    const rows = expandSimplifiAliasRows(food);
    const restaurants = rows.filter((r) => r.name === 'Restaurants');
    expect(restaurants).toEqual([{ id: 'dining', name: 'Restaurants' }]);
    expect(rows.filter((r) => r.id === 'food-delivery')).toEqual([
      { id: 'food-delivery', name: 'Food Delivery' },
    ]);
  });

  it('filter "restaurants" surfaces dining so scroll/click can file it', () => {
    const groups = [{ group: 'Food & Dining', items: expandSimplifiAliasRows(food) }];
    const r = filterCategoryOptions(groups, 'restaurants');
    expect(r).toHaveLength(1);
    expect(r[0].items.some((c) => c.id === 'dining' && c.name === 'Restaurants')).toBe(true);
  });

  it('filter "food delivery" still hits the real Food Delivery leaf', () => {
    const groups = [{ group: 'Food & Dining', items: expandSimplifiAliasRows(food) }];
    const r = filterCategoryOptions(groups, 'food delivery');
    expect(r[0].items.map((c) => c.id)).toContain('food-delivery');
  });

  it('confirm copy uses canonical Dining Out when the click was Restaurants', () => {
    expect(canonicalCategoryName('dining', expandSimplifiAliasRows(food))).toBe('Dining Out');
  });

  it('does not invent a Restaurants system id', () => {
    expect(SIMPLIFI_LEAF_ALIASES.dining).toEqual(['Restaurants']);
    expect('restaurants' in SIMPLIFI_LEAF_ALIASES).toBe(false);
  });
});
