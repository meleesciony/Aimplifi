/**
 * C.19 / H.3 — the Fixed list must account for its own total, and the owner's
 * mortgage must be a line in it.
 *
 * The owner has reported "where is mortgage?" four times. The figure was right
 * (C.24/#394 unions it at $6,217.07/mo); the LIST was empty, because the union
 * returned a bare number while C.24's exactness invariant had already pulled the
 * merchant's rows out of the category rollup — the only half that produced
 * lines. `loan-payment-fixed-union.test.ts` asserts that empty rollup as
 * correct, so nothing in the suite could see the hole.
 *
 * FAIL-OLD, both directions:
 *  - against the pre-change engine the assembled list is EMPTY beside a
 *    $6,217.07 total (the defect, reproduced);
 *  - a list that reconciles unconditionally is caught by the median and
 *    user-set cases, which must REFUSE to certify.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import {
  computeSpendingPlan,
  recurringOutsideFixedCategoryCents,
  recurringOutsideFixedCategoryRows,
  type PlanScheduledItem,
  type SpendingPlanInput,
} from '@/lib/engine/spending-plan/plan';
import {
  resolveFixedCategoryAmounts,
  type FixedCategoryAmount,
} from '@/lib/engine/spending-plan/fixed-category-amounts';
import {
  billBasisNote,
  buildFixedList,
  UNNAMED_BILL_LABEL,
} from '@/lib/engine/spending-plan/fixed-line-items';
import { suggestedCategoryIsFixed } from '@/lib/engine/spending-plan/spend-class';
import type { TxnLike } from '@/lib/engine/fi/insights';

const DESCRIPTOR = 'TRUIST MORTG OLB MTGPMT';
const CANONICAL = normalizeMerchant(DESCRIPTOR).canonical;
const MORTGAGE_CENTS = 621_707; // the owner's figure
const GROCERIES_CENTS = 80_000;

const today = isoDate('2026-08-03'); // rollup window: May, Jun, Jul
const nameOfCategory = (id: string) => CATEGORY_BY_ID.get(id)?.name ?? id;
const categoryIsFixed = (id: string) => suggestedCategoryIsFixed(id, CATEGORY_BY_ID);

function flowTxn(
  p: Partial<TxnLike> & Pick<TxnLike, 'date' | 'amountCents' | 'categoryId' | 'rawDescriptor'>,
): TxnLike {
  return { accountId: 'chk', isTransfer: false, status: 'POSTED', ...p };
}

/** Three months of groceries, plus the mortgage in every month. */
const OWNER_ROWS: TxnLike[] = [
  ...['2026-05', '2026-06', '2026-07'].flatMap((m) => [
    flowTxn({
      date: `${m}-11`,
      amountCents: -GROCERIES_CENTS,
      categoryId: 'groceries',
      rawDescriptor: 'PUBLIX #128',
    }),
    flowTxn({
      date: `${m}-03`,
      amountCents: -MORTGAGE_CENTS,
      categoryId: 'rent',
      rawDescriptor: DESCRIPTOR,
      // The pair flag fires in some months and not others — C.24's whole point.
      isTransfer: m !== '2026-07',
    }),
  ]),
];

const MORTGAGE_SERIES: PlanScheduledItem = {
  amountCents: -MORTGAGE_CENTS,
  cadence: 'MONTHLY',
  categoryId: 'rent',
  loanPayment: true,
  merchantCanonical: CANONICAL,
};

function rollup(): FixedCategoryAmount[] {
  return resolveFixedCategoryAmounts({
    transactions: OWNER_ROWS,
    today,
    meta: CATEGORY_BY_ID,
    fixedMerchants: new Set<string>(),
    budgetByCategory: new Map(),
    nameOf: nameOfCategory,
    // The exactness invariant: excluded ⇔ unioned (C.24).
    excludeMerchantCanonicals: new Set([CANONICAL]),
  }).rows;
}

function planWith(over: Partial<SpendingPlanInput> = {}) {
  return computeSpendingPlan({
    today,
    trailingMonthlyIncomeCents: [1_500_000, 1_500_000, 1_500_000],
    scheduledIncome: [],
    scheduledFixed: [MORTGAGE_SERIES],
    goalContributionsCents: 0,
    savingsTargetBps: null,
    categoryFixedCents: rollup().reduce((s, r) => s + r.amountCents, 0),
    categoryFixedCoveredIds: new Set(rollup().map((r) => r.categoryId)),
    categoryIsFixed,
    ...over,
  } as SpendingPlanInput);
}

