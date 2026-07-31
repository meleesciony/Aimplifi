/**
 * Structural invariants of the system taxonomy, plus the O.17 additions.
 *
 * Why this file exists: `CATEGORIES` is a hand-edited literal that four
 * subsystems index by id (FK rows via ensureCategories, the pickers via
 * ASSIGNABLE_*, the Plaid hint map, the budget target list), and a duplicate id
 * or a mistyped group is invisible to tsc — a typo'd `group: 'Personal & Familly'`
 * silently opens a NEW picker group rather than failing anything. Three of these
 * four checks pass on the pre-O.17 array by design: they are guards for the next
 * edit, not locks on a fixed bug. The fourth (`O.17 additions`) fails on the old
 * array and is the actual regression lock.
 */
import { describe, expect, it } from 'vitest';
import { CATEGORIES, CATEGORY_BY_ID, isIncomeCategoryId } from '@/lib/engine/categorize/categories';
import { ASSIGNABLE_GROUPS } from '@/lib/engine/categorize/assign';

describe('system taxonomy invariants', () => {
  it('every id is unique (a dupe would silently shadow in CATEGORY_BY_ID)', () => {
    const ids = CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CATEGORY_BY_ID.size).toBe(CATEGORIES.length);
  });

  it('every name is unique case-insensitively', () => {
    // Two system categories sharing a name render as two identical picker rows
    // the user cannot tell apart, and `SYSTEM_NAMES` (custom-category shadow
    // check) collapses them into one entry, so one of the pair stops being
    // protected from a custom that shadows it.
    const names = CATEGORIES.map((c) => c.name.toLowerCase());
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it('entries of a group are contiguous, so no group is rendered twice', () => {
    // ASSIGNABLE_GROUPS is built by a single forward pass that appends to the
    // first matching bucket; a stray entry filed under an earlier group would
    // still land correctly, but a MISTYPED group opens a second bucket with a
    // near-identical label. Assert each group label appears once.
    const labels = ASSIGNABLE_GROUPS.map((g) => g.group);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('no name has leading/trailing whitespace', () => {
    for (const c of CATEGORIES) expect(c.name).toBe(c.name.trim());
  });
});

describe('O.17 additions', () => {
  /** id → [name, group]. Every entry taken from the owner's real Simplifi export. */
  const ADDED: Record<string, [string, string]> = {
    alimony: ['Alimony Received', 'Income'],
    'retirement-income': ['Retirement Income', 'Income'],
    'home-insurance': ['Home & Renters Insurance', 'Bills & Utilities'],
    'car-wash': ['Car Wash', 'Auto & Transport'],
    doctor: ['Doctor', 'Health & Fitness'],
    'hair-beauty': ['Hair & Beauty', 'Personal & Family'],
    spa: ['Spa & Massage', 'Personal & Family'],
    laundry: ['Laundry & Dry Cleaning', 'Personal & Family'],
    'pet-food': ['Pet Food & Supplies', 'Personal & Family'],
    veterinary: ['Veterinary', 'Personal & Family'],
    'kids-activities': ['Kids Activities', 'Personal & Family'],
    toys: ['Toys', 'Personal & Family'],
    'baby-supplies': ['Baby Supplies', 'Personal & Family'],
    allowance: ['Allowance', 'Personal & Family'],
    'child-support': ['Child Support', 'Personal & Family'],
    tuition: ['Tuition', 'Personal & Family'],
    'student-loan': ['Student Loan', 'Personal & Family'],
    'atm-fee': ['ATM Fee', 'Financial'],
    'late-fee': ['Late Fee', 'Financial'],
    'estimated-tax': ['Estimated Tax Payment', 'Financial'],
    shipping: ['Shipping & Postage', 'Business'],
    'work-expenses': ['Work Expenses', 'Business'],
  };

  it('all 22 exist with the intended name and group', () => {
    expect(Object.keys(ADDED)).toHaveLength(22);
    for (const [id, [name, group]] of Object.entries(ADDED)) {
      const c = CATEGORY_BY_ID.get(id);
      expect(c, `missing category id: ${id}`).toBeDefined();
      expect(c?.name).toBe(name);
      expect(c?.group).toBe(group);
    }
  });

  it('every addition is reachable in a picker', () => {
    // ASSIGNABLE_* drops only `uncategorized`; a new leaf the pickers cannot
    // offer is dead weight that still occupies a FK row.
    const assignable = new Set(ASSIGNABLE_GROUPS.flatMap((g) => g.categories.map((c) => c.id)));
    for (const id of Object.keys(ADDED)) {
      expect(assignable.has(id), `not assignable: ${id}`).toBe(true);
    }
  });

  it('only the two deliberate income additions read as income', () => {
    // The Income group is load-bearing: 14 predicates treat `group === 'Income'`
    // as "this is money coming in" (see NON_CUSTOM_GROUPS in assign.ts). An
    // expense leaf accidentally filed there would erase spending from reports
    // while monthlyFlows still counted it — the L.13 sign class.
    const income = Object.keys(ADDED).filter((id) => isIncomeCategoryId(id));
    expect(income.sort()).toEqual(['alimony', 'retirement-income']);
  });

  it('names the direction on the income pair, so an outflow cannot be mis-picked', () => {
    // "Alimony" alone is ambiguous (paid or received); the picker row must say.
    // Paying support is `child-support`, which is NOT income.
    expect(CATEGORY_BY_ID.get('alimony')?.name).toMatch(/received/i);
    expect(isIncomeCategoryId('child-support')).toBe(false);
  });
});
