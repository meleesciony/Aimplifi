/**
 * O.17a: money dials key by category id. Stored names migrate on read
 * only when the match is unique.
 */
import { describe, expect, it } from 'vitest';
import {
  buildDialCatalog,
  dialDisplayNames,
  resolveMoneyDialIds,
} from '@/lib/engine/settings/money-dial-ids';

const catalog = buildDialCatalog(
  [{ id: 'cat-golf', name: 'Golf', group: 'Entertainment' }],
  new Map([['dining', 'Restaurants']]),
);

describe('resolveMoneyDialIds (O.17a)', () => {
  it('test_regression__o17a_stored_id_survives_a_rename', () => {
    expect(resolveMoneyDialIds(['dining'], catalog)).toEqual(['dining']);
  });

  it('test_regression__o17a_built_in_name_maps_after_rename', () => {
    expect(resolveMoneyDialIds(['Dining Out'], catalog)).toEqual(['dining']);
  });

  it('test_regression__o17a_current_name_maps', () => {
    expect(resolveMoneyDialIds(['Restaurants'], catalog)).toEqual(['dining']);
  });

  it('test_regression__o17a_rename_does_not_steal_another_category', () => {
    expect(resolveMoneyDialIds(['Travel'], catalog)).toEqual(['travel']);
    expect(resolveMoneyDialIds(['travel'], catalog)).toEqual(['travel']);
  });

  it('test_regression__o17a_ambiguous_name_is_dropped_not_guessed', () => {
    const collided = buildDialCatalog(
      [{ id: 'cat-travel', name: 'Travel', group: 'Custom' }],
      new Map(),
    );
    expect(resolveMoneyDialIds(['Travel'], collided)).toEqual([]);
    expect(resolveMoneyDialIds(['travel', 'cat-travel'], collided)).toEqual([
      'travel',
      'cat-travel',
    ]);
  });

  it('test_regression__o17a_unknown_token_is_dropped', () => {
    expect(resolveMoneyDialIds(['Climbing', 'not-a-category'], catalog)).toEqual([]);
  });

  it('test_regression__o17a_custom_id_and_name', () => {
    expect(resolveMoneyDialIds(['cat-golf'], catalog)).toEqual(['cat-golf']);
    expect(resolveMoneyDialIds(['Golf'], catalog)).toEqual(['cat-golf']);
  });

  it('dedupes and preserves first-seen order', () => {
    expect(resolveMoneyDialIds(['Dining Out', 'dining', 'travel', 'Travel'], catalog)).toEqual([
      'dining',
      'travel',
    ]);
  });

  it('dialDisplayNames uses the current overlay name', () => {
    expect(dialDisplayNames(['dining', 'travel'], catalog)).toEqual(['Restaurants', 'Travel']);
  });
});
