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
  outOfScopeChipLabel,
  outOfScopeExplanation,
  outOfScopeReason,
  summarizeSpendClassCategories,
  suggestedCategoryIsFixed,
  type OutOfScopeReason,
} from '@/lib/engine/spending-plan/spend-class';
import {
  isGuiltFreeFixedSpendRow,
  monthlyNonDiscretionaryCents,
} from '@/lib/engine/spending-plan/fixed-pattern';
import { CATEGORY_BY_ID, type CategoryMeta } from '@/lib/engine/categorize/categories';
import { PROVENANCE_LABELS } from '@/lib/engine/categorize/provenance';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { overrideKey } from '@/lib/engine/recurring/override';
import { handoverKey } from '@/lib/engine/account/reconcile-boundary';
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

  it('test_regression__out_of_scope_names_its_own_reason_instead_of_one_label', () => {
    // Owner screenshot 2026-08-03: an `Interest Paid +$0.10` row read
    // "Not counted" and nothing in the app said what that meant — the second
    // time this chip was renamed rather than explained ("Neither" → #397).
    // Ten different facts reached one label; each now states its own.
    const reasonOf = (t: Parameters<typeof txn>[0]) => {
      const row = txn(t);
      return outOfScopeReason(row, classifySpendClass(row));
    };

    expect(
      reasonOf({ date: '2026-07-31', amountCents: 10, categoryId: 'interest' }),
    ).toBe('money-in');
    expect(
      reasonOf({ date: '2026-07-01', amountCents: -5000, categoryId: 'transfer', isTransfer: true }),
    ).toBe('transfer');
    expect(
      reasonOf({ date: '2026-07-01', amountCents: -5000, categoryId: 'credit-card-payment' }),
    ).toBe('card-payment');
    expect(reasonOf({ date: '2026-07-01', amountCents: -5000, categoryId: 'cash' })).toBe('cash');
    expect(reasonOf({ date: '2026-07-01', amountCents: -5000, categoryId: 'investment' })).toBe(
      'investment',
    );
    expect(reasonOf({ date: '2026-07-01', amountCents: -5000, categoryId: null })).toBe(
      'uncategorized',
    );
    // The register view fills an unfiled row with the placeholder id, not null —
    // both spellings must land on the same reason.
    expect(reasonOf({ date: '2026-07-01', amountCents: -5000, categoryId: 'uncategorized' })).toBe(
      'uncategorized',
    );
    expect(
      reasonOf({
        date: '2026-07-01',
        amountCents: -5000,
        categoryId: 'dining',
        excludeFromTotals: true,
      }),
    ).toBe('excluded');
    expect(
      reasonOf({
        date: '2026-07-01',
        amountCents: -5000,
        categoryId: 'dining',
        isSplitParent: true,
      }),
    ).toBe('split-parent');
    expect(
      reasonOf({
        date: '2026-07-01',
        amountCents: -5000,
        categoryId: 'dining',
        status: 'CANCELLED',
      }),
    ).toBe('unsettled');
  });

  it('never prints a reason beside a row that has a working dial', () => {
    // The guard that keeps the chip honest in the other direction: a row the
    // SERVER classified (with the reader's custom categories and bill merchants)
    // must not be explained away by a UI that re-derived the verdict without them.
    const dining = txn({ date: '2026-07-01', amountCents: -5000, categoryId: 'dining' });
    expect(outOfScopeReason(dining, 'guilt-free')).toBeNull();
    expect(outOfScopeReason(dining, 'fixed')).toBeNull();
    // A custom category the client's static map has never heard of: the server
    // says guilt-free, so the chip stays a dial rather than claiming "not spending".
    const custom = txn({ date: '2026-07-01', amountCents: -5000, categoryId: 'cus_horse_feed' });
    expect(classifySpendClass(custom)).toBe('out-of-scope'); // what a bare re-derive would say
    expect(outOfScopeReason(custom, 'guilt-free')).toBeNull();
  });

  it('every reason has a chip label and an explanation that names the scope', () => {
    // The exhaustiveness lock: a reason added without copy would render `undefined`
    // in the chip, which is how the label lost its meaning twice already.
    const all: OutOfScopeReason[] = [
      'split-parent',
      'transfer',
      'money-in',
      'excluded',
      'unsettled',
      'uncategorized',
      'card-payment',
      'cash',
      'investment',
      'not-spending',
    ];
    for (const r of all) {
      const chip = outOfScopeChipLabel(r);
      expect(chip.length).toBeGreaterThan(0);
      // Short enough to sit in the Details / Rule… row chrome.
      expect(chip.length).toBeLessThanOrEqual(14);
      // And never the two words the owner has now asked about twice.
      expect(chip).not.toBe('Neither');
      expect(chip).not.toBe('Not counted');
      // Nor a word the row already prints beside it: the provenance pill and
      // the exclusion badge own these, and a chip that echoes its neighbour is
      // clutter rather than disclosure (caught by screenshot, 2026-08-03).
      expect(Object.values(PROVENANCE_LABELS)).not.toContain(chip);
      expect(chip).not.toBe('Excluded from totals');
      const why = outOfScopeExplanation(r);
      expect(why.length).toBeGreaterThan(40);
      expect(why).toMatch(/\.$/);
    }
    // Distinct copy per reason — the whole point is that one pixel stopped
    // standing for ten different facts.
    expect(new Set(all.map(outOfScopeChipLabel)).size).toBe(all.length);
    expect(new Set(all.map(outOfScopeExplanation)).size).toBe(all.length);
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
      // C.13: no reconciliation link in this fixture — the R8 constant-true
      // keep. The boundary itself is locked in spend-class-link-parity.test.ts.
      () => true,
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
      // C.13: no reconciliation link in this fixture — the R8 constant-true
      // keep. The boundary itself is locked in spend-class-link-parity.test.ts.
      () => true,
    );
    expect(fixed).toHaveLength(0);
    expect(guiltFree.map((r) => r.categoryId)).toEqual(['dining']);
  });

  // U.29: this classifier used to be handed no `handoverKeys` at all, so a
  // purchase both connections reported on the one U.13-released handover day
  // landed in Fixed/Discretionary with no marker — the same shape U.16 fixed
  // on the other four families.
  it('defaults countedOnHandoverDays to 0 when no handoverKeys arg is given (the pre-U.29 call shape)', () => {
    const { countedOnHandoverDays } = summarizeSpendClassCategories(
      [txn({ date: '2026-07-01', amountCents: -5_000, categoryId: 'dining' })],
      CATEGORY_BY_ID,
      new Set(),
      (id) => CATEGORY_BY_ID.get(id)!.name,
      () => true,
    );
    expect(countedOnHandoverDays).toBe(0);
  });

  it('counts a classified row landing on a released handover day, and leaves the subtotal untouched by the marker', () => {
    const HANDOVER = '2026-07-15';
    const { fixed, countedOnHandoverDays } = summarizeSpendClassCategories(
      [
        txn({ date: '2026-07-01', amountCents: -40_000, categoryId: 'groceries' }),
        // The successor's copy of a charge the predecessor also reported that
        // day — U.13 releases both, deliberately, so both survive `keepsReconciled`.
        txn({ date: HANDOVER, amountCents: -1_000, categoryId: 'groceries', accountId: 'pred' }),
        txn({ date: HANDOVER, amountCents: -1_000, categoryId: 'groceries', accountId: 'succ' }),
      ],
      CATEGORY_BY_ID,
      new Set(),
      (id) => CATEGORY_BY_ID.get(id)!.name,
      () => true,
      new Set([handoverKey('pred', HANDOVER), handoverKey('succ', HANDOVER)]),
    );
    // Subtotal counts both released rows, exactly as `keepsReconciled` already
    // did pre-U.29 — the marker discloses the double, it does not remove it.
    expect(fixed.find((r) => r.categoryId === 'groceries')!.spentCents).toBe(42_000);
    expect(countedOnHandoverDays).toBe(2);
  });

  it('does not count a row on a handover date the boundary excludes, or an out-of-scope row on a handover date', () => {
    const HANDOVER = '2026-07-15';
    const { countedOnHandoverDays } = summarizeSpendClassCategories(
      [
        // Same date, but a DIFFERENT account than the two released keys —
        // not a handover row for THIS reader's boundary.
        txn({ date: HANDOVER, amountCents: -1_000, categoryId: 'groceries', accountId: 'unrelated' }),
        // A transfer on the handover date: out-of-scope, so it never reaches
        // the Fixed/Discretionary split and must not inflate the count either.
        txn({ date: HANDOVER, amountCents: -1_000, categoryId: 'transfer', accountId: 'pred', isTransfer: true }),
      ],
      CATEGORY_BY_ID,
      new Set(),
      (id) => CATEGORY_BY_ID.get(id)!.name,
      () => true,
      new Set([handoverKey('pred', HANDOVER), handoverKey('succ', HANDOVER)]),
    );
    expect(countedOnHandoverDays).toBe(0);
  });
});