describe('the union emits the rows it summed (one authority)', () => {
  it('recurringOutsideFixedCategoryCents equals the sum of the rows', () => {
    const rows = recurringOutsideFixedCategoryRows([MORTGAGE_SERIES], categoryIsFixed, new Set(['rent']));
    const cents = recurringOutsideFixedCategoryCents([MORTGAGE_SERIES], categoryIsFixed, new Set(['rent']));
    expect(rows.totalCents).toBe(cents);
    expect(rows.rows.reduce((s, r) => s + r.monthlyRateCents, 0)).toBe(cents);
  });

  it('the mortgage unions even though `rent` is in the rollup (C.24 unconditional)', () => {
    const { rows } = recurringOutsideFixedCategoryRows(
      [MORTGAGE_SERIES],
      categoryIsFixed,
      new Set(['rent']),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      merchantCanonical: CANONICAL,
      monthlyRateCents: MORTGAGE_CENTS,
      loanPayment: true,
      categoryId: 'rent',
    });
  });

  it('a series the reader priced themselves is neither summed NOR listed', () => {
    const { rows, totalCents } = recurringOutsideFixedCategoryRows(
      [MORTGAGE_SERIES],
      categoryIsFixed,
      new Set(['rent']),
      new Set(['rent']), // budget-priced
    );
    expect(rows).toEqual([]);
    expect(totalCents).toBe(0);
  });

  it('an unnamed series is listed WITHOUT borrowing its category as a name', () => {
    const { rows } = recurringOutsideFixedCategoryRows(
      [{ amountCents: -5_000, cadence: 'MONTHLY', categoryId: 'utilities' }],
      categoryIsFixed,
      new Set(),
    );
    expect(rows[0]!.merchantCanonical).toBeNull();
    const line = buildFixedList({
      plan: {
        fixedBasis: 'category-designations',
        suggestedFixedCents: 0,
        fixedExpensesCents: 0,
        fixedLineItems: rows,
        fixedLineItemsCoverRemainder: true,
        reserveLines: [],
      },
      rollupRows: [],
      nameOfCategory,
    }).lines[0]!;
    expect(line.label).toContain(UNNAMED_BILL_LABEL);
    expect(line.label).not.toBe(nameOfCategory('utilities'));
  });
});

