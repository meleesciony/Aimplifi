/**
 * Fixed vs guilt-free spend classification — PER TRANSACTION (DECISIONS #397,
 * 2026-08-03). The reader's verdict on the row wins; absent one, the app
 * guesses: a recurring-bill merchant guesses fixed, otherwise the filed
 * category's taxonomy flag decides.
 */
import { describe, expect, it } from 'vitest';
import {
  classifySpendClass,
  guessSpendClass,
  summarizeSpendClassCategories,
  suggestedCategoryIsFixed,
} from '@/lib/engine/spending-plan/spend-class';
import {
  isGuiltFreeFixedSpendRow,
  monthlyNonDiscretionaryCents,
} from '@/lib/engine/spending-plan/fixed-pattern';
import { CATEGORY_BY_ID, type CategoryMeta } from '@/lib/engine/categorize/categories';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { overrideKey } from '@/lib/engine/recurring/override';
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

/** The fixedMerchants key for a descriptor, the way the server set is built. */
function billKey(rawDescriptor: string): string {
  return overrideKey(normalizeMerchant(rawDescriptor).canonical);
}

describe('classifySpendClass', () => {
  it('files groceries as fixed and dining as guilt-free (the taxonomy guess)', () => {
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

  it('test_regression__pending_categorized_outflow_keeps_the_dial', () => {
    // Owner screenshot 2026-08-03: pending Hair Capital / Whole Foods showed
    // "Not counted" with no Fixed/Discretionary control — classifySpendClass
    // had reused countsInFlows (POSTED-only), so the dial never rendered.
    expect(
      classifySpendClass(
        txn({
          date: '2026-08-02',
          amountCents: -5500,
          categoryId: 'hair-beauty',
          status: 'PENDING',
          rawDescriptor: 'HAIR CAPITAL',
        }),
      ),
    ).toBe('guilt-free');
    expect(
      classifySpendClass(
        txn({
          date: '2026-08-02',
          amountCents: -2692,
          categoryId: 'gifts',
          status: 'PENDING',
        }),
      ),
    ).toBe('guilt-free');
    // A pending transfer still has no class — only settlement was loosened.
    expect(
      classifySpendClass(
        txn({
          date: '2026-08-02',
          amountCents: -5500,
          categoryId: 'transfer',
          status: 'PENDING',
          isTransfer: true,
        }),
      ),
    ).toBe('out-of-scope');
  });

  it('test_regression__flipping_one_transaction_leaves_category_siblings_alone', () => {
    // The #397 owner complaint verbatim: "when I switch one transaction in
    // this category to discretionary, they all do." The verdict is a property
    // of the ROW — a sibling in the same category keeps its own guess.
    const flipped = txn({
      date: '2026-07-01',
      amountCents: -5000,
      categoryId: 'groceries',
      spendClassOverride: 'guilt-free',
    });
    const sibling = txn({ date: '2026-07-02', amountCents: -5000, categoryId: 'groceries' });
    expect(classifySpendClass(flipped)).toBe('guilt-free');
    expect(classifySpendClass(sibling)).toBe('fixed');
    // …and the other direction, the owner's hair-and-beauty example: one
    // discretionary-category row designated Fixed does not move the rest.
    const fixedOne = txn({
      date: '2026-07-03',
      amountCents: -8000,
      categoryId: 'dining',
      spendClassOverride: 'fixed',
    });
    expect(classifySpendClass(fixedOne)).toBe('fixed');
    expect(
      classifySpendClass(txn({ date: '2026-07-04', amountCents: -8000, categoryId: 'dining' })),
    ).toBe('guilt-free');
  });

  it('a recurring-bill merchant guesses fixed; the verdict still wins over it', () => {
    const fixedMerchants = new Set([billKey('NETFLIX.COM 866-579-7172 CA')]);
    // A discretionary-category payee the reader declared (or the detector
    // found) recurring guesses fixed — the owner's seed rule.
    const bill = txn({
      date: '2026-07-01',
      amountCents: -1549,
      categoryId: 'entertainment',
      rawDescriptor: 'NETFLIX.COM 866-579-7172 CA',
    });
    expect(classifySpendClass(bill, CATEGORY_BY_ID, fixedMerchants)).toBe('fixed');
    expect(guessSpendClass(bill, CATEGORY_BY_ID, fixedMerchants)).toBe('fixed');
    // Not in the set → the category guess stands.
    expect(classifySpendClass(bill)).toBe('guilt-free');
    // The reader's verdict beats the recurring guess (#397: "most of those
    // are fixed" — the ones that aren't, he flips).
    expect(
      classifySpendClass({ ...bill, spendClassOverride: 'guilt-free' }, CATEGORY_BY_ID, fixedMerchants),
    ).toBe('guilt-free');
    // An unreadable stored value is not a verdict — the guess decides.
    expect(
      classifySpendClass({ ...bill, spendClassOverride: 'banana' }, CATEGORY_BY_ID, fixedMerchants),
    ).toBe('fixed');
  });

  it('test_regression__user_override_moves_dining_into_fixed_median', () => {
    const overridden = txn({
      date: '2026-07-04',
      amountCents: -8_000,
      categoryId: 'dining',
      spendClassOverride: 'fixed',
    });
    expect(classifySpendClass(overridden)).toBe('fixed');
    const months = monthlyNonDiscretionaryCents(
      [
        txn({ date: '2026-07-02', amountCents: -50_000, categoryId: 'groceries' }),
        overridden,
        // The un-flipped dining sibling stays OUT of the fixed median (#397).
        txn({ date: '2026-07-05', amountCents: -8_000, categoryId: 'dining' }),
      ],
      CATEGORY_BY_ID,
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

  it('the guess is deterministic: nothing outside the row moves the answer', () => {
    // With no verdict and no recurring set, the class is a pure function of
    // the filed category — the #395 goal keeps holding as the DEFAULT.
    const base = { date: '2026-07-01', amountCents: -5000 };
    expect(guessSpendClass(txn({ ...base, categoryId: 'dining' }))).toBe('guilt-free');
    expect(guessSpendClass(txn({ ...base, categoryId: 'groceries' }))).toBe('fixed');
    expect(
      guessSpendClass(txn({ date: '2026-01-15', amountCents: -99, categoryId: 'dining' })),
    ).toBe('guilt-free');
    expect(suggestedCategoryIsFixed('groceries')).toBe(true);
    expect(suggestedCategoryIsFixed('dining')).toBe(false);
    // Settlement / income / uncategorized categories take no class.
    for (const id of ['transfer', 'credit-card-payment', 'cash', 'investment', 'income', 'uncategorized']) {
      expect(suggestedCategoryIsFixed(id)).toBeNull();
    }
  });
});

describe('summarizeSpendClassCategories', () => {
  it('splits this-month rows per transaction — a mixed category appears in both lists', () => {
    const { fixed, guiltFree } = summarizeSpendClassCategories(
      [
        txn({ date: '2026-07-01', amountCents: -40_000, categoryId: 'groceries' }),
        txn({ date: '2026-07-02', amountCents: -9_000, categoryId: 'dining' }),
        txn({ date: '2026-07-03', amountCents: -200_000, categoryId: 'rent' }),
        // The owner's case: ONE dining row the reader designated Fixed. The
        // category appears in both lists, each with its own subtotal.
        txn({
          date: '2026-07-04',
          amountCents: -3_000,
          categoryId: 'dining',
          spendClassOverride: 'fixed',
        }),
      ],
      CATEGORY_BY_ID,
      new Set(),
      (id) => CATEGORY_BY_ID.get(id)!.name,
    );
    expect(fixed.map((r) => [r.categoryId, r.spentCents])).toEqual([
      ['rent', 200_000],
      ['groceries', 40_000],
      ['dining', 3_000],
    ]);
    expect(guiltFree.map((r) => [r.categoryId, r.spentCents])).toEqual([['dining', 9_000]]);
    expect(fixed.find((r) => r.categoryId === 'dining')!.isFixed).toBe(true);
    expect(guiltFree[0]!.isFixed).toBe(false);
  });

  it('omits categories with no classified spend this month', () => {
    const { fixed, guiltFree } = summarizeSpendClassCategories(
      [txn({ date: '2026-07-02', amountCents: -5_000, categoryId: 'dining' })],
      CATEGORY_BY_ID,
      new Set(),
      (id) => CATEGORY_BY_ID.get(id)!.name,
    );
    expect(fixed).toHaveLength(0);
    expect(guiltFree.map((r) => r.categoryId)).toEqual(['dining']);
  });
});
