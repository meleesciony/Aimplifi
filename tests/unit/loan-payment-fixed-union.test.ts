/**
 * C.24 (#394) — a transfer-flagged LOAN PAYMENT is invisible to both halves of
 * the Fixed union while the pair flag is per-month timing luck. Measured live
 * in C.0/#393 on the owner's $6,217.07 Truist mortgage: paired ≤3 days in
 * May/Jun (flagged → out of every flow), 4 days in Jul and counterpart-missing
 * in Apr (unflagged → counted as ordinary rent spend), so the rollup printed
 * "rent $2,072.36" (one counted payment ÷ 3) and detection saw two unflagged
 * rows 91 days apart — no series, nothing unions.
 *
 * The fix's four moves, each locked here against the owner's exact shape:
 *  1. `loanPaymentMerchantCanonicals` identifies the class STRUCTURALLY
 *     (flagged cash outflow whose ±3-day same-|amount| pair sits on a linked
 *     LOAN/MORTGAGE account) — per MERCHANT, never per row;
 *  2. the rollup drops ALL of the merchant's rows (`excludeMerchantCanonicals`);
 *  3. detection keeps the flagged rows (the auto-loan precedent);
 *  4. the union adds the series at its monthly rate UNCONDITIONALLY — the
 *     category-level covered-skip cannot express a PARTIALLY covered category.
 */
import { describe, expect, it } from 'vitest';
import {
  loanPaymentMerchantCanonicals,
  type LoanPairTxn,
} from '@/lib/engine/categorize/transfers';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { detectRecurring, type RecurringTxn } from '@/lib/engine/recurring/detect';
import { NO_RECURRING_OVERRIDES } from '@/lib/engine/recurring/override';
import {
  averageMonthlySpendByCategory,
  resolveFixedCategoryAmounts,
} from '@/lib/engine/spending-plan/fixed-category-amounts';
import {
  computeSpendingPlan,
  recurringOutsideFixedCategoryCents,
} from '@/lib/engine/spending-plan/plan';
import { suggestedCategoryIsFixed } from '@/lib/engine/spending-plan/spend-class';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import type { TxnLike } from '@/lib/engine/fi/insights';
import { isoDate } from '@/lib/dates';

const DESCRIPTOR = 'TRUIST MORTG OLB MTGPMT';
const CANONICAL = normalizeMerchant(DESCRIPTOR).canonical;
const MORTGAGE_CENTS = 621_707; // $6,217.07 — the owner's figure
const RENT_CENTS = 207_236; // $2,072.36 — a real rent sharing the category

const ACCOUNT_TYPES = new Map([
  ['chk', 'CHECKING'],
  ['sav', 'SAVINGS'],
  ['crd', 'CREDIT'],
  ['mtg', 'MORTGAGE'],
  ['loan', 'LOAN'],
]);

function pairTxn(
  partial: Partial<LoanPairTxn> & Pick<LoanPairTxn, 'accountId' | 'date' | 'amountCents'>,
): LoanPairTxn {
  return { rawDescriptor: DESCRIPTOR, isTransfer: false, ...partial };
}

/** The owner's shape: four monthly payments, the middle two flagged by the pair. */
const OWNER_PAIR_ROWS: LoanPairTxn[] = [
  pairTxn({ accountId: 'chk', date: '2026-05-03', amountCents: -MORTGAGE_CENTS, isTransfer: true }),
  pairTxn({ accountId: 'chk', date: '2026-06-03', amountCents: -MORTGAGE_CENTS, isTransfer: true }),
  pairTxn({ accountId: 'mtg', date: '2026-05-04', amountCents: MORTGAGE_CENTS }),
  pairTxn({ accountId: 'mtg', date: '2026-06-04', amountCents: MORTGAGE_CENTS }),
];

