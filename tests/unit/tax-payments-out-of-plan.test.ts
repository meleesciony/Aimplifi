/**
 * Charges filed as taxes are not a monthly cost in the guilt-free plan
 * (DECISIONS #783, owner 2026-10-03).
 *
 * The defect, measured on production through the shipped loader (read-only): a
 * large IRS payment filed Taxes in the last complete month — funded from a
 * brokerage — reached the Fixed category rollup, whose typical divides by the
 * months the category has been OBSERVED. A smaller filing the month before had
 * started that clock, so one payment was priced as half of itself every month
 * and the plan read the household far "over plan" for the month AFTER it. Owner:
 * "I think the app got tricked because I had a large tax payment recently …
 * but that was last month not oct" and "Certain things like tax payments
 * shouldn't be considered in budget."
 *
 * Every amount and date below is invented (keep-live-figures-out-of-repo).
 * Hand-verified values: tests/edge-cases/tax-payments-left-out-of-plan.md.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@/lib/db';
import { isoDate } from '@/lib/dates';
import { getSpendingPlan } from '@/server/spending-plan';
import {
  resolveFixedCategoryAmounts,
  taxChargesInLookback,
} from '@/lib/engine/spending-plan/fixed-category-amounts';
import { monthlyNonDiscretionaryCents } from '@/lib/engine/spending-plan/fixed-pattern';
import {
  classifySpendClass,
  outOfScopeReason,
  suggestedCategoryIsFixed,
} from '@/lib/engine/spending-plan/spend-class';
import { answerConsciousSpending, answerSafeToSpend } from '@/lib/engine/assistant/answer';
import {
  computeSpendingPlan,
  longCadencesInTerm,
  PLAN_FIXED_NEVER_CATEGORY_IDS,
  recurringOutsideFixedCategoryRows,
  recurringPlanExpenseRows,
  type PlanScheduledItem,
} from '@/lib/engine/spending-plan/plan';
import { PLAN_TAX_CATEGORY_IDS, type TaxChargesLeftOut } from '@/lib/engine/spending-plan/tax-categories';
import { taxLeftOutSentence, taxRuleSentence } from '@/lib/engine/spending-plan/tax-copy';
import { categoryName } from '@/lib/engine/categorize/categories';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { traceSafeToSpend } from '@/lib/engine/glass-box/trace';
import type { TxnLike } from '@/lib/engine/fi/insights';

const TODAY = '2026-10-03';

function row(over: Partial<TxnLike> & Pick<TxnLike, 'date' | 'amountCents'>): TxnLike {
  return {
    id: `${over.date}-${over.amountCents}-${over.categoryId ?? 'x'}`,
    rawDescriptor: 'TEST ROW',
    status: 'POSTED',
    isTransfer: false,
    isSplitParent: false,
    categoryId: null,
    ...over,
  } as TxnLike;
}

// On 2026-10-03 the Fixed typical reads Jul, Aug, Sep 2026; the tax lookback
// reads the 12 complete months Oct 2025 – Sep 2026.
const HOUSEHOLD: TxnLike[] = [
  row({ date: '2026-07-01', amountCents: -200000, categoryId: 'rent', rawDescriptor: 'MAPLE COURT APTS RENT' }),
  row({ date: '2026-08-01', amountCents: -200000, categoryId: 'rent', rawDescriptor: 'MAPLE COURT APTS RENT' }),
  row({ date: '2026-09-01', amountCents: -200000, categoryId: 'rent', rawDescriptor: 'MAPLE COURT APTS RENT' }),
  row({ date: '2026-07-12', amountCents: -15000, categoryId: 'electricity', rawDescriptor: 'RIVERTON ELECTRIC' }),
  row({ date: '2026-08-12', amountCents: -15000, categoryId: 'electricity', rawDescriptor: 'RIVERTON ELECTRIC' }),
  row({ date: '2026-09-12', amountCents: -15000, categoryId: 'electricity', rawDescriptor: 'RIVERTON ELECTRIC' }),
  // A state estimated payment in June (inside the lookback, before the window).
  row({ date: '2026-06-11', amountCents: -180000, categoryId: 'estimated-tax', rawDescriptor: 'NORTHSTATE EST PMT' }),
  // A preparer fee that starts the Taxes observation clock in August.
  row({ date: '2026-08-09', amountCents: -40000, categoryId: 'taxes', rawDescriptor: 'HILLTOP TAX PREP' }),
  // A state estimated payment and a large federal one in September.
  row({ date: '2026-09-08', amountCents: -250000, categoryId: 'estimated-tax', rawDescriptor: 'NORTHSTATE EST PMT' }),
  row({ date: '2026-09-23', amountCents: -3000000, categoryId: 'taxes', rawDescriptor: 'IRS USATAXPYMT' }),
];
const IRS = HOUSEHOLD[9];
const STATE_SEP = HOUSEHOLD[8];

describe('tax charges leave the Fixed allocation (engine)', () => {
  it('the tax leaves are exactly Taxes and Estimated Tax Payment — Property Tax stays a home cost', () => {
    expect([...PLAN_TAX_CATEGORY_IDS].sort()).toEqual(['estimated-tax', 'taxes']);
    for (const id of PLAN_TAX_CATEGORY_IDS) {
      expect(PLAN_FIXED_NEVER_CATEGORY_IDS.has(id)).toBe(true);
      expect(suggestedCategoryIsFixed(id)).toBeNull();
    }
    expect(suggestedCategoryIsFixed('property-tax')).toBe(true);
  });

  it('test_regression__a_large_tax_payment_last_month_is_not_a_monthly_fixed_cost', () => {
    const result = resolveFixedCategoryAmounts({
      transactions: HOUSEHOLD,
      today: isoDate(TODAY),
      meta: new Map(),
      fixedMerchants: new Set(),
      budgetByCategory: new Map(),
      nameOf: (id) => categoryName(id),
    });
    // Fail-old: Taxes ($400 + $30,000) / 2 observed months = $15,200.00 and
    // Estimated Tax Payment $2,500 / 3 = $833.33 entered the rollup.
    expect(result.rows.map((r) => r.categoryId).sort()).toEqual(['electricity', 'rent']);
    expect(result.totalCents).toBe(200000 + 15000);
  });

  it('test_regression__refiling_the_payment_as_estimated_tax_does_not_bring_it_back', () => {
    // Critic cycle 1, P1-1: the first cut named only `taxes`; the same IRS row
    // re-filed to the sibling leaf was its category's FIRST outflow, so it was
    // priced whole as a one-month typical.
    const refiled = HOUSEHOLD.map((t) => (t === IRS ? { ...t, categoryId: 'estimated-tax' } : t));
    const result = resolveFixedCategoryAmounts({
      transactions: refiled,
      today: isoDate(TODAY),
      meta: new Map(),
      fixedMerchants: new Set(),
      budgetByCategory: new Map(),
      nameOf: (id) => categoryName(id),
    });
    expect(result.totalCents).toBe(215000);
  });

  it('test_regression__a_taxes_target_the_reader_typed_still_counts_as_their_own_number', () => {
    // Critic cycle 1, P1-2: the rule takes tax CHARGES out; a monthly target the
    // reader set is a declaration, and dropping it would silently raise their
    // guilt-free figure by that amount.
    const result = resolveFixedCategoryAmounts({
      transactions: HOUSEHOLD,
      today: isoDate(TODAY),
      meta: new Map(),
      fixedMerchants: new Set(),
      budgetByCategory: new Map([['taxes', 50000]]),
      nameOf: (id) => categoryName(id),
    });
    const taxes = result.rows.find((r) => r.categoryId === 'taxes');
    expect(taxes).toMatchObject({ amountCents: 50000, basis: 'budget-target', typicalCents: 0 });
    expect(result.totalCents).toBe(215000 + 50000);
  });

  it('the median basis leaves the tax months alone too', () => {
    expect(monthlyNonDiscretionaryCents(HOUSEHOLD)).toEqual([
      { month: '2026-07', expenseCents: 215000 },
      { month: '2026-08', expenseCents: 215000 },
      { month: '2026-09', expenseCents: 215000 },
    ]);
  });

  it('a tax row is out of scope with its own reason — even one the reader marked Fixed; Property Tax keeps its dial', () => {
    for (const t of [IRS, STATE_SEP]) {
      expect(classifySpendClass(t)).toBe('out-of-scope');
      expect(outOfScopeReason(t, 'out-of-scope')).toBe('taxes');
      expect(classifySpendClass({ ...t, spendClassOverride: 'fixed' } as TxnLike)).toBe('out-of-scope');
    }
    const property = row({ date: '2026-09-30', amountCents: -310000, categoryId: 'property-tax', rawDescriptor: 'COUNTY TREASURER' });
    expect(classifySpendClass(property)).toBe('fixed');
  });

  it('a detected tax series does not union back into Fixed on any basis', () => {
    // Quarterly estimated payments detected as a series: the union reads the tax
    // leaves as categories the rollup does not cover, so without the never-set it
    // would add a third of each payment every month.
    const series: PlanScheduledItem[] = [
      { amountCents: -120000, cadence: 'QUARTERLY', categoryId: 'taxes', merchantCanonical: 'Irs Usataxpymt' },
      { amountCents: -90000, cadence: 'QUARTERLY', categoryId: 'estimated-tax', merchantCanonical: 'Northstate Est Pmt' },
      { amountCents: -15000, cadence: 'MONTHLY', categoryId: 'electricity', merchantCanonical: 'Riverton Electric' },
      { amountCents: -300000, cadence: 'SEMIANNUAL', categoryId: 'property-tax', merchantCanonical: 'County Treasurer' },
    ];
    const isFixed = (id: string) => suggestedCategoryIsFixed(id);
    const union = recurringOutsideFixedCategoryRows(series, isFixed, new Set(['electricity']));
    // Only the property tax unions (it is a Fixed category the rollup does not cover).
    expect(union.rows.map((r) => r.categoryId)).toEqual(['property-tax']);
    expect(union.totalCents).toBe(50000);
    // The last-resort detected-series basis counts every non-settlement series
    // regardless of class — the tax leaves must be refused there as well.
    const fallback = recurringPlanExpenseRows(series);
    expect(fallback.rows.map((r) => r.categoryId)).toEqual(['electricity', 'property-tax']);
    expect(fallback.totalCents).toBe(15000 + 50000);
  });

  it('counts what it left out over the 12-month lookback, and nothing outside it', () => {
    const noise = [
      ...HOUSEHOLD,
      // Sep 2025 is the 13th month back; October 2026 is the current month.
      row({ date: '2025-09-15', amountCents: -90000, categoryId: 'taxes' }),
      row({ date: '2026-10-01', amountCents: -80000, categoryId: 'taxes' }),
      // Pending, transfer-flagged and excluded rows never reached any typical.
      row({ date: '2026-09-20', amountCents: -70000, categoryId: 'taxes', status: 'PENDING' }),
      row({ date: '2026-09-21', amountCents: -60000, categoryId: 'taxes', isTransfer: true }),
      row({ date: '2026-09-21', amountCents: -55000, categoryId: 'taxes', excludeFromTotals: true } as Partial<TxnLike> & Pick<TxnLike, 'date' | 'amountCents'>),
      // A refund inflow filed under taxes is not a payment.
      row({ date: '2026-09-22', amountCents: 50000, categoryId: 'taxes' }),
      // Property tax is counted by the plan, so it is not "left out".
      row({ date: '2026-09-30', amountCents: -310000, categoryId: 'property-tax' }),
    ];
    expect(taxChargesInLookback(noise, isoDate(TODAY))).toEqual({
      count: 4,
      totalCents: 180000 + 40000 + 250000 + 3000000,
      months: 12,
    });
    expect(taxChargesInLookback(HOUSEHOLD.slice(0, 6), isoDate(TODAY))).toEqual({
      count: 0,
      totalCents: 0,
      months: 12,
    });
  });

  it('a tax bill already converted to a reserve is the reserve’s money, not "left out"', () => {
    const converted = new Set([normalizeMerchant(IRS.rawDescriptor).canonical]);
    expect(taxChargesInLookback(HOUSEHOLD, isoDate(TODAY), undefined, converted)).toEqual({
      count: 3,
      totalCents: 180000 + 40000 + 250000,
      months: 12,
    });
  });
});

/** A throwaway real user on the unit DB, wiped before and after. */
function loaderUser(prefix: string) {
  const USER = `${prefix}-${Date.now()}-${process.pid}`;
  const wipe = async () => {
    await prisma.recurringSeries.deleteMany({ where: { userId: USER } });
    await prisma.scheduledTransaction.deleteMany({ where: { account: { userId: USER } } });
    await prisma.transaction.deleteMany({ where: { account: { userId: USER } } });
    await prisma.user.updateMany({ where: { id: USER }, data: { paymentAccountId: null } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  };
  const seed = async (
    savingsTargetBps: number | null,
    rows: { date: string; amountCents: number; rawDescriptor: string; categoryId: string | null; isTransfer?: boolean }[],
  ) => {
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local`, savingsTargetBps } });
    const checking = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'manual',
        providerRef: `${USER}-chk`,
        name: 'Everyday Checking',
        type: 'CHECKING',
        currentBalanceCents: 900000,
        currency: 'USD',
      },
    });
    await prisma.user.update({ where: { id: USER }, data: { paymentAccountId: checking.id } });
    await prisma.transaction.createMany({
      data: rows.map((r) => ({
        accountId: checking.id,
        date: r.date,
        amountCents: r.amountCents,
        rawDescriptor: r.rawDescriptor,
        categoryId: r.categoryId,
        isTransfer: r.isTransfer ?? false,
        confidenceBps: 10000,
        needsReview: false,
      })),
    });
  };
  return { USER, wipe, seed };
}

describe('tax charges leave the Fixed allocation (real loader)', () => {
  const u = loaderUser('tax-out');

  beforeAll(async () => {
    vi.stubEnv('DEMO_TODAY', TODAY);
    await u.wipe();
    const pay = (date: string) => ({ date, amountCents: 600000, rawDescriptor: 'NORTHWIND LLC PAYROLL', categoryId: 'paycheck' });
    // Savings target 20% of pattern income.
    await u.seed(2000, [
      pay('2026-07-17'),
      pay('2026-08-17'),
      pay('2026-09-17'),
      // The brokerage money that funded the IRS payment: a transfer, so it is in
      // no income month — which is why the payment it funded must not be charged
      // to the paycheck pattern either.
      { date: '2026-09-22', amountCents: 2800000, rawDescriptor: 'TRANSFER FROM BROKERAGE', categoryId: 'transfer', isTransfer: true },
      ...HOUSEHOLD.map((t) => ({ date: t.date, amountCents: t.amountCents, rawDescriptor: t.rawDescriptor, categoryId: t.categoryId ?? null })),
    ]);
  }, 60_000);

  afterAll(async () => {
    await u.wipe();
    vi.unstubAllEnvs();
  });

  it('test_regression__the_month_after_a_large_tax_payment_is_not_over_plan', async () => {
    vi.stubEnv('DEMO_TODAY', TODAY);
    const plan = await getSpendingPlan(u.USER);
    expect(plan.patternIncomeCents).toBe(600000);
    expect(plan.fixedBasis).toBe('category-designations');
    // Rent $2,000.00 + electricity $150.00 — no tax line on either leaf.
    expect(plan.fixedExpensesCents).toBe(215000);
    expect(plan.plannedSavingsCents).toBe(120000);
    expect(plan.leftToSpendCents).toBe(600000 - 215000 - 120000);
    expect(plan.overspent).toBe(false);
    // The list under the figure still reaches it to the penny, with no tax line.
    expect(plan.fixedList.lines.map((l) => l.label)).not.toContain('Taxes');
    expect(plan.fixedList.lines.map((l) => l.label)).not.toContain('Estimated Tax Payment');
    expect(plan.fixedList.totalCents).toBe(215000);
    // And the money is still visible on the disclosures every surface reads.
    expect(plan.disclosures.taxChargesLeftOut).toEqual({
      count: 4,
      totalCents: 3470000,
      months: 12,
      targetCents: 0,
      names: {
        taxes: 'Taxes',
        estimatedTax: 'Estimated Tax Payment',
        propertyTax: 'Property Tax',
        financial: 'Financial & Professional',
      },
    });
  });
});

describe('a detected tax series the normalizer does not recognise stays out (real loader)', () => {
  // Critic cycle 1, P2-5: the loader's filed-category remap refuses a remap INTO
  // the never-set; a state payee the normalizer guesses as something else, filed
  // Taxes by the reader, would keep the guess and union straight back into Fixed.
  const DESC = 'COMMONWEALTH DOR ESTPMT';
  const u = loaderUser('tax-remap');

  beforeAll(async () => {
    vi.stubEnv('DEMO_TODAY', TODAY);
    await u.wipe();
    const pay = (date: string) => ({ date, amountCents: 500000, rawDescriptor: 'NORTHWIND LLC PAYROLL', categoryId: 'paycheck' });
    const groceries = (date: string) => ({ date, amountCents: -60000, rawDescriptor: 'GREENLEAF MARKET', categoryId: 'groceries' });
    const quarterly = (date: string) => ({ date, amountCents: -90000, rawDescriptor: DESC, categoryId: 'taxes' });
    await u.seed(null, [
      pay('2026-07-17'), pay('2026-08-17'), pay('2026-09-17'),
      groceries('2026-07-09'), groceries('2026-08-09'), groceries('2026-09-09'),
      quarterly('2026-01-20'), quarterly('2026-04-20'), quarterly('2026-07-20'),
    ]);
  }, 60_000);

  afterAll(async () => {
    await u.wipe();
    vi.unstubAllEnvs();
  });

  it('test_regression__a_state_tax_series_filed_as_taxes_does_not_union_back_in', async () => {
    vi.stubEnv('DEMO_TODAY', TODAY);
    // The precondition that makes the remap matter: the normalizer's guess is
    // outside the never-set, so the old guard would have kept it.
    const guess = normalizeMerchant(DESC).categoryId;
    expect(guess === null || !PLAN_FIXED_NEVER_CATEGORY_IDS.has(guess)).toBe(true);
    const plan = await getSpendingPlan(u.USER);
    // The series is detected and counted by the projection…
    expect(plan.scheduledFixed.some((s) => s.cadence === 'QUARTERLY' && s.categoryId === 'taxes')).toBe(true);
    // …and still never reaches Fixed. Fail-old (remap clause removed): the
    // series kept its guess and unioned at $900 / 3 = $300.00 a month.
    expect(plan.fixedExpensesCents).toBe(60000);
    expect(plan.fixedLineItems).toEqual([]);
    expect(plan.leftToSpendCents).toBe(500000 - 60000);
    // Critic cycle 2, P1-1, on this exact household: no surface may say the
    // quarterly tax bill is spread across the quarter — it is in no term at all.
    expect(longCadencesInTerm(plan.scheduledFixed)).toEqual([]);
    expect(JSON.stringify(traceSafeToSpend(plan, plan.disclosures))).not.toContain('a third of it');
  });
});

describe('a Taxes target and a renamed category reach the figure and the copy (real loader)', () => {
  const u = loaderUser('tax-target');

  beforeAll(async () => {
    vi.stubEnv('DEMO_TODAY', TODAY);
    await u.wipe();
    const pay = (date: string) => ({ date, amountCents: 500000, rawDescriptor: 'NORTHWIND LLC PAYROLL', categoryId: 'paycheck' });
    const groceries = (date: string) => ({ date, amountCents: -60000, rawDescriptor: 'GREENLEAF MARKET', categoryId: 'groceries' });
    await u.seed(null, [
      pay('2026-07-17'), pay('2026-08-17'), pay('2026-09-17'),
      groceries('2026-07-09'), groceries('2026-08-09'), groceries('2026-09-09'),
      { date: '2026-09-23', amountCents: -1200000, rawDescriptor: 'IRS USATAXPYMT', categoryId: 'taxes' },
    ]);
    await prisma.budget.create({ data: { userId: u.USER, categoryId: 'taxes', monthCents: 50000 } });
    await prisma.categoryRename.create({ data: { userId: u.USER, categoryId: 'property-tax', name: 'Home taxes' } });
  }, 60_000);

  afterAll(async () => {
    await prisma.budget.deleteMany({ where: { userId: u.USER } });
    await prisma.categoryRename.deleteMany({ where: { userId: u.USER } });
    await u.wipe();
    vi.unstubAllEnvs();
  });

  it('the target is in Fixed, the copy says so, and names the reader\'s own category', async () => {
    vi.stubEnv('DEMO_TODAY', TODAY);
    const plan = await getSpendingPlan(u.USER);
    // Groceries $600.00 + the reader's $500.00 tax target; the IRS charge itself is out.
    expect(plan.fixedExpensesCents).toBe(60000 + 50000);
    expect(plan.leftToSpendCents).toBe(500000 - 110000);
    const left = plan.disclosures.taxChargesLeftOut;
    expect(left).toMatchObject({ count: 1, totalCents: 1200000, months: 12, targetCents: 50000 });
    expect(left.names?.propertyTax).toBe('Home taxes');
    const text = taxLeftOutSentence(left, null);
    expect(text).toContain('Your monthly tax target of $500.00 is counted in their place.');
    expect(text).toContain('file it under Home taxes and it counts');
  });
});

describe('one author states the rule on every surface (tax-copy.ts)', () => {
  // Critic cycle 1, P2-2 / cycle 2, P2-1, P2-3, P2-4: Ask is untraced, /budgets'
  // strip prints the same split, and three hand-written variants had already
  // drifted on scope and levers.
  const disclosures = (left: Partial<TaxChargesLeftOut> & { count: number; totalCents: number }) => ({
    undatedCards: [],
    statementPendingCards: [],
    duplicatePairs: [],
    frozenCards: [],
    creditCardCount: 0,
    creditCardsOutsideFigure: 0,
    cardsDatedAfterThisMonth: 0,
    fixedSeries: { detected: 0, counted: 0, onCard: 0, lapsed: 0, uncounted: 0, noCashAccount: 0 },
    taxChargesLeftOut: { months: 12, targetCents: 0, ...left },
  });
  const plan = (categoryFixedCents: number, fixedOverrideCents: number | null = null) =>
    computeSpendingPlan({
      today: isoDate(TODAY),
      trailingMonthlyIncomeCents: [600000, 600000, 600000],
      scheduledIncome: [],
      scheduledFixed: [],
      categoryFixedCents,
      fixedOverrideCents,
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
    });
  const LEFT_OUT = 'Not counted here: $30,400.00 filed as taxes in your last 12 complete months (2 charges).';

  it('the sentence names the total, both levers, and the property-tax way back', () => {
    const text = taxLeftOutSentence({ count: 2, totalCents: 3040000, months: 12, targetCents: 0 }, null);
    expect(text).toContain(LEFT_OUT);
    expect(text).toContain(
      'If one of these was property tax on your home, file it under Property Tax and it counts; a tax-prep fee, under Financial & Professional.',
    );
    expect(text).toContain('“Money you set aside each month”');
    expect(text).not.toContain('until you do');
    expect(taxLeftOutSentence({ count: 1, totalCents: 40000, months: 12, targetCents: 0 }, null)).toContain(
      '(1 charge).',
    );
  });

  it('test_regression__a_reader_with_a_tax_target_is_not_told_to_set_money_aside_again', () => {
    const text = taxLeftOutSentence(
      { count: 2, totalCents: 3040000, months: 12, targetCents: 50000 },
      'left-to-spend',
    );
    expect(text).toContain('Your monthly tax target of $500.00 is counted in their place.');
    expect(text).not.toContain('Money you set aside each month');
    expect(text).not.toContain('room to spend is smaller');
  });

  it('a reader who renamed the categories is pointed at the names their picker shows', () => {
    const names = { taxes: 'Income taxes', estimatedTax: 'Quarterly taxes', propertyTax: 'Home taxes', financial: 'Pros' };
    expect(taxRuleSentence(names)).toContain('Charges filed as Income taxes or Quarterly taxes are never counted here');
    expect(taxRuleSentence(names)).toContain('(Home taxes still counts, as a cost of your home)');
    const text = taxLeftOutSentence({ count: 1, totalCents: 40000, months: 12, targetCents: 0, names }, null);
    expect(text).toContain('file it under Home taxes and it counts; a tax-prep fee, under Pros.');
  });

  it('Ask, room to spend: the real room is smaller for a reader paying estimates from pay', () => {
    const a = answerSafeToSpend(plan(215000), disclosures({ count: 2, totalCents: 3040000 }));
    expect(a.headline).toBe('Your guilt-free allocation this month is $3,850.00.');
    expect(a.detail).toContain(LEFT_OUT);
    expect(a.detail).toContain('until you do, your real room to spend is smaller by those payments');
    expect(a.detail).not.toContain('overage');
  });

  it('Ask, over plan: the real overage is bigger', () => {
    const a = answerSafeToSpend(plan(900000), disclosures({ count: 2, totalCents: 3040000 }));
    expect(a.headline).toBe("You're $3,000.00 over your plan for this month.");
    expect(a.detail).toContain('until you do, your real overage is bigger by those payments');
  });

  it('Ask under a Fixed override claims no direction — the typed figure may already hold the taxes', () => {
    const a = answerSafeToSpend(plan(215000, 300000), disclosures({ count: 2, totalCents: 3040000 }));
    expect(a.detail).toContain(LEFT_OUT);
    expect(a.detail).not.toContain('until you do');
  });

  it('Ask conscious spending carries the sentence, left-to-spend even when overspent (it prints the signed figure)', () => {
    const a = answerConsciousSpending(plan(900000), disclosures({ count: 2, totalCents: 3040000 }));
    expect(a.detail).toContain(LEFT_OUT);
    expect(a.detail).toContain('your real room to spend is smaller by those payments');
    expect(a.detail).not.toContain('overage is bigger');
  });

  it('no tax charges: no tax sentence on either Ask answer', () => {
    const none = disclosures({ count: 0, totalCents: 0 });
    expect(answerSafeToSpend(plan(215000), none).detail).not.toContain('filed as taxes');
    expect(answerConsciousSpending(plan(215000), none).detail ?? '').not.toContain('filed as taxes');
  });
});

describe('a long-cadence note may only describe a bill that is in the term', () => {
  it('test_regression__a_quarterly_tax_series_is_not_counted_a_third_at_a_time', () => {
    // Critic cycle 2, P1-1: Home and the glass box both read `scheduledFixed`,
    // which holds every counted series — tax ones included — and told a quarterly
    // estimated-tax payer the bill was "counted here a third at a time" beside a
    // figure that counts it at $0.
    expect(longCadencesInTerm([{ cadence: 'QUARTERLY', categoryId: 'taxes' }])).toEqual([]);
    expect(longCadencesInTerm([{ cadence: 'QUARTERLY', categoryId: 'estimated-tax' }])).toEqual([]);
    expect(longCadencesInTerm([{ cadence: 'ANNUAL', categoryId: 'investment' }])).toEqual([]);
    // A real long-cadence bill still speaks — with or without a category.
    expect(
      longCadencesInTerm([
        { cadence: 'QUARTERLY', categoryId: 'taxes' },
        { cadence: 'QUARTERLY', categoryId: 'auto-insurance' },
        { cadence: 'ANNUAL', categoryId: null },
      ]),
    ).toEqual(['QUARTERLY', 'ANNUAL']);
    expect(longCadencesInTerm([{ cadence: 'SEMIANNUAL' }])).toEqual(['SEMIANNUAL']);
  });
});

describe('property-tax descriptors file as Property Tax, which the plan still counts', () => {
  it('test_regression__property_taxes_spelled_with_es_are_not_filed_as_taxes', () => {
    // Critic cycle 2, P1-2: `\bPROP(ERTY)? TAX\b` cannot match "TAXES", so the
    // commonest county descriptors fell through to the general taxes rule — which
    // the plan now leaves out.
    for (const d of [
      'PROPERTY TAXES',
      'HARRIS COUNTY PROPERTY TAXES',
      'REAL ESTATE TAXES',
      'SCHOOL TAXES',
      'COUNTY TAXES ONLINE',
      'COUNTY TAX COLLECTOR',
      'PROPERTY TAX PMT',
      'COUNTY OF TRAVIS PROP TAX WEB PMT',
    ]) {
      expect(normalizeMerchant(d).categoryId, d).toBe('property-tax');
    }
    // Income-tax payees keep filing as taxes.
    for (const d of ['IRS USATAXPYMT', 'STATE DEPT OF REVENUE PMT', 'FRANCHISE TAX BD', 'TURBOTAX']) {
      expect(normalizeMerchant(d).categoryId, d).toBe('taxes');
    }
  });
});

describe('a property-tax series an older categorizer filed as Taxes stays counted (real loader)', () => {
  // Critic cycle 3, P2-B: the categorizer fix reaches only new rows, so a county
  // "PROPERTY TAXES" payee filed Taxes before it keeps that filing. The remap may
  // not let that stale tax filing carry a home cost into the never-counted set
  // when today's guess is a Fixed category.
  const DESC = 'HARRIS COUNTY PROPERTY TAXES';
  const u = loaderUser('tax-stale-prop');

  beforeAll(async () => {
    vi.stubEnv('DEMO_TODAY', TODAY);
    await u.wipe();
    const pay = (date: string) => ({ date, amountCents: 500000, rawDescriptor: 'NORTHWIND LLC PAYROLL', categoryId: 'paycheck' });
    const groceries = (date: string) => ({ date, amountCents: -60000, rawDescriptor: 'GREENLEAF MARKET', categoryId: 'groceries' });
    const twiceAYear = (date: string) => ({ date, amountCents: -300000, rawDescriptor: DESC, categoryId: 'taxes' });
    await u.seed(null, [
      pay('2026-07-17'), pay('2026-08-17'), pay('2026-09-17'),
      groceries('2026-07-09'), groceries('2026-08-09'), groceries('2026-09-09'),
      twiceAYear('2025-04-14'), twiceAYear('2025-10-14'), twiceAYear('2026-04-14'),
    ]);
  }, 60_000);

  afterAll(async () => {
    await u.wipe();
    vi.unstubAllEnvs();
  });

  it('test_regression__a_stale_taxes_filing_does_not_drop_a_property_tax_series', async () => {
    vi.stubEnv('DEMO_TODAY', TODAY);
    expect(normalizeMerchant(DESC).categoryId).toBe('property-tax');
    const plan = await getSpendingPlan(u.USER);
    // Groceries $600.00 + the property tax at $3,000 / 6 = $500.00 a month.
    // Fail-old (tax filing always wins): Fixed $600.00, the home cost dropped.
    expect(plan.fixedExpensesCents).toBe(60000 + 50000);
    expect(plan.fixedLineItems.map((r) => r.categoryId)).toEqual(['property-tax']);
    // Counted money is not "left out": the sentence stays silent about it.
    expect(plan.disclosures.taxChargesLeftOut.count).toBe(0);
  });
});
