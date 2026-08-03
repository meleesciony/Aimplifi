/**
 * Fixed vs guilt-free spend classification (DECISIONS #376; per-user override
 * restored 2026-08-03 by DECISIONS #396). The taxonomy suggestion is the
 * deterministic default; a CategoryFixedOverride row wins when the reader
 * disagrees.
 */
import { describe, expect, it } from 'vitest';
import {
  classifySpendClass,
  resolveCategoryIsFixed,
  summarizeSpendClassCategories,
  suggestedCategoryIsFixed,
} from '@/lib/engine/spending-plan/spend-class';
import {
  isGuiltFreeFixedSpendRow,
  monthlyNonDiscretionaryCents,
} from '@/lib/engine/spending-plan/fixed-pattern';
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
    // The default contract (#396): with no override row, a row's class is a
    // pure function of where it is filed — deterministic, nothing typed in.
    // The register/detail dial only ever writes a category-level override;
    // absent one, nothing outside the category moves the answer.
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

  it('test_regression__user_override_moves_dining_into_fixed_median', () => {
    const overrides = new Map([['dining', true]]);
    expect(
      classifySpendClass(
        txn({ date: '2026-07-01', amountCents: -8000, categoryId: 'dining' }),
        CATEGORY_BY_ID,
        overrides,
      ),
    ).toBe('fixed');
    const months = monthlyNonDiscretionaryCents(
      [
        txn({ date: '2026-07-02', amountCents: -50_000, categoryId: 'groceries' }),
        txn({ date: '2026-07-04', amountCents: -8_000, categoryId: 'dining' }),
      ],
      CATEGORY_BY_ID,
      overrides,
    );
    expect(months).toEqual([{ month: '2026-07', expenseCents: 58_000 }]);
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
      new Map(),
      (id) => CATEGORY_BY_ID.get(id)!.name,
    );
    expect(fixed.map((r) => r.categoryId)).toEqual(['rent', 'groceries']);
    expect(guiltFree.map((r) => r.categoryId)).toEqual(['dining']);
    expect(suggestedCategoryIsFixed('dining')).toBe(false);
    expect(resolveCategoryIsFixed('dining', CATEGORY_BY_ID, new Map([['dining', true]]))).toBe(
      true,
    );
  });

  it('keeps a $0 overridden category visible so the reader can undo', () => {
    const { guiltFree } = summarizeSpendClassCategories(
      new Map(),
      CATEGORY_BY_ID,
      new Map([['groceries', false]]),
      (id) => CATEGORY_BY_ID.get(id)!.name,
    );
    expect(guiltFree).toHaveLength(1);
    expect(guiltFree[0]!.categoryId).toBe('groceries');
    expect(guiltFree[0]!.overridden).toBe(true);
  });

  it('omits $0-spend categories with no override — nothing to classify yet', () => {
    const { fixed, guiltFree } = summarizeSpendClassCategories(
      new Map([
        ['groceries', 0],
        ['dining', 5_000],
      ]),
      CATEGORY_BY_ID,
      new Map(),
      (id) => CATEGORY_BY_ID.get(id)!.name,
    );
    expect(fixed).toHaveLength(0);
    expect(guiltFree.map((r) => r.categoryId)).toEqual(['dining']);
  });
});