describe('loanPaymentMerchantCanonicals (C.24 structural identification)', () => {
  it('identifies a flagged cash outflow whose pair sits on a MORTGAGE account', () => {
    const found = loanPaymentMerchantCanonicals(OWNER_PAIR_ROWS, ACCOUNT_TYPES);
    expect([...found]).toEqual([CANONICAL]);
  });

  it('identifies the merchant even when only SOME months pair (per-merchant class, not per-row)', () => {
    const rows = [
      pairTxn({ accountId: 'chk', date: '2026-04-03', amountCents: -MORTGAGE_CENTS }), // unflagged, no counterpart
      ...OWNER_PAIR_ROWS,
      pairTxn({ accountId: 'chk', date: '2026-07-03', amountCents: -MORTGAGE_CENTS }), // unflagged, settled 4 days out
      pairTxn({ accountId: 'mtg', date: '2026-07-07', amountCents: MORTGAGE_CENTS }),
    ];
    expect(loanPaymentMerchantCanonicals(rows, ACCOUNT_TYPES).has(CANONICAL)).toBe(true);
  });

  it('accepts a LOAN account as the counterpart (auto loans, not just mortgages)', () => {
    const rows = [
      pairTxn({ accountId: 'sav', date: '2026-06-03', amountCents: -38_500, isTransfer: true }),
      pairTxn({ accountId: 'loan', date: '2026-06-05', amountCents: 38_500 }),
    ];
    expect(loanPaymentMerchantCanonicals(rows, ACCOUNT_TYPES).has(CANONICAL)).toBe(true);
  });

  it('refuses when the counterpart sits on a CREDIT account (that is a card payment — settlement)', () => {
    const rows = [
      pairTxn({ accountId: 'chk', date: '2026-06-03', amountCents: -MORTGAGE_CENTS, isTransfer: true }),
      pairTxn({ accountId: 'crd', date: '2026-06-04', amountCents: MORTGAGE_CENTS }),
    ];
    expect(loanPaymentMerchantCanonicals(rows, ACCOUNT_TYPES).size).toBe(0);
  });

  it('refuses when the pair lands outside the ±3-day window', () => {
    const rows = [
      pairTxn({ accountId: 'chk', date: '2026-06-03', amountCents: -MORTGAGE_CENTS, isTransfer: true }),
      pairTxn({ accountId: 'mtg', date: '2026-06-07', amountCents: MORTGAGE_CENTS }),
    ];
    expect(loanPaymentMerchantCanonicals(rows, ACCOUNT_TYPES).size).toBe(0);
  });

  it('refuses an UNFLAGGED outflow — no transfer evidence, no class (the rollup already counts those rows)', () => {
    const rows = [
      pairTxn({ accountId: 'chk', date: '2026-06-03', amountCents: -MORTGAGE_CENTS }),
      pairTxn({ accountId: 'mtg', date: '2026-06-04', amountCents: MORTGAGE_CENTS }),
    ];
    expect(loanPaymentMerchantCanonicals(rows, ACCOUNT_TYPES).size).toBe(0);
  });

  it('refuses a flagged outflow on a CREDIT account (loan payments leave from cash)', () => {
    const rows = [
      pairTxn({ accountId: 'crd', date: '2026-06-03', amountCents: -MORTGAGE_CENTS, isTransfer: true }),
      pairTxn({ accountId: 'mtg', date: '2026-06-04', amountCents: MORTGAGE_CENTS }),
    ];
    expect(loanPaymentMerchantCanonicals(rows, ACCOUNT_TYPES).size).toBe(0);
  });

  it('refuses when the account type is unknown (no type map entry, no claim)', () => {
    expect(loanPaymentMerchantCanonicals(OWNER_PAIR_ROWS, new Map()).size).toBe(0);
  });

  it('refuses a different-|amount| inflow on the loan account', () => {
    const rows = [
      pairTxn({ accountId: 'chk', date: '2026-06-03', amountCents: -MORTGAGE_CENTS, isTransfer: true }),
      pairTxn({ accountId: 'mtg', date: '2026-06-04', amountCents: MORTGAGE_CENTS - 100 }),
    ];
    expect(loanPaymentMerchantCanonicals(rows, ACCOUNT_TYPES).size).toBe(0);
  });

  it('test_regression__aggregate_canonical_never_classifies (critic cycle 1 F3)', () => {
    // One coincidental pair must not strip EVERY payee sharing an aggregate
    // name ('Check', 'Zelle Payment', …) from the rollup — an aggregate
    // canonical is not one merchant, and varied check amounts would produce
    // no series to re-enter the money through.
    expect(normalizeMerchant('CHECK PAID #883').aggregate).toBe(true); // fixture premise
    const rows = [
      pairTxn({ accountId: 'chk', date: '2026-06-03', amountCents: -120_000, rawDescriptor: 'CHECK PAID #883', isTransfer: true }),
      pairTxn({ accountId: 'loan', date: '2026-06-05', amountCents: 120_000 }),
    ];
    expect(loanPaymentMerchantCanonicals(rows, ACCOUNT_TYPES).size).toBe(0);
  });
});