describe("H.3 — the owner's mortgage is a line in the Fixed list, every month", () => {
  it('FAIL-OLD: the category rollup alone has no mortgage line beside a $6,217.07 total', () => {
    // This is the shipped defect, reproduced: the rollup (the only half that
    // produced lines before this slice) knows nothing about the mortgage.
    const rows = rollup();
    expect(rows.some((r) => r.categoryId === 'rent')).toBe(false);
    expect(planWith().suggestedFixedCents).toBeGreaterThanOrEqual(MORTGAGE_CENTS);
  });

  it('the assembled list names the mortgage at its full monthly amount, exactly once', () => {
    const plan = planWith();
    const list = buildFixedList({ plan, rollupRows: rollup(), nameOfCategory });
    const mortgage = list.lines.filter((l) => l.label === CANONICAL);
    expect(mortgage).toHaveLength(1);
    expect(mortgage[0]!.amountCents).toBe(MORTGAGE_CENTS);
    expect(mortgage[0]!.kind).toBe('recurring-bill');
    expect(mortgage[0]!.loanPayment).toBe(true);
  });

  it('the list adds up to the Fixed figure to the penny', () => {
    const plan = planWith();
    const list = buildFixedList({ plan, rollupRows: rollup(), nameOfCategory });
    expect(list.reconciles).toBe(true);
    expect(list.unaccountedCents).toBe(0);
    expect(list.lines.reduce((s, l) => s + l.amountCents, 0)).toBe(plan.suggestedFixedCents);
    expect(list.totalCents).toBe(plan.suggestedFixedCents);
    expect(list.planFixedCents).toBe(plan.suggestedFixedCents);
  });

  it('the printed total is the sum of the printed lines in EVERY branch', () => {
    // The invariant that makes the figure above the list safe to read as the
    // list's own total. Asserted across all four branches, because the first cut
    // printed the plan's figure there and let one branch contradict its lines.
    const cases = [
      buildFixedList({ plan: planWith(), rollupRows: rollup(), nameOfCategory }),
      buildFixedList({
        plan: planWith({ fixedOverrideCents: 1_000_000 }),
        rollupRows: rollup(),
        nameOfCategory,
      }),
      buildFixedList({
        plan: planWith({
          categoryFixedCents: 0,
          categoryFixedCoveredIds: new Set<string>(),
          trailingMonthlyFixedCents: [900_000, 900_000, 900_000],
        }),
        rollupRows: [],
        nameOfCategory,
      }),
      buildFixedList({ plan: planWith(), rollupRows: rollup().slice(1), nameOfCategory }),
    ];
    for (const list of cases) {
      expect(list.totalCents).toBe(list.lines.reduce((s, l) => s + l.amountCents, 0));
      expect(list.unaccountedCents).toBe(list.planFixedCents - list.totalCents);
    }
  });

  it('two series sharing one merchant canonical get distinct keys (both are counted)', () => {
    const { rows, totalCents } = recurringOutsideFixedCategoryRows(
      [
        { ...MORTGAGE_SERIES, cadence: 'MONTHLY' },
        { ...MORTGAGE_SERIES, cadence: 'QUARTERLY' },
      ],
      categoryIsFixed,
      new Set(['rent']),
    );
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
    expect(totalCents).toBe(rows.reduce((s, r) => s + r.monthlyRateCents, 0));
    const list = buildFixedList({
      plan: {
        fixedBasis: 'category-designations',
        suggestedFixedCents: totalCents,
        fixedExpensesCents: totalCents,
        fixedLineItems: rows,
        fixedLineItemsCoverRemainder: true,
        reserveLines: [],
      },
      rollupRows: [],
      nameOfCategory,
    });
    expect(new Set(list.lines.map((l) => l.key)).size).toBe(2);
  });

  it('the mortgage line is present in a month where the pair flag DID fire', () => {
    // Every mortgage row flagged: it vanishes from spend-class and from the
    // rollup, so the union line is the ONLY thing keeping it visible.
    const allFlagged = OWNER_ROWS.map((t) =>
      t.rawDescriptor === DESCRIPTOR ? { ...t, isTransfer: true } : t,
    );
    const rollupRows = resolveFixedCategoryAmounts({
      transactions: allFlagged,
      today,
      meta: CATEGORY_BY_ID,
      fixedMerchants: new Set<string>(),
      budgetByCategory: new Map(),
      nameOf: nameOfCategory,
      excludeMerchantCanonicals: new Set([CANONICAL]),
    }).rows;
    const plan = planWith({
      categoryFixedCents: rollupRows.reduce((s, r) => s + r.amountCents, 0),
      categoryFixedCoveredIds: new Set(rollupRows.map((r) => r.categoryId)),
    });
    const list = buildFixedList({ plan, rollupRows, nameOfCategory });
    expect(list.lines.filter((l) => l.label === CANONICAL)).toHaveLength(1);
    expect(list.reconciles).toBe(true);
  });
});

