/**
 * C.23 guided half (DECISIONS #431) — the Fixed-costs setup section PROPOSES
 * the detected recurring lines for the reader to confirm and edit instead of
 * typing a list, and the ONE new lever ("turn this into a monthly reserve")
 * swaps the bill for a reserve EXACTLY where the money's home makes the swap
 * exact.
 *
 * The owner, verbatim (C.23): *"The way I personally categorize yearly
 * membership dues is I divide by 12 and put that cash aside."* — the app
 * already detected the dues and already smoothed them; the settings section
 * shows the reader the line and lets them make it a reserve without retyping
 * name, amount or cadence.
 *
 * THE SAFETY PROPERTY THIS FILE LOCKS (verified against the real union before
 * writing — see `proposeFixedSetup`'s docblock): a detected series' rows are
 * fixed-classified via `fixedMerchants` whatever the category taxonomy, so a
 * series in a taxonomy-DISCRETIONARY category is usually COVERED (its money is
 * in the figure under the category's rollup), not out. The convert lever is
 * offered only where the swap is exact:
 *   inBasis        → −(union row) + (reserve at the same monthlyRateCents) = 0
 *   discretionary  → +rate exactly (money in no figure enters at the smoothed
 *                    rate; the demote changes no row's class)
 *   covered        → NOT offered (a reserve would count the money twice)
 */
import { describe, expect, it } from 'vitest';

import {
  proposeFixedSetup,
  holdingAccountClause,
  convertibleReserveCadence,
  RESERVE_CONVERTIBLE_CADENCES,
  type FixedSetupInput,
} from '@/lib/engine/spending-plan/setup-proposals';
import { billRenameKey } from '@/lib/engine/spending-plan/bill-rename';
import {
  recurringOutsideFixedCategoryRows,
  monthlyRateCents,
  type PlanScheduledItem,
} from '@/lib/engine/spending-plan/plan';
import { resolveReserves, type ReserveDeclaration } from '@/lib/engine/spending-plan/reserves';

/**
 * The loader's counted-array shape: NEGATIVE amounts for expenses (the union's
 * contract), resolved categoryId, optional loanPayment mark and canonical.
 */
function item(over: Partial<PlanScheduledItem> & Pick<PlanScheduledItem, 'amountCents' | 'cadence'>): PlanScheduledItem {
  // The union's contract types an absent canonical as `undefined` — mirror the
  // loader's shape, not the proposal's normalized null.
  return { categoryId: 'fitness', merchantCanonical: undefined, loanPayment: false, ...over };
}

/** The union's own category test: taxonomy-fixed for the named ids. */
function categoryIsFixed(fixedIds: string[]) {
  const fixed = new Set(fixedIds);
  return (id: string): boolean | null => (fixed.has(id) ? true : false);
}

/** The owner's own case — $1,200.00 of yearly dues (120_000 cents — critic
 *  round-2 P2-4 caught the comment calling it $120.00), which the app already
 *  smooths to $100.00 a month (his ÷12 and the engine's are the same). */
const DUES_TRUE_COST = 120_000;
const DUES_MONTHLY = 10_000;

const ANNUAL_DUES = item({
  amountCents: -DUES_TRUE_COST,
  cadence: 'ANNUAL',
  categoryId: 'fitness',
  merchantCanonical: 'ACME GYM',
});