function flowTxn(
  partial: Partial<TxnLike> & Pick<TxnLike, 'date' | 'amountCents' | 'categoryId' | 'rawDescriptor'>,
): TxnLike {
  return { accountId: 'chk', isTransfer: false, status: 'POSTED', ...partial };
}

describe('rollup exclusion (C.24 — the merchant leaves the basis ENTIRELY)', () => {
  const today = isoDate('2026-08-03'); // window: May, Jun, Jul
  const realRentRows = [
    flowTxn({ date: '2026-05-02', amountCents: -RENT_CENTS, categoryId: 'rent', rawDescriptor: 'PEACHTREE PROPERTIES #402' }),
    flowTxn({ date: '2026-06-02', amountCents: -RENT_CENTS, categoryId: 'rent', rawDescriptor: 'PEACHTREE PROPERTIES #402' }),
    flowTxn({ date: '2026-07-02', amountCents: -RENT_CENTS, categoryId: 'rent', rawDescriptor: 'PEACHTREE PROPERTIES #402' }),
  ];
  const mortgageRows = [
    flowTxn({ date: '2026-04-03', amountCents: -MORTGAGE_CENTS, categoryId: 'rent', rawDescriptor: DESCRIPTOR }),
    flowTxn({ date: '2026-05-03', amountCents: -MORTGAGE_CENTS, categoryId: 'rent', rawDescriptor: DESCRIPTOR, isTransfer: true }),
    flowTxn({ date: '2026-06-03', amountCents: -MORTGAGE_CENTS, categoryId: 'rent', rawDescriptor: DESCRIPTOR, isTransfer: true }),
    flowTxn({ date: '2026-07-03', amountCents: -MORTGAGE_CENTS, categoryId: 'rent', rawDescriptor: DESCRIPTOR }),
  ];
  const exclude = new Set([CANONICAL]);

  it('control: without the exclusion the unflagged month distorts the shared category', () => {
    // FAIL-OLD shape: (3 × $2,072.36 + $6,217.07) ÷ 3 = $4,144.72 — neither the
    // real rent nor rent+mortgage; a fragment nobody can budget from.
    const typical = averageMonthlySpendByCategory([...realRentRows, ...mortgageRows], today);
    expect(typical.get('rent')).toEqual({
      amountCents: Math.round((3 * RENT_CENTS + MORTGAGE_CENTS) / 3),
      months: 3,
    });
  });

  it('with the exclusion, every mortgage row leaves — the shared category prices real rent only', () => {
    const typical = averageMonthlySpendByCategory([...realRentRows, ...mortgageRows], today, 3, exclude);
    expect(typical.get('rent')).toEqual({ amountCents: RENT_CENTS, months: 3 });
  });

  it("the owner's fragment: a mortgage-only `rent` prints $2,072.36 without the exclusion, NOTHING with it", () => {
    const before = resolveFixedCategoryAmounts({
      transactions: mortgageRows,
      today,
      meta: CATEGORY_BY_ID,
      fixedMerchants: new Set<string>(),
      budgetByCategory: new Map(),
      nameOf: (id) => CATEGORY_BY_ID.get(id)!.name,
    });
    expect(before.rows.map((r) => [r.categoryId, r.amountCents])).toEqual([
      ['rent', Math.round(MORTGAGE_CENTS / 3)], // the live defect, in miniature
    ]);
    const after = resolveFixedCategoryAmounts({
      transactions: mortgageRows,
      today,
      meta: CATEGORY_BY_ID,
      fixedMerchants: new Set<string>(),
      budgetByCategory: new Map(),
      nameOf: (id) => CATEGORY_BY_ID.get(id)!.name,
      excludeMerchantCanonicals: exclude,
    });
    expect(after.rows).toEqual([]);
    expect(after.totalCents).toBe(0);
  });
});