describe('copy-critic locks — a line states ITS OWN basis, and one branch never swallows another', () => {
  it('P1-2: a budget-priced category line carries the same provenance clause /budgets prints', () => {
    const rollupRows = resolveFixedCategoryAmounts({
      transactions: OWNER_ROWS,
      today,
      meta: CATEGORY_BY_ID,
      fixedMerchants: new Set<string>(),
      budgetByCategory: new Map([['groceries', 50_000]]),
      nameOf: nameOfCategory,
      excludeMerchantCanonicals: new Set([CANONICAL]),
    }).rows;
    const line = buildFixedList({
      plan: planWith(),
      rollupRows,
      nameOfCategory,
    }).lines.find((l) => l.label === nameOfCategory('groceries'))!;
    // The reader's own number must not render pixel-identical to a measured
    // average — that is exactly audit P1-8, one surface over.
    expect(line.basisNote).toBe(' (your target)');
  });

  it('P1-1b: a category line never claims the monthly-share smoothing it does not do', () => {
    const line = buildFixedList({ plan: planWith(), rollupRows: rollup(), nameOfCategory }).lines.find(
      (l) => l.kind === 'category',
    )!;
    expect(line.basisNote).toContain('typical');
    expect(line.basisNote).not.toContain('each month');
  });

  it('P2-6: a long-cadence bill states its share, a monthly one is left unqualified', () => {
    expect(billBasisNote('QUARTERLY')).toContain('a third');
    expect(billBasisNote('ANNUAL')).toContain('a twelfth');
    expect(billBasisNote('SEMIANNUAL')).toContain('a sixth');
    expect(billBasisNote('MONTHLY')).toBeNull();
    expect(billBasisNote(null)).toBeNull();
  });

  it('P1-3: an override laid over the MEDIAN basis states BOTH facts, not just the override', () => {
    const plan = planWith({
      categoryFixedCents: 0,
      categoryFixedCoveredIds: new Set<string>(),
      trailingMonthlyFixedCents: [900_000, 900_000, 900_000],
      fixedOverrideCents: 300_000,
    });
    expect(plan.fixedBasis).toBe('user-set');
    expect(plan.fixedLineItemsCoverRemainder).toBe(false);
    const list = buildFixedList({ plan, rollupRows: [], nameOfCategory });
    // The override fact…
    expect(list.note).toContain('you set yourself');
    // …AND the unlistable-remainder fact the old branch swallowed.
    expect(list.note).toContain('spending pattern');
    expect(list.reconciles).toBe(false);
  });

  it('P1-4: the detected-series basis NAMES its bills instead of claiming none are detected', () => {
    const plan = planWith({
      categoryFixedCents: 0,
      categoryFixedCoveredIds: new Set<string>(),
      trailingMonthlyIncomeCents: [],
      trailingMonthlyFixedCents: [],
    });
    expect(plan.fixedBasis).toBe('detected-series');
    const list = buildFixedList({ plan, rollupRows: [], nameOfCategory });
    expect(list.lines.map((l) => l.label)).toContain(CANONICAL);
    // And because that basis IS the sum of those rows, it reconciles exactly.
    expect(list.reconciles).toBe(true);
    expect(list.totalCents).toBe(plan.suggestedFixedCents);
  });

  it('money-critic P1-1: a bill whose category also has a rollup line refuses to certify', () => {
    // Canonical drift: the mortgage changed its descriptor wording mid-window,
    // so the OLD canonical's rows stay in the rollup (the exclusion matches the
    // new one) while the series unions at full rate. The sum balances — which is
    // exactly why a sum-check alone cannot see it.
    //
    // The overlap needs a rollup row for the SAME CATEGORY the bill is filed to.
    // The demo `rent` is not in `CATEGORY_BY_ID` (the owner's mortgage filed
    // `rent` resolves through the guess map, not the taxonomy), so
    // `resolveFixedCategoryAmounts` only emits `groceries`. Filed the drift
    // rows to `groceries` instead — same mechanism, a category the rollup
    // genuinely prices.
    const oldCanonical = normalizeMerchant('TRUIST MORTGAGE PAYMENT').canonical;
    const driftRows = OWNER_ROWS.map((t) =>
      t.rawDescriptor === DESCRIPTOR ? { ...t, rawDescriptor: 'TRUIST MORTGAGE PAYMENT' } : t,
    ).filter((t) => t.categoryId !== 'rent');
    const rollupRows = resolveFixedCategoryAmounts({
      transactions: driftRows,
      today,
      meta: CATEGORY_BY_ID,
      fixedMerchants: new Set<string>(),
      budgetByCategory: new Map(),
      nameOf: nameOfCategory,
      excludeMerchantCanonicals: new Set([oldCanonical]), // the drift: mismatched
    }).rows;
    expect(rollupRows.some((r) => r.categoryId === 'groceries')).toBe(true);
    const plan = planWith({
      scheduledFixed: [
        { amountCents: -MORTGAGE_CENTS, cadence: 'MONTHLY', categoryId: 'groceries', loanPayment: true, merchantCanonical: CANONICAL },
      ],
      categoryFixedCents: rollupRows.reduce((s, r) => s + r.amountCents, 0),
      categoryFixedCoveredIds: new Set(rollupRows.map((r) => r.categoryId)),
    });
    const list = buildFixedList({ plan, rollupRows, nameOfCategory });
    expect(list.reconciles).toBe(false);
    expect(list.note).toContain("same money");
  });

  it('money-critic P1-1 (engine-contract): a bill with NO merchantCanonical against a same-category rollup line refuses to certify', () => {
    // The overlap guard must not depend on the exclusion having run — a series
    // with no `merchantCanonical` can never have had its rows excluded, so the
    // overlap is structural and the certification must refuse.
    const rollupRows = rollup(); // includes a `groceries` row
    const plan = planWith({
      scheduledFixed: [
        { amountCents: -GROCERIES_CENTS, cadence: 'MONTHLY', categoryId: 'groceries', loanPayment: true },
      ],
      categoryFixedCents: rollupRows.reduce((s, r) => s + r.amountCents, 0),
      categoryFixedCoveredIds: new Set(rollupRows.map((r) => r.categoryId)),
    });
    expect(plan.fixedBasis).toBe('category-designations');
    const list = buildFixedList({ plan, rollupRows, nameOfCategory });
    expect(list.reconciles).toBe(false);
    expect(list.note).toContain("same money");
  });

  it('money-critic P1-2: a reader who TYPED a non-zero fixed figure is not told it came from a spending pattern', () => {
    // The empty list reuses the composed `parts` ladder, which states BOTH the
    // override fact AND (because the remainder cannot be listed) the pattern
    // fact. What it must never do is say the reader's own figure CAME from the
    // pattern — the "comes from" sentence is the false claim.
    const typed = buildFixedList({
      plan: {
        fixedBasis: 'user-set',
        suggestedFixedCents: 0,
        fixedExpensesCents: 500_000,
        fixedLineItems: [],
        fixedLineItemsCoverRemainder: false,
        reserveLines: [],
      },
      rollupRows: [],
      nameOfCategory,
    });
    expect(typed.note).toContain('you set yourself');
    expect(typed.note).toContain('suggests instead');
    // The "rest comes from your spending pattern" sentence is TRUE here (nothing
    // is listed, so the pattern fact has no lines); what must never print is the
    // claim that the READER'S FIGURE came from the pattern. Assert the ordering
    // that keeps the two distinct: the override sentence comes FIRST and the
    // pattern sentence never precedes "you set yourself".
    expect(typed.note).not.toContain('Your fixed costs come from');
    expect(typed.note.indexOf('you set yourself')).toBeLessThan(
      typed.note.indexOf('spending pattern'),
    );
  });

  it('money-critic P2-1: a median of zero explains nothing and prints no duplicate figure', () => {
    const plan = planWith({
      categoryFixedCents: 0,
      categoryFixedCoveredIds: new Set<string>(),
      trailingMonthlyFixedCents: [0, 0, 0],
    });
    expect(plan.fixedBasis).toBe('non-discretionary-median');
    const list = buildFixedList({ plan, rollupRows: [], nameOfCategory });
    expect(list.reconciles).toBe(false);
    expect(list.unaccountedCents).toBe(0);
    // No "the rest comes from your spending pattern" for a gap of zero —
    // that sentence is gated on `unaccountedCents !== 0`.
    expect(list.note).not.toContain('spending pattern');
  });

  it('money-critic P2-2: a loan-payment series the union SKIPS keeps its rows in the rollup', () => {
    // A loan-payment series filed to a settlement category is dropped by the
    // union's own never-category skip (plan.ts). The server's exclusion must be
    // derived from what the union KEPT (`plan.fixedLineItems`), or this
    // merchant's rows are stripped from the rollup with nothing re-adding them
    // — the money leaves Fixed entirely and the list certifies the remainder.
    const skippedSeries: PlanScheduledItem = {
      amountCents: -MORTGAGE_CENTS,
      cadence: 'MONTHLY',
      categoryId: 'credit-card-payment', // in PLAN_FIXED_NEVER_CATEGORY_IDS
      loanPayment: true,
      merchantCanonical: CANONICAL,
    };
    const plan = planWith({
      scheduledFixed: [skippedSeries],
      categoryFixedCents: 0,
      categoryFixedCoveredIds: new Set<string>(),
    });
    // A settlement-category series is dropped from the detected-series sum too,
    // so nothing here counts — but the point of P2-2 is what happens to the
    // EXCLUSION, and that is derived from the union's KEPT rows, never from the
    // raw `scheduledFixed`. A series the union skipped must not appear in it.
    expect(plan.fixedBasis).toBe('none');
    expect(plan.fixedLineItems).toEqual([]);
    expect(plan.fixedLineItems.some((r) => r.merchantCanonical === CANONICAL)).toBe(false);
    // And with no exclusion, the mortgage's rows stay visible in the rollup.
    const rollupRows = resolveFixedCategoryAmounts({
      transactions: OWNER_ROWS,
      today,
      meta: CATEGORY_BY_ID,
      fixedMerchants: new Set<string>(),
      budgetByCategory: new Map(),
      nameOf: nameOfCategory,
    }).rows;
    const withMortgage = rollupRows.find((r) => r.categoryId === 'rent')!.amountCents;
    expect(withMortgage).toBeGreaterThan(0);
  });

  it('P1-4: an empty list names WHICH zero — a typed zero is not argued with', () => {
    const typedZero = buildFixedList({
      plan: {
        fixedBasis: 'user-set',
        suggestedFixedCents: 0,
        fixedExpensesCents: 0,
        fixedLineItems: [],
        // A typed figure has no countable remainder to list; the important
        // assertion is that the reader is told THEIR OWN zero, not the "nothing
        // counted yet" sentence and not the pattern sentence.
        fixedLineItemsCoverRemainder: false,
        reserveLines: [],
      },
      rollupRows: [],
      nameOfCategory,
    });
    expect(typedZero.note).toContain('you set yourself');
    expect(typedZero.note).not.toContain('no fixed costs this month');
    expect(typedZero.note).not.toContain('does not mean');

    const nothingCounted = buildFixedList({
      plan: {
        fixedBasis: 'none',
        suggestedFixedCents: 0,
        fixedExpensesCents: 0,
        fixedLineItems: [],
        fixedLineItemsCoverRemainder: false,
        reserveLines: [],
      },
      rollupRows: [],
      nameOfCategory,
    });
    expect(nothingCounted.note).toContain('no fixed costs this month');
  });
});