describe('proposeFixedSetup — one proposal per counted expense series, verdict = the union\'s own', () => {
  it('emits exactly one row per non-income, non-settlement series — total over the loader\'s array', () => {
    const items = [
      ANNUAL_DUES,
      item({ amountCents: -25_000, cadence: 'MONTHLY', categoryId: 'rent', merchantCanonical: 'LANDLORD' }),
      item({ amountCents: -40_000, cadence: 'MONTHLY', categoryId: 'auto', loanPayment: true }),
      // Never proposed: settlement (owner 2026-08-01) and income (loader excludes).
      item({ amountCents: -50_000, cadence: 'MONTHLY', categoryId: 'credit-card-payment', merchantCanonical: 'VISA CARD' }),
      item({ amountCents: 300_000, cadence: 'MONTHLY', categoryId: 'paycheck', merchantCanonical: 'EMPLOYER' }),
    ];
    const { bills } = proposeFixedSetup({ items, categoryIsFixed: categoryIsFixed([]) });
    expect(bills).toHaveLength(3);
    expect(bills.map((b) => b.merchantCanonical)).toEqual(['ACME GYM', 'LANDLORD', null]);
  });

  it('inBasis is the union\'s OWN verdict — same builder, same sets, so the proposal and the plan cannot disagree', () => {
    const items = [
      // Fixed category, NOT covered by the rollup → the union keeps it.
      item({ amountCents: -60_000, cadence: 'ANNUAL', categoryId: 'insurance', merchantCanonical: 'GEICO' }),
      // Covered fixed category → the union defers to the rollup.
      item({ amountCents: -25_000, cadence: 'MONTHLY', categoryId: 'rent', merchantCanonical: 'LANDLORD' }),
    ];
    const rollupCovered = new Set(['rent']);
    const input: FixedSetupInput = { items, categoryIsFixed: categoryIsFixed(['insurance', 'rent']), rollupCategoryIds: rollupCovered };
    const { bills } = proposeFixedSetup(input);
    // The plan calls the SAME function; the rows it returns are the inBasis rows.
    const union = recurringOutsideFixedCategoryRows(items, input.categoryIsFixed, rollupCovered);
    const unionKeys = new Set(union.rows.map((r) => r.key));
    for (const b of bills) {
      expect(b.inBasis).toBe(unionKeys.has(b.key));
    }
    expect(bills.find((b) => b.merchantCanonical === 'GEICO')!.inBasis).toBe(true);
    expect(bills.find((b) => b.merchantCanonical === 'LANDLORD')!.inBasis).toBe(false);
    expect(bills.find((b) => b.merchantCanonical === 'LANDLORD')!.refusedReason).toBe('covered');
  });

  it('the refused reasons are the union\'s own three skips — covered, discretionary, budget-priced', () => {
    const items = [
      // Taxonomy-discretionary WITH rollup mass: the money is in the figure
      // under the category (the rows are fixed-classified via fixedMerchants)
      // — COVERED, not out. This is the case that was verified before writing:
      // a naive "discretionary ⇒ not in fixed" reading would be a false claim.
      ANNUAL_DUES,
      // No rollup mass and taxonomy-discretionary: genuinely outside the
      // figure (the reader flipped the rows, or the series is fresh).
      item({ amountCents: -30_000, cadence: 'ANNUAL', categoryId: 'gifts', merchantCanonical: 'BIRTHDAY FUND' }),
      // A loan payment in a reader-budget-priced category — the union's only
      // loan skip.
      item({ amountCents: -40_000, cadence: 'MONTHLY', categoryId: 'rent', loanPayment: true, merchantCanonical: 'MORTGAGE CO' }),
    ];
    const covered = new Set(['fitness']); // the gym gives Fitness mass
    const budgeted = new Set(['rent']);
    const { bills } = proposeFixedSetup({
      items,
      categoryIsFixed: categoryIsFixed(['rent']),
      rollupCategoryIds: covered,
      budgetCategoryIds: budgeted,
    });
    const byName = Object.fromEntries(bills.map((b) => [b.merchantCanonical, b]));
    expect(byName['ACME GYM'].inBasis).toBe(false);
    expect(byName['ACME GYM'].refusedReason).toBe('covered');
    expect(byName['BIRTHDAY FUND'].inBasis).toBe(false);
    expect(byName['BIRTHDAY FUND'].refusedReason).toBe('discretionary');
    expect(byName['MORTGAGE CO'].inBasis).toBe(false);
    expect(byName['MORTGAGE CO'].refusedReason).toBe('budget-priced');
  });

  it('carries the series\' own facts — cadence and typical amount ride the proposal so the reader never retypes them', () => {
    const { bills } = proposeFixedSetup({ items: [ANNUAL_DUES], categoryIsFixed: categoryIsFixed([]) });
    const [b] = bills;
    expect(b.cadence).toBe('ANNUAL');
    expect(b.typicalAmountCents).toBe(DUES_TRUE_COST);
    // The SAME smoothed figure the union would count — the owner's ÷12.
    expect(b.monthlyRateCents).toBe(DUES_MONTHLY);
    expect(monthlyRateCents(DUES_TRUE_COST, 'ANNUAL')).toBe(DUES_MONTHLY);
  });
});