describe('detection keep (C.24 — the auto-loan precedent, structural)', () => {
  const recurringRows = (mark: boolean): RecurringTxn[] => [
    { id: '1', accountId: 'chk', date: '2026-04-03', amountCents: -MORTGAGE_CENTS, rawDescriptor: DESCRIPTOR },
    { id: '2', accountId: 'chk', date: '2026-05-03', amountCents: -MORTGAGE_CENTS, rawDescriptor: DESCRIPTOR, isTransfer: true, ...(mark ? { loanPayment: true } : null) },
    { id: '3', accountId: 'chk', date: '2026-06-03', amountCents: -MORTGAGE_CENTS, rawDescriptor: DESCRIPTOR, isTransfer: true, ...(mark ? { loanPayment: true } : null) },
    { id: '4', accountId: 'chk', date: '2026-07-03', amountCents: -MORTGAGE_CENTS, rawDescriptor: DESCRIPTOR },
  ];

  it('control: without the mark the flagged rows drop and two rows 91 days apart make NO series', () => {
    expect(detectRecurring(recurringRows(false), isoDate('2026-08-03'), NO_RECURRING_OVERRIDES)).toEqual([]);
  });

  it('with the mark all four rows feed detection — a MONTHLY series at the full payment', () => {
    const out = detectRecurring(recurringRows(true), isoDate('2026-08-03'), NO_RECURRING_OVERRIDES);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      merchantCanonical: CANONICAL,
      cadence: 'MONTHLY',
      typicalAmountCents: -MORTGAGE_CENTS,
      occurrences: 4,
    });
  });
});

describe('union (C.24 — structural loan payments union UNCONDITIONALLY)', () => {
  const categoryIsFixed = (id: string) => suggestedCategoryIsFixed(id, CATEGORY_BY_ID);

  it('test_regression__loan_payment_unions_despite_category_rollup_coverage', () => {
    // The partial-coverage trap that starved the mortgage: `rent` IS in the
    // rollup (real rent, or pre-fix a mortgage fragment), so the category-level
    // covered-skip would drop the series — FAIL-OLD returns 0.
    const sum = recurringOutsideFixedCategoryCents(
      [{ amountCents: -MORTGAGE_CENTS, cadence: 'MONTHLY', categoryId: 'rent', loanPayment: true }],
      categoryIsFixed,
      new Set(['rent']),
    );
    expect(sum).toBe(MORTGAGE_CENTS);
  });

  it('control: the same series WITHOUT the mark is still covered-skipped', () => {
    const sum = recurringOutsideFixedCategoryCents(
      [{ amountCents: -MORTGAGE_CENTS, cadence: 'MONTHLY', categoryId: 'rent' }],
      categoryIsFixed,
      new Set(['rent']),
    );
    expect(sum).toBe(0);
  });

  it('the settlement-never set still wins over the mark (a loan payment is never card settlement)', () => {
    const sum = recurringOutsideFixedCategoryCents(
      [{ amountCents: -MORTGAGE_CENTS, cadence: 'MONTHLY', categoryId: 'credit-card-payment', loanPayment: true }],
      categoryIsFixed,
      new Set(),
    );
    expect(sum).toBe(0);
  });

  it('test_regression__loan_payment_not_added_on_top_of_a_reader_priced_category (critic cycle 1 F2)', () => {
    // The reader priced `rent` themselves ($8,000/mo intending rent+mortgage):
    // the rollup contributes THEIR number, so the unconditional leg would
    // double-price the category. FAIL-OLD returns 621_707.
    const sum = recurringOutsideFixedCategoryCents(
      [{ amountCents: -MORTGAGE_CENTS, cadence: 'MONTHLY', categoryId: 'rent', loanPayment: true }],
      categoryIsFixed,
      new Set(['rent']),
      new Set(['rent']),
    );
    expect(sum).toBe(0);
  });

  it('the mark outranks the discretionary dial — the structure is the evidence', () => {
    const sum = recurringOutsideFixedCategoryCents(
      [{ amountCents: -MORTGAGE_CENTS, cadence: 'MONTHLY', categoryId: 'dining', loanPayment: true }],
      categoryIsFixed,
      new Set(['dining']),
    );
    expect(sum).toBe(MORTGAGE_CENTS);
  });

  it('the plan total counts the mortgage exactly once: rollup real-rent + union mortgage', () => {
    const plan = computeSpendingPlan({
      today: isoDate('2026-08-03'),
      trailingMonthlyIncomeCents: [3_000_000, 3_000_000, 3_000_000],
      scheduledIncome: [],
      scheduledFixed: [
        { amountCents: -MORTGAGE_CENTS, cadence: 'MONTHLY', categoryId: 'rent', loanPayment: true },
      ],
      trailingMonthlyFixedCents: [RENT_CENTS, RENT_CENTS, RENT_CENTS],
      categoryFixedCents: RENT_CENTS, // the rollup AFTER the exclusion: real rent only
      categoryFixedCoveredIds: new Set(['rent']),
      categoryIsFixed,
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
    });
    expect(plan.fixedBasis).toBe('category-designations');
    expect(plan.fixedExpensesCents).toBe(RENT_CENTS + MORTGAGE_CENTS); // $8,289.43, not $2,072.36 and not $14,507.14
  });
});