describe('the certification refuses where it cannot be earned', () => {
  it('the MEDIAN basis has no lines behind its remainder and must not certify', () => {
    const plan = planWith({
      categoryFixedCents: 0,
      categoryFixedCoveredIds: new Set<string>(),
      trailingMonthlyFixedCents: [900_000, 900_000, 900_000],
    });
    expect(plan.fixedBasis).toBe('non-discretionary-median');
    expect(plan.fixedLineItemsCoverRemainder).toBe(false);
    const list = buildFixedList({ plan, rollupRows: [], nameOfCategory });
    expect(list.reconciles).toBe(false);
    expect(list.note).toContain('spending pattern');
    // The mortgage is still NAMED — refusing to certify is not refusing to show.
    expect(list.lines.some((l) => l.label === CANONICAL)).toBe(true);
  });

  it('a reader-locked intention is never certified from these lines', () => {
    const plan = planWith({ fixedOverrideCents: 1_000_000 });
    expect(plan.fixedBasis).toBe('user-set');
    const list = buildFixedList({ plan, rollupRows: rollup(), nameOfCategory });
    expect(list.reconciles).toBe(false);
    // The printed total stays the sum of the printed lines; the reader's own
    // figure is published beside it rather than standing over lines that
    // contradict it.
    expect(list.totalCents).toBe(list.lines.reduce((s, l) => s + l.amountCents, 0));
    expect(list.planFixedCents).toBe(1_000_000);
    expect(list.note).toContain('you set yourself');
  });

  it('a rollup that disagrees with the plan it is paired with is REPORTED, not swallowed', () => {
    // The realistic drift: the loader hands `buildFixedList` a rollup computed
    // with different exclusions from the one whose total reached the plan. The
    // arithmetic is the only thing that can notice, so it must be allowed to.
    const plan = planWith();
    const shortRollup = rollup().slice(1); // one category dropped
    expect(shortRollup.length).toBeLessThan(rollup().length);
    const list = buildFixedList({ plan, rollupRows: shortRollup, nameOfCategory });
    expect(list.reconciles).toBe(false);
    expect(list.unaccountedCents).not.toBe(0);
    expect(list.note).toContain("don't add up");
  });

  // The detected-series case moved: it USED to withhold its lines here, on the
  // reasoning that its total came from a different function. The copy critic
  // falsified that as a claim rather than a design — the page then told a reader
  // whose figure was 100% detected bills that no bill had been detected. Its
  // lock now lives in the copy-critic block above (`P1-4: … NAMES its bills`),
  // asserting the opposite, and `recurringPlanExpenseCents` is implemented in
  // terms of the rows so the total and the list still cannot disagree.
});