describe('the convert lever — "turn this into a monthly reserve"', () => {
  it('is offered only on the exact-swap states: inBasis or genuinely-out, on a divided cadence, with a name', () => {
    const covered = new Set(['fitness']);
    const { bills } = proposeFixedSetup({
      items: [
        ANNUAL_DUES,                                        // covered → NO lever
        item({ amountCents: -30_000, cadence: 'ANNUAL', categoryId: 'gifts', merchantCanonical: 'GIFT FUND' }), // discretionary → lever
        item({ amountCents: -60_000, cadence: 'ANNUAL', categoryId: 'insurance', merchantCanonical: 'GEICO' }), // inBasis → lever
        item({ amountCents: -25_000, cadence: 'MONTHLY', categoryId: 'rent', merchantCanonical: 'LANDLORD' }),  // MONTHLY → never
        item({ amountCents: -40_000, cadence: 'ANNUAL', categoryId: 'auto', loanPayment: true, merchantCanonical: 'AUTO LOAN' }), // debt → never
        item({ amountCents: -60_000, cadence: 'ANNUAL', categoryId: 'insurance' }), // no name → never
      ],
      categoryIsFixed: categoryIsFixed(['insurance', 'rent']),
      rollupCategoryIds: covered,
    });
    const byName = Object.fromEntries(bills.map((b) => [b.merchantCanonical, b]));
    expect(byName['ACME GYM'].convertibleToReserve).toBe(false);
    expect(byName['GIFT FUND'].convertibleToReserve).toBe(true);
    expect(byName['GEICO'].convertibleToReserve).toBe(true);
    expect(byName['LANDLORD'].convertibleToReserve).toBe(false);
    expect(byName['AUTO LOAN'].convertibleToReserve).toBe(false);
    expect(bills.find((b) => b.merchantCanonical === null)!.convertibleToReserve).toBe(false);
  });

  it('prefills the reserve from the series — name, true cost once, cadence; the app divides', () => {
    const { bills } = proposeFixedSetup({
      items: [item({ amountCents: -60_000, cadence: 'ANNUAL', categoryId: 'insurance', merchantCanonical: 'GEICO' })],
      categoryIsFixed: categoryIsFixed(['insurance']),
    });
    const convert = bills[0].convertInput!;
    expect(convert).toEqual({ name: 'GEICO', trueCostCents: 60_000, cadence: 'ANNUAL' });
  });

  it('conserves the money on an inBasis bill: the reserve pays exactly what the union row paid', () => {
    const items = [item({ amountCents: -DUES_TRUE_COST, cadence: 'ANNUAL', categoryId: 'insurance', merchantCanonical: 'ACME GYM' })];
    const { bills } = proposeFixedSetup({ items, categoryIsFixed: categoryIsFixed(['insurance']) });
    const b = bills[0];
    expect(b.inBasis).toBe(true);
    // The swap: the union loses the row (−rate) and the reserve enters at the
    // same monthlyRateCents (+rate). One function, one figure — conservation
    // by identity, not by coincidence.
    const reserveMonthly = monthlyRateCents(b.convertInput!.trueCostCents, b.convertInput!.cadence);
    expect(reserveMonthly).toBe(b.monthlyRateCents);
    expect(reserveMonthly).toBe(DUES_MONTHLY);
  });

  it('adds money exactly on a genuinely-out series: the same identity, from zero', () => {
    const { bills } = proposeFixedSetup({
      items: [item({ amountCents: -30_000, cadence: 'ANNUAL', categoryId: 'gifts', merchantCanonical: 'GIFT FUND' })],
      categoryIsFixed: categoryIsFixed([]),
    });
    const b = bills[0];
    expect(b.refusedReason).toBe('discretionary');
    expect(monthlyRateCents(b.convertInput!.trueCostCents, b.convertInput!.cadence)).toBe(b.monthlyRateCents);
    expect(b.monthlyRateCents).toBe(2_500); // 30000 / 12
  });

  it('only the three divided rhythms are convertible — MONTHLY is a bill, full stop', () => {
    expect(RESERVE_CONVERTIBLE_CADENCES).toEqual(['QUARTERLY', 'SEMIANNUAL', 'ANNUAL']);
    for (const c of RESERVE_CONVERTIBLE_CADENCES) expect(convertibleReserveCadence(c)).toBe(true);
    for (const c of ['MONTHLY', 'WEEKLY', 'BIWEEKLY', 'IRREGULAR', 'YEARLY', null]) {
      expect(convertibleReserveCadence(c)).toBe(false);
    }
  });

  it('never offers a lever whose reserve would round to $0 a month — a dead button (critic P2-2)', () => {
    // A 5¢ annual share divides to 0¢/mo: the reserve would count nothing and
    // the write-side refuses it as "less than a cent a month". A button that
    // renders and then refuses is a lie in the other direction — the loader
    // simply never offers it.
    const { bills } = proposeFixedSetup({
      items: [
        item({ amountCents: -5, cadence: 'ANNUAL', categoryId: 'insurance', merchantCanonical: 'A FINE PENNY' }),
      ],
      categoryIsFixed: categoryIsFixed(['insurance']),
    });
    const b = bills[0];
    expect(b.inBasis).toBe(true);
    expect(b.monthlyRateCents).toBe(0); // 5 / 12 rounds to zero
    expect(b.convertibleToReserve).toBe(false);
    expect(b.convertInput).toBeNull();
  });
});

