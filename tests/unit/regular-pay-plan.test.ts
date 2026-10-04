/**
 * Regular pay plans the month — the plan basis, every surface that explains it,
 * and the real loader (DECISIONS #785). Invented figures throughout
 * (keep-live-figures-out-of-repo). Hand-verified values:
 * tests/edge-cases/regular-pay-plans-the-month.md.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@/lib/db';
import { isoDate } from '@/lib/dates';
import { getSpendingPlan } from '@/server/spending-plan';
import { computeSpendingPlan, type SpendingPlanInput } from '@/lib/engine/spending-plan/plan';
import { regularPayBasisSentence, type RegularPay } from '@/lib/engine/spending-plan/regular-pay';
import { planRowLabels } from '@/lib/engine/spending-plan/row-labels';
import { traceSafeToSpend } from '@/lib/engine/glass-box/trace';
import { answerSafeToSpend } from '@/lib/engine/assistant/answer';

const TODAY = '2026-10-03';

const STREAM = {
  payerCanonical: 'Northwind Health Payroll',
  frequency: 'biweekly' as const,
  paycheckCents: 451230,
  monthlyCents: 977665,
  firstPaidOn: isoDate('2026-06-12'),
  lastPaidOn: isoDate('2026-10-02'),
};
const PAY: RegularPay = {
  clean: true,
  fallback: null,
  streamsMonthlyCents: 977665,
  streams: [STREAM],
  otherMonthlyCents: 0,
  monthlyCents: 977665,
};
const NONE: RegularPay = {
  clean: false,
  fallback: 'no-steady-paycheck',
  streamsMonthlyCents: 0,
  streams: [],
  otherMonthlyCents: 0,
  monthlyCents: 0,
};

const DISCLOSURES = {
  undatedCards: [],
  statementPendingCards: [],
  duplicatePairs: [],
  frozenCards: [],
  creditCardCount: 0,
  creditCardsOutsideFigure: 0,
  cardsDatedAfterThisMonth: 0,
  fixedSeries: { detected: 0, counted: 0, onCard: 0, lapsed: 0, uncounted: 0, noCashAccount: 0 },
  taxChargesLeftOut: { count: 0, totalCents: 0, months: 12, targetCents: 0 },
};

function input(over: Partial<SpendingPlanInput> = {}): SpendingPlanInput {
  return {
    today: isoDate(TODAY),
    trailingMonthlyIncomeCents: [902460, 1353690, 902460],
    scheduledIncome: [],
    scheduledFixed: [],
    categoryFixedCents: 500000,
    cardObligationsCents: 0,
    cardObligationsEstimated: false,
    obligationsBeyondMonthCents: 0,
    obligationsBeyondMonthThroughDate: null,
    obligationsBeyondMonthEstimated: false,
    goalContributionsCents: 0,
    savingsTargetBps: 2000,
    ...over,
  };
}

describe('the plan basis', () => {
  it('test_regression__regular_pay_plans_the_month_instead_of_the_calendar_month_median', () => {
    // Fail-old: the median of [$9,024.60, $13,536.90, $9,024.60] — two paychecks,
    // three paychecks, two paychecks — is $9,024.60, below the $9,776.65 the
    // reader is paid on average every month of the year.
    const p = computeSpendingPlan(input({ regularPay: PAY }));
    expect(p.incomeBasis).toBe('regular-pay');
    expect(p.patternIncomeCents).toBe(977665);
    expect(p.suggestedIncomeCents).toBe(977665);
    // Savings 20% of $9,776.65 = $1,955.33; guilt-free = 9,776.65 − 5,000 − 1,955.33.
    expect(p.plannedSavingsCents).toBe(195533);
    expect(p.leftToSpendCents).toBe(977665 - 500000 - 195533);
  });

  it('no rhythm → the median, exactly as before; a typed income still wins over both', () => {
    expect(computeSpendingPlan(input({ regularPay: NONE }))).toMatchObject({
      incomeBasis: 'trailing-median',
      patternIncomeCents: 902460,
    });
    expect(computeSpendingPlan(input())).toMatchObject({ incomeBasis: 'trailing-median', patternIncomeCents: 902460 });
    const typed = computeSpendingPlan(input({ regularPay: PAY, incomeOverrideCents: 800000 }));
    expect(typed).toMatchObject({ incomeBasis: 'user-set', patternIncomeCents: 800000, suggestedIncomeCents: 977665 });
  });

  it('a household the rule does not clearly understand keeps the median, even with a figure in hand', () => {
    // Defence in depth: the plan reads `clean`, not only a positive figure.
    const messy: RegularPay = { ...PAY, clean: false, fallback: 'other-income' };
    expect(computeSpendingPlan(input({ regularPay: messy }))).toMatchObject({
      incomeBasis: 'trailing-median',
      patternIncomeCents: 902460,
    });
  });
});

describe('every surface explains the basis with one sentence', () => {
  const plan = computeSpendingPlan(input({ regularPay: PAY }));
  // No account clause: the loader reads the payment account, or every checking
  // account when none is set (critic cycles 6 and 7, P3).
  const SENTENCE =
    'Income is your regular pay at its yearly rate: $4,512.30 every two weeks × 26 ÷ 12 ($9,776.65 a month) = $9,776.65 a month.';

  it('the sentence shows the arithmetic and what is left out', () => {
    expect(regularPayBasisSentence(PAY)).toContain(SENTENCE);
    // Stated as the condition it depends on — a school-year payroll does not land
    // three times in two months (critic cycle 8, P3-2).
    expect(regularPayBasisSentence(PAY)).toContain('Paid every two weeks all year, a paycheck lands twice in most months and three times in two months');
    // Names exactly what the figure and its 10% test read (critic cycle 8, P2-2:
    // a pension filed Retirement Income was neither counted nor named).
    expect(regularPayBasisSentence(PAY)).toContain(
      'Only deposits filed Paycheck, Side Gig / Freelance or Income count here; a bonus, every other income category (Investment Income, Interest Income, Rental Income, Retirement Income and the rest) and money moved in from your other accounts are left out.',
    );
    const semi: RegularPay = {
      clean: true,
      fallback: null,
      streamsMonthlyCents: 600000,
      streams: [{ ...STREAM, payerCanonical: 'Lakeside Schools', frequency: 'semimonthly', paycheckCents: 300000, monthlyCents: 600000 }],
      otherMonthlyCents: 50000,
      monthlyCents: 650000,
    };
    expect(regularPayBasisSentence(semi)).toContain(
      'Income is your regular pay at its yearly rate: $3,000.00 about twice a month × 24 ÷ 12 ($6,000.00 a month) plus $500.00, the usual month of your other income (the median of your last 3 complete months) = $6,500.00 a month.',
    );
    // A monthly paycheck shows no multiplier, and no cash-timing clause.
    const monthly: RegularPay = { ...PAY, streams: [{ ...STREAM, frequency: 'monthly', paycheckCents: 520000, monthlyCents: 520000 }], streamsMonthlyCents: 520000, monthlyCents: 520000 };
    expect(regularPayBasisSentence(monthly)).toContain('$5,200.00 every month = $5,200.00 a month.');
    expect(regularPayBasisSentence(monthly)).not.toContain('three times');
    // A 24-a-year stream says what the count is and why — it may be a new
    // every-two-weeks payroll not yet confirmed (critic cycle 4, P2-2).
    expect(regularPayBasisSentence(semi)).toContain('Pay counted 24 times a year is pay about twice a month — or pay every two weeks whose dates do not yet confirm it, counted the lower way.');
    expect(regularPayBasisSentence(PAY)).not.toContain('24 times a year');
    // It states the rule the figure applies under, in the code's own terms
    // (critic cycle 6, P1-2: "a raise" promised a fallback a 3% raise never got;
    // cycle 7, P2-4: "a second income" promised one a small one never got).
    expect(regularPayBasisSentence(PAY)).toContain(
      'This figure is used only while one steady paycheck explains your pay: paid without a break since before your last three complete months, within 2% across its last eight paychecks, no other regular paycheck in that time, and the rest of those deposits no more than a tenth of a usual month’s pay. Otherwise the plan uses the median of your last three complete months. Within that 2%, a raise counts here once most of your last eight paychecks show it; a cut counts at once.',
    );
  });

  it('the income row, the glass box and both Ask branches carry it — never "no pattern yet"', () => {
    expect(planRowLabels(plan, DISCLOSURES).income.label).toBe('Income (regular pay, monthly average)');
    expect(JSON.stringify(traceSafeToSpend(plan, DISCLOSURES))).toContain(SENTENCE);
    expect(answerSafeToSpend(plan, DISCLOSURES).detail).toContain(SENTENCE);
    const over = computeSpendingPlan(input({ regularPay: PAY, categoryFixedCents: 900000 }));
    expect(over.overspent).toBe(true);
    const a = answerSafeToSpend(over, DISCLOSURES);
    expect(a.detail).toContain(SENTENCE);
    expect(a.detail).not.toContain('no income pattern');
  });

  it('the /budgets note names the basis', () => {
    const card = readFileSync(resolve('src/components/finance/budgeting-composition-card.tsx'), 'utf8');
    expect(card).toContain("plan.incomeBasis === 'regular-pay'");
    expect(card).toContain('your regular pay averaged over the year');
  });
});

describe('the real loader', () => {
  const USER = `regular-pay-${Date.now()}-${process.pid}`;
  const PAYROLL = 'NORTHWIND HEALTH PAYROLL PPD';

  beforeAll(async () => {
    vi.stubEnv('DEMO_TODAY', TODAY);
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local`, savingsTargetBps: 2000 } });
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
    const row = (date: string, cents: number, rawDescriptor = PAYROLL, categoryId = 'paycheck') => ({
      accountId: checking.id,
      date,
      amountCents: cents,
      rawDescriptor,
      categoryId,
      confidenceBps: 10000,
      needsReview: false,
    });
    await prisma.transaction.createMany({
      data: [
        // Biweekly: one paycheck before a raise, then eight at one level with a
        // cent of drift.
        row('2026-06-12', 421055),
        row('2026-06-26', 451230),
        row('2026-07-10', 451231),
        row('2026-07-24', 451230),
        row('2026-08-07', 451231),
        row('2026-08-21', 451230),
        row('2026-09-04', 451230),
        row('2026-09-18', 451231),
        row('2026-10-02', 451230),
        // A fund filed under generic Income (not the Investment Income leaf): a
        // one-off $6,840.00 the median ignores, and a $268.40 month it counts as
        // other income — the median's own rule, unchanged by this slice.
        row('2026-07-16', 684000, 'GREYSTONE REALTY FUND DIST', 'income'),
        row('2026-09-15', 26840, 'GREYSTONE REALTY FUND DIST', 'income'),
        // Fixed spending so the plan has a Fixed term.
        row('2026-07-01', -300000, 'MAPLE COURT APTS RENT', 'rent'),
        row('2026-08-01', -300000, 'MAPLE COURT APTS RENT', 'rent'),
        row('2026-09-01', -300000, 'MAPLE COURT APTS RENT', 'rent'),
      ],
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { account: { userId: USER } } });
    await prisma.user.updateMany({ where: { id: USER }, data: { paymentAccountId: null } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
    vi.unstubAllEnvs();
  });

  it('test_regression__the_loader_plans_on_regular_pay_and_leaves_irregular_money_out', async () => {
    vi.stubEnv('DEMO_TODAY', TODAY);
    const plan = await getSpendingPlan(USER);
    expect(plan.incomeBasis).toBe('regular-pay');
    // One payroll paying since before the Jul–Sep window, none stopped, other
    // income $268.40 ≤ 10% of $9,776.65: clean.
    expect(plan.regularPay).toMatchObject({ clean: true, fallback: null });
    // Paychecks $9,776.65 plus the fund's $268.40 usual month (Jul $6,840.00,
    // Aug $0.00, Sep $268.40 → median $268.40): filed Income, it is other income
    // exactly as the median always counted it; the one-off $6,840.00 is not.
    expect(plan.patternIncomeCents).toBe(977665 + 26840);
    expect(plan.regularPay?.otherMonthlyCents).toBe(26840);
    expect(planRowLabels(plan, DISCLOSURES).income.label).toBe('Income (regular pay + other income, monthly)');
    expect(plan.regularPay?.streams).toHaveLength(1);
    expect(plan.regularPay?.streams[0]).toMatchObject({ frequency: 'biweekly', paycheckCents: 451230 });
    // Rent $3,000.00; savings 20% of $10,045.05 = $2,009.01.
    expect(plan.fixedExpensesCents).toBe(300000);
    expect(plan.plannedSavingsCents).toBe(200901);
    expect(plan.leftToSpendCents).toBe(1004505 - 300000 - 200901);
  });
});
