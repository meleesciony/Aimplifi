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
import { regularPayBasisSentence, type RegularPay, type RegularPayStream } from '@/lib/engine/spending-plan/regular-pay';
import { planRowLabels } from '@/lib/engine/spending-plan/row-labels';
import { traceSafeToSpend } from '@/lib/engine/glass-box/trace';
import { answerSafeToSpend } from '@/lib/engine/assistant/answer';

const TODAY = '2026-10-03';

const STREAM = {
  payerCanonical: 'Northwind Health Payroll',
  frequency: 'biweekly' as const,
  paycheckCents: 451230,
  step: null,
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
      'This figure is used only while one steady paycheck explains your pay: paid without a break since before your last three complete months, its last eight paychecks within 2% of each other — or split once into an earlier and a later run, each within 2% and not overlapping, with at least two paychecks in each — no other regular paycheck in that time, and the rest of those deposits no more than a tenth of a usual month’s pay. Otherwise the plan uses the median of your last three complete months. Within that 2%, a raise counts here once most of your last eight paychecks show it; a cut counts at once. After a split, the lower run counts.',
    );
    // One level: no change clause, and the timing clause unchanged.
    expect(regularPayBasisSentence(PAY)).not.toContain('within its last eight paychecks (your newest');
    expect(regularPayBasisSentence(PAY)).toContain('this figure spreads the year’s pay evenly, so most months bring a little less than it.');
  });

  it('test_regression__a_changed_paycheck_says_which_level_the_figure_counts', () => {
    // DECISIONS #786 (cycle 6, P1-2's lesson: the sentence must say what the
    // figure does). A rise: the reader's newest paycheck is ABOVE the one in the
    // arithmetic, so the sentence names it and says why the lower one counts.
    // Fixtures carry what the engine would produce (regular-pay.test.ts).
    const stepped = (s: Partial<RegularPayStream>, other = 0): RegularPay => {
      const stream: RegularPayStream = { ...STREAM, ...s };
      return { ...PAY, streams: [stream], streamsMonthlyCents: stream.monthlyCents, otherMonthlyCents: other, monthlyCents: stream.monthlyCents + other };
    };
    // A rise every two weeks, +10%: base × 26 ÷ 12 is below two new paychecks.
    const rose = stepped({ paycheckCents: 520000, monthlyCents: 1126667, step: { direction: 'rose', newestCents: 572000, sinceCents: 572000 } });
    expect(regularPayBasisSentence(rose)).toContain(
      'Income is your regular pay, counted low after a change in pay: $5,200.00 every two weeks × 26 ÷ 12 ($11,266.67) or two paychecks a month at the smallest since the change ($5,720.00 × 2 = $11,440.00), whichever is less ($11,266.67 a month) = $11,266.67 a month. Your pay rose within its last eight paychecks (your newest was $5,720.00), so this counts the earlier, lower paycheck at its yearly rate, or two paychecks a month at the new pay if that is less: the paychecks alone cannot tell a raise from overtime, or from Social Security tax that stops being withheld once the year’s pay passes its cap, and until eight paychecks agree their dates cannot tell pay every two weeks from a new job paid twice a month.',
    );
    // The arithmetic's usual month is the SMALLEST paycheck since the change, the
    // clause names the NEWEST (critic cycle 3, P3-1: a mutant swapping them lived).
    const apart = stepped({ paycheckCents: 300000, monthlyCents: 606000, step: { direction: 'rose', newestCents: 308000, sinceCents: 303000 } });
    expect(regularPayBasisSentence(apart)).toContain('($3,030.00 × 2 = $6,060.00), whichever is less ($6,060.00 a month)');
    expect(regularPayBasisSentence(apart)).toContain('(your newest was $3,080.00)');
    // Critic cycle 1, P1-1: after a rise "most months bring a little less than
    // it" is false whenever the rise is above 8.33%. A changed weekly or biweekly
    // stream states a usual month in its own arithmetic and carries no timing
    // clause at all.
    expect(regularPayBasisSentence(rose)).not.toContain('Paid every two weeks all year');
    expect(regularPayBasisSentence(rose)).not.toContain('most months bring a little less');
    // A rise under 8.33% — the cap binds — with other income riding along.
    const held = stepped({ paycheckCents: 520000, monthlyCents: 1122080, step: { direction: 'rose', newestCents: 561040, sinceCents: 561040 } }, 26840);
    expect(regularPayBasisSentence(held)).toContain(
      ': $5,200.00 every two weeks × 26 ÷ 12 ($11,266.67) or two paychecks a month at the smallest since the change ($5,610.40 × 2 = $11,220.80), whichever is less ($11,220.80 a month) plus $268.40, the usual month of your other income (the median of your last 3 complete months) = $11,489.20 a month.',
    );
    // Weekly: four paychecks.
    const weekly = stepped({ frequency: 'weekly', paycheckCents: 100000, monthlyCents: 433333, step: { direction: 'rose', newestCents: 112000, sinceCents: 112000 } });
    expect(regularPayBasisSentence(weekly)).toContain(
      '$1,000.00 every week × 52 ÷ 12 ($4,333.33) or four paychecks a month at the smallest since the change ($1,120.00 × 4 = $4,480.00), whichever is less ($4,333.33 a month)',
    );
    expect(regularPayBasisSentence(weekly)).toContain(
      'or four paychecks a month at the new pay if that is less: the paychecks alone cannot tell a raise from overtime, or from Social Security tax that stops being withheld once the year’s pay passes its cap, and until eight paychecks agree their dates cannot tell pay every week from a new job paid four times a month.',
    );
    expect(regularPayBasisSentence(weekly)).not.toContain('Paid every week all year');
    // A fall every two weeks: the newer paycheck, held to two a month.
    const fell = stepped({ paycheckCents: 250000, monthlyCents: 500000, step: { direction: 'fell', newestCents: 250000, sinceCents: 250000 } });
    expect(regularPayBasisSentence(fell)).toContain(
      'Income is your regular pay, counted low after a change in pay: $2,500.00 every two weeks × 26 ÷ 12 ($5,416.67) or two paychecks a month at the smallest since the change ($2,500.00 × 2 = $5,000.00), whichever is less ($5,000.00 a month) = $5,000.00 a month. Your pay fell within its last eight paychecks (your newest was $2,500.00), so this counts the newer, lower paycheck at its yearly rate, or two of them a month if that is less: until eight paychecks agree, their dates cannot tell pay every two weeks from a new job paid twice a month.',
    );
    // Twice a month: no cap (24 a year is already a usual month), the same
    // "counted low" lead as /budgets (cycle 3, P3-4), and the plain step clause.
    const semi = stepped({ frequency: 'semimonthly', paycheckCents: 300000, monthlyCents: 600000, step: { direction: 'rose', newestCents: 320000, sinceCents: 320000 } });
    expect(regularPayBasisSentence(semi)).toContain(
      'Income is your regular pay, counted low after a change in pay: $3,000.00 about twice a month × 24 ÷ 12 ($6,000.00 a month) = $6,000.00 a month. Your pay rose within its last eight paychecks (your newest was $3,200.00), so this counts the earlier, lower paycheck — the paychecks alone cannot tell a raise from overtime, or from Social Security tax that stops being withheld once the year’s pay passes its cap. Pay counted 24 times a year',
    );
    const semiFell = stepped({ frequency: 'semimonthly', paycheckCents: 249000, monthlyCents: 498000, step: { direction: 'fell', newestCents: 249000, sinceCents: 249000 } });
    expect(regularPayBasisSentence(semiFell)).toContain('(your newest was $2,490.00), so this counts the newer, lower paycheck. Pay counted 24 times a year');
    // Every surface that explains the basis carries it — one author.
    const plan = computeSpendingPlan(input({ regularPay: rose }));
    expect(plan.patternIncomeCents).toBe(1126667);
    expect(planRowLabels(plan, DISCLOSURES).income.label).toBe('Income (regular pay after a pay change, monthly)');
    expect(planRowLabels(computeSpendingPlan(input({ regularPay: held })), DISCLOSURES).income.label).toBe(
      'Income (regular pay after a pay change + other income, monthly)',
    );
    const clause = '(your newest was $5,720.00), so this counts the earlier, lower paycheck';
    expect(JSON.stringify(traceSafeToSpend(plan, DISCLOSURES))).toContain(clause);
    expect(answerSafeToSpend(plan, DISCLOSURES).detail).toContain(clause);
    const over = computeSpendingPlan(input({ regularPay: rose, categoryFixedCents: 1200000 }));
    expect(over.overspent).toBe(true);
    expect(answerSafeToSpend(over, DISCLOSURES).detail).toContain(clause);
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

describe('the real loader — one change of level (DECISIONS #786)', () => {
  const USER = `regular-pay-step-${Date.now()}-${process.pid}`;
  const PAYROLL = 'NORTHWIND HEALTH PAYROLL PPD';

  beforeAll(async () => {
    vi.stubEnv('DEMO_TODAY', TODAY);
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local`, savingsTargetBps: 0 } });
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
        // Biweekly $5,200.00 (a cent of drift), then $5,720.00 (+10%) from Sep 4 —
        // the Social Security wage-base step. Invented figures.
        row('2026-06-12', 520000),
        row('2026-06-26', 520001),
        row('2026-07-10', 520000),
        row('2026-07-24', 519999),
        row('2026-08-07', 520000),
        row('2026-08-21', 520001),
        row('2026-09-04', 572000),
        row('2026-09-18', 572001),
        row('2026-10-02', 572000),
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

  it('test_regression__the_loader_plans_a_stepped_paycheck_on_its_lower_level', async () => {
    vi.stubEnv('DEMO_TODAY', TODAY);
    const plan = await getSpendingPlan(USER);
    // Fail-old (#785): `pay-changed` → the median of Jul $10,399.99, Aug
    // $10,400.01, Sep $11,440.01 = $10,400.01. Now: the base, $5,200.00 × 26 ÷ 12
    // (two new paychecks, $11,440.00, are more).
    expect(plan.incomeBasis).toBe('regular-pay');
    expect(plan.regularPay).toMatchObject({ clean: true, fallback: null, otherMonthlyCents: 0 });
    expect(plan.regularPay?.streams[0]).toMatchObject({ paycheckCents: 520000, step: { direction: 'rose', newestCents: 572000, sinceCents: 572000 } });
    expect(plan.patternIncomeCents).toBe(1126667);
    expect(planRowLabels(plan, DISCLOSURES).income.label).toBe('Income (regular pay after a pay change, monthly)');
    expect(plan.fixedExpensesCents).toBe(300000);
    expect(plan.leftToSpendCents).toBe(1126667 - 300000);
    expect(answerSafeToSpend(plan, DISCLOSURES).detail).toContain('(your newest was $5,720.00), so this counts the earlier, lower paycheck');
  });
});