describe('the figure — "move this much to reserves this month"', () => {
  it('is the plan\'s own arithmetic: the same resolveReserves, the same reduce', () => {
    const declarations: ReserveDeclaration[] = [
      { id: 'a', name: 'Home repair', trueCostCents: 120_000, cadence: 'ANNUAL' },
      { id: 'b', name: 'Gift fund', trueCostCents: 60_000, cadence: 'QUARTERLY' },
      { id: 'c', name: 'Bad', trueCostCents: 12_000, cadence: 'FORTNIGHTLY' },
    ];
    const { reserves, refusedReserves, reserveMonthlyCents } = proposeFixedSetup({
      items: [],
      categoryIsFixed: categoryIsFixed([]),
      reserves: declarations,
    });
    const resolved = resolveReserves(declarations);
    expect(reserves).toEqual(resolved.lines);
    expect(refusedReserves).toEqual(resolved.refused);
    expect(reserveMonthlyCents).toBe(resolved.monthlyTotalCents);
    expect(reserveMonthlyCents).toBe(30_000); // 10000 + 20000; the refusal never counts
  });

  it('the holding account is a NAME — the sentence says "set aside in", never "moved by the app"', () => {
    expect(holdingAccountClause(null)).toBe('');
    expect(holdingAccountClause('')).toBe('');
    expect(holdingAccountClause('Checking')).toBe(' — set aside in Checking');
  });
});

