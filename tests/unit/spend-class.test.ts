/**
 * Fixed vs guilt-free spend classification (DECISIONS #376).
 * Taxonomy-only since 2026-08-03 — the per-user designation override
 * (CategoryFixedOverride + the register/panel dials) was removed by owner
 * directive: the class is deterministic and algorithmic, never typed in.
 */
import { describe, expect, it } from 'vitest';
import {
  classifySpendClass,
  resolveCategoryIsFixed,
  summarizeSpendClassCategories,
} from '@/lib/engine/spending-plan/spend-class';
import { isGuiltFreeFixedSpendRow } from '@/lib/engine/spending-plan/fixed-pattern';
import { CATEGORY_BY_ID, type CategoryMeta } from '@/lib/engine/categorize/categories';
import type { TxnLike } from '@/lib/engine/fi/insights';

function txn(
  partial: Partial<TxnLike> & Pick<TxnLike, 'date' | 'amountCents' | 'categoryId'>,
): TxnLike {
  return {
    accountId: 'chk',
    isTransfer: false,
    status: 'POSTED',
    rawDescriptor: 'X',
    ...partial,
  };
}

describe('classifySpendClass', () => {
  it('files groceries as fixed and dining as guilt-free', () => {
    expect(
      classifySpendClass(txn({ date: '2026-07-01', amountCents: -5000, categoryId: 'groceries' })),
    ).toBe('fixed');
    expect(
      classifySpendClass(txn({ date: '2026-07-01', amountCents: -5000, categoryId: 'dining' })),
    ).toBe('guilt-free');
  });

  it('test_regression__transfer_and_uncategorized_are_out_of_scope_not_guilt_free', () => {
    expect(
      classifySpendClass(txn({ date: '2026-07-01', amountCents: -5000, categoryId: 'transfer' })),
    ).toBe('out-of-scope');
    expect(
      classifySpendClass(txn({ date: '2026-07-01', amountCents: -5000, categoryId: null })),
    ).toBe('out-of-scope');
    expect(
      classifySpendClass(
        txn({ date: '2026-07-01', amountCents: -5000, categoryId: 'credit-card-payment' }),
      ),
    ).toBe('out-of-scope');
  });

  it('test_regression__class_follows_the_filed_category_only', () => {
    // The 2026-08-03 contract: no per-user designation channel exists. A row's
    // class is a pure function of where it is filed — the reader changes it by
    // refiling the transaction (always possible), never by labeling the row.
    const base = { date: '2026-07-01', amountCents: -5000 };
    expect(classifySpendClass(txn({ ...base, categoryId: 'dining' }))).toBe('guilt-free');
    expect(classifySpendClass(txn({ ...base, categoryId: 'groceries' }))).toBe('fixed');
    // Nothing outside the category moves the answer: same category, same class,
    // regardless of amount or month.
    expect(classifySpendClass(txn({ date: '2026-01-15', amountCents: -99, categoryId: 'dining' }))).toBe(
      'guilt-free',
    );
    expect(resolveCategoryIsFixed('groceries')).toBe(true);
    expect(resolveCategoryIsFixed('dining')).toBe(false);
    // Settlement / income / uncategorized categories take no designation.
    for (const id of ['transfer', 'credit-card-payment', 'cash', 'investment', 'income', 'uncategorized']) {
      expect(resolveCategoryIsFixed(id)).toBeNull();
    }
  });

  it('test_regression__custom_nondiscretionary_category_counts_as_fixed', () => {
    const meta = new Map<string, CategoryMeta>(CATEGORY_BY_ID);
    meta.set('custom-hoa', {
      name: 'HOA Special',
      group: 'Home',
      discretionary: false,
    });
    expect(
      isGuiltFreeFixedSpendRow(
        txn({ date: '2026-07-01', amountCents: -12_000, categoryId: 'custom-hoa' }),
        meta,
      ),
    ).toBe(true);
    expect(
      classifySpendClass(
        txn({ date: '2026-07-01', amountCents: -12_000, categoryId: 'custom-hoa' }),
        meta,
      ),
    ).toBe('fixed');
  });
});

describe('summarizeSpendClassCategories', () => {
  it('splits this-month spend into fixed and guilt-free lists', () => {
    const spend = new Map([
      ['groceries', 40_000],
      ['dining', 12_000],
      ['rent', 200_000],
    ]);
    const { fixed, guiltFree } = summarizeSpendClassCategories(
      spend,
      CATEGORY_BY_ID,
      (id) => CATEGORY_BY_ID.get(id)!.name,
    );
    expect(fixed.map((r) => r.categoryId)).toEqual(['rent', 'groceries']);
    expect(guiltFree.map((r) => r.categoryId)).toEqual(['dining']);
  });

  it('omits $0-spend categories — nothing to classify yet', () => {
    const { fixed, guiltFree } = summarizeSpendClassCategories(
      new Map([
        ['groceries', 0],
        ['dining', 5_000],
      ]),
      CATEGORY_BY_ID,
      (id) => CATEGORY_BY_ID.get(id)!.name,
    );
    expect(fixed).toHaveLength(0);
    expect(guiltFree.map((r) => r.categoryId)).toEqual(['dining']);
  });
});