describe('the last-resort basis — the inBasis oracle switches with the plan\'s own basis (critic P1-2)', () => {
  // The critic's executed repro: an ANNUAL $1,200.00 dues series in a
  // taxonomy-discretionary category, no rollup mass, no budgets — the plan
  // falls to the `detected-series` basis and COUNTS every non-settlement
  // series, discretionary class included (`plan.ts:901-918`; the sum is
  // `recurringPlanExpenseRows`, which this module now re-runs as its oracle).
  // The pre-fix proposal called that counted series "not in your fixed costs"
  // with a lever whose advertised +$100/mo delta was actually zero — money
  // conserved, disclosure false and self-contradictory on the same card.
  const dues = item({
    amountCents: -DUES_TRUE_COST,
    cadence: 'ANNUAL',
    categoryId: 'insurance',
    merchantCanonical: 'AUTO CLUB DUES',
  });

  it('a counted series renders inBasis on the detected-series basis, with the lever offered exactly', () => {
    const { bills } = proposeFixedSetup({
      items: [dues],
      categoryIsFixed: () => false,
      planFixedBasis: 'detected-series',
    });
    const b = bills[0];
    expect(b.inBasis).toBe(true);
    expect(b.refusedReason).toBeNull();
    expect(b.convertibleToReserve).toBe(true);
    expect(b.convertInput).toEqual({
      name: 'AUTO CLUB DUES',
      trueCostCents: DUES_TRUE_COST,
      cadence: 'ANNUAL',
    });
  });

  it('the basis switch covers every emitted series — fixed and discretionary classes alike (the plan counts both)', () => {
    const { bills } = proposeFixedSetup({
      items: [
        dues,
        item({
          amountCents: -6000,
          cadence: 'QUARTERLY',
          categoryId: 'fitness',
          merchantCanonical: 'FITNESS GYM',
        }),
      ],
      categoryIsFixed: () => false,
      planFixedBasis: 'detected-series',
    });
    expect(bills).toHaveLength(2);
    expect(bills.every((b) => b.inBasis && b.refusedReason === null)).toBe(true);
  });

  it('the union bases keep the narrower union verdict — the switch is basis-scoped (control)', () => {
    const { bills } = proposeFixedSetup({
      items: [dues],
      categoryIsFixed: () => false,
      // No planFixedBasis = the union oracle, the pre-basis behaviour — where
      // a taxonomy-discretionary series genuinely IS out of the figure, the
      // verdict and the lever must not drift to "counted".
    });
    const b = bills[0];
    expect(b.inBasis).toBe(false);
    expect(b.refusedReason).toBe('discretionary');
    expect(b.convertibleToReserve).toBe(true);
  });
});

describe('named unnamed bills can convert to a reserve (DECISIONS #595)', () => {
  it('unnamed QUARTERLY/ANNUAL in-basis series without overlay is not convertible', () => {
    for (const cadence of ['QUARTERLY', 'ANNUAL'] as const) {
      const { bills } = proposeFixedSetup({
        items: [item({ amountCents: -60_000, cadence, categoryId: 'insurance' })],
        categoryIsFixed: categoryIsFixed(['insurance']),
      });
      expect(bills).toHaveLength(1);
      expect(bills[0]!.merchantCanonical).toBe(null);
      expect(bills[0]!.inBasis).toBe(true);
      expect(bills[0]!.convertibleToReserve).toBe(false);
      expect(bills[0]!.convertInput).toBeNull();
      expect(bills[0]!.billKey).toBe(
        billRenameKey({ merchantCanonical: null, categoryId: 'insurance', cadence }),
      );
      expect(bills[0]!.billKey.startsWith('unnamed:')).toBe(true);
    }
  });

  it('with a BillRename overlay the unnamed series is convertible and the overlay is the name', () => {
    const cadence = 'ANNUAL';
    const billKey = billRenameKey({
      merchantCanonical: null,
      categoryId: 'insurance',
      cadence,
    });
    const { bills } = proposeFixedSetup({
      items: [item({ amountCents: -60_000, cadence, categoryId: 'insurance' })],
      categoryIsFixed: categoryIsFixed(['insurance']),
      billNames: new Map([[billKey, 'HOA dues']]),
    });
    expect(bills[0]!.convertibleToReserve).toBe(true);
    expect(bills[0]!.billKey).toBe(billKey);
    expect(bills[0]!.billKey).toBe('unnamed:insurance:ANNUAL');
    expect(bills[0]!.merchantCanonical).toBe(null);
    expect(bills[0]!.convertInput).toEqual({
      name: 'HOA dues',
      trueCostCents: 60_000,
      cadence: 'ANNUAL',
    });
  });
});
