/**
 * Bonuses handled when they land — their own line, and they pay this month's
 * savings first (owner, DECISIONS #784; built as #787). Engine, plan arithmetic,
 * every surface that words it, and the real loader. Every amount, payer and date
 * is invented (keep-live-figures-out-of-repo). Hand-verified values:
 * tests/edge-cases/bonuses-pay-savings-first.md.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@/lib/db';
import { addDays, isoDate } from '@/lib/dates';
import type { TxnLike } from '@/lib/engine/fi/insights';
import { getSpendingPlan } from '@/server/spending-plan';
import { computeSpendingPlan, type SpendingPlanInput } from '@/lib/engine/spending-plan/plan';
import { regularPayFromRows, type RegularPay } from '@/lib/engine/spending-plan/regular-pay';
import {
  bonusesThisMonth,
  bonusTowardSavingsCents,
  type BonusesThisMonth,
} from '@/lib/engine/spending-plan/bonus';
import { BONUS_ROW_LABEL, bonusSentence, bonusShortNote } from '@/lib/engine/spending-plan/bonus-copy';
import { mapToConsciousBuckets } from '@/lib/engine/spending-plan/conscious';
import { traceConsciousBuckets, traceSafeToSpend } from '@/lib/engine/glass-box/trace';
import { answerConsciousSpending, answerSafeToSpend } from '@/lib/engine/assistant/answer';

const PAYROLL = 'NORTHWIND HEALTH PAYROLL PPD';
// Biweekly Fridays Jun 12 – Oct 16, 2026; today is the day after the last.
const TODAY = isoDate('2026-10-17');
const FRIDAYS = Array.from({ length: 10 }, (_, i) => addDays(isoDate('2026-06-12'), 14 * i) as string);
const PAYCHECK = 451230; // $4,512.30 — × 26 ÷ 12 = $9,776.65

function dep(date: string, cents: number, over: Partial<TxnLike> = {}): TxnLike {
  return {
    id: `${date}-${cents}-${over.rawDescriptor ?? PAYROLL}-${over.categoryId ?? 'paycheck'}`,
    date,
    amountCents: cents,
    rawDescriptor: PAYROLL,
    categoryId: 'paycheck',
    status: 'POSTED',
    isTransfer: false,
    isSplitParent: false,
    accountId: 'chk',
    ...over,
  } as TxnLike;
}
const PAYDAYS = FRIDAYS.map((d) => dep(d, PAYCHECK));
/** The rows with the Oct 2 payday replaced. */
const withOct2 = (...rows: TxnLike[]) => [...PAYDAYS.filter((t) => t.date !== '2026-10-02'), ...rows];
const lines = (rows: TxnLike[], today = TODAY) => bonusesThisMonth(rows, today, regularPayFromRows(rows, today));

describe('bonusesThisMonth — what counts as bonus money', () => {
  it('a payday that brought a bonus with the paycheck counts what it brought above the usual paycheck', () => {
    // $13,512.30 on Oct 2 = the $4,512.30 paycheck + $9,000.00.
    const rows = withOct2(dep('2026-10-02', 1351230));
    const pay = regularPayFromRows(rows, TODAY);
    // Oct 16 is an ordinary payday after it: regular pay holds (#785).
    expect(pay).toMatchObject({ clean: true, streams: [{ paycheckCents: PAYCHECK }] });
    expect(bonusesThisMonth(rows, TODAY, pay)).toEqual({
      month: '2026-10',
      deposits: [
        { date: '2026-10-02', kind: 'above-paycheck', depositCents: 1351230, paycheckCents: PAYCHECK, bonusCents: 900000 },
      ],
      totalCents: 900000,
      categoryName: 'Bonus',
    });
  });

  it('the same bonus as its own row on payday, filed Paycheck, is the same payday', () => {
    const rows = [...PAYDAYS, dep('2026-10-02', 900000, { id: 'b' })];
    expect(lines(rows).totalCents).toBe(900000);
    expect(lines(rows).deposits).toHaveLength(1);
  });

  it('a deposit filed Bonus counts whole, and the paycheck beside it is not read twice', () => {
    const rows = [...PAYDAYS, dep('2026-10-02', 900000, { categoryId: 'bonus' })];
    expect(lines(rows).deposits).toEqual([
      { date: '2026-10-02', kind: 'filed', depositCents: 900000, paycheckCents: null, bonusCents: 900000 },
    ]);
    expect(lines(rows).totalCents).toBe(900000);
    // Filed Bonus, it never touched regular pay.
    expect(regularPayFromRows(rows, TODAY)).toMatchObject({ clean: true, monthlyCents: 977665 });
  });

  it('a bonus on a day of its own, filed Paycheck, counts less one paycheck — low, never high', () => {
    // Oct 9: $9,000.00 alone. The rows cannot say no paycheck was inside it.
    const rows = [...PAYDAYS, dep('2026-10-09', 900000)];
    expect(lines(rows).deposits).toEqual([
      { date: '2026-10-09', kind: 'above-paycheck', depositCents: 900000, paycheckCents: PAYCHECK, bonusCents: 900000 - PAYCHECK },
    ]);
  });

  it('the boundary is MORE than one and a half paychecks (whole-number)', () => {
    // 1.5 × $4,512.30 = $6,768.45 exactly. Measured against the stream read
    // from the plain paydays, so this tests bonus.ts's own threshold (at
    // exactly 1.5× regular pay itself would count the day as a paycheck).
    const plain = regularPayFromRows(PAYDAYS, TODAY);
    expect(bonusesThisMonth(withOct2(dep('2026-10-02', 676845)), TODAY, plain).deposits).toEqual([]);
    expect(bonusesThisMonth(withOct2(dep('2026-10-02', 676846)), TODAY, plain).totalCents).toBe(676846 - PAYCHECK);
  });

  it('only this calendar month, only up to today, only posted money that counts in flows', () => {
    const rows = [
      ...PAYDAYS,
      dep('2026-09-30', 500000, { categoryId: 'bonus' }), // last month
      dep('2026-10-20', 500000, { categoryId: 'bonus' }), // after today
      dep('2026-10-05', 500000, { categoryId: 'bonus', status: 'PENDING' }),
      dep('2026-10-06', 500000, { categoryId: 'bonus', isTransfer: true }),
      dep('2026-10-07', 500000, { categoryId: 'bonus', excludeFromTotals: true }),
    ];
    expect(lines(rows)).toMatchObject({ deposits: [], totalCents: 0 });
  });

  it('a bonus taken back nets against it, and the total never goes below zero', () => {
    const back = [...PAYDAYS, dep('2026-10-05', 300000, { categoryId: 'bonus' }), dep('2026-10-08', -50000, { categoryId: 'bonus' })];
    expect(lines(back).totalCents).toBe(250000);
    const all = [...PAYDAYS, dep('2026-10-08', -50000, { categoryId: 'bonus' })];
    expect(lines(all)).toMatchObject({ totalCents: 0, deposits: [{ bonusCents: -50000 }] });
  });

  it('without a live steady paycheck, a large payroll deposit is never read as a bonus', () => {
    // Three paydays: no rhythm, no stream → nothing to measure "above" against.
    const rows = [dep('2026-09-18', PAYCHECK), dep('2026-10-02', 1351230), dep('2026-10-16', PAYCHECK)];
    expect(regularPayFromRows(rows, TODAY).streams).toEqual([]);
    expect(lines(rows).deposits).toEqual([]);
  });

  it('a double paycheck after a missed payday is never a bonus: the gap ends the stream', () => {
    // Sep 18 missed, Oct 2 carries two paychecks.
    const rows = [...PAYDAYS.filter((t) => t.date !== '2026-09-18' && t.date !== '2026-10-02'), dep('2026-10-02', 2 * PAYCHECK)];
    expect(lines(rows).deposits).toEqual([]);
  });

  it('other payers and other income categories are not bonus money', () => {
    const rows = [
      ...PAYDAYS,
      dep('2026-10-05', 900000, { rawDescriptor: 'GREYSTONE REALTY FUND DIST', categoryId: 'income' }),
      dep('2026-10-06', 900000, { categoryId: 'investment-income' }),
    ];
    expect(lines(rows).deposits).toEqual([]);
  });

  it("the reader's own name for the Bonus category rides along; deposits sort by date", () => {
    const rows = [...PAYDAYS, dep('2026-10-09', 900000), dep('2026-10-05', 100000, { categoryId: 'bonus' })];
    const b = bonusesThisMonth(rows, TODAY, regularPayFromRows(rows, TODAY), 'Quarterly bonus');
    expect(b.categoryName).toBe('Quarterly bonus');
    expect(b.deposits.map((d) => d.date)).toEqual(['2026-10-05', '2026-10-09']);
    expect(b.totalCents).toBe(100000 + 900000 - PAYCHECK);
  });
});

describe('bonusTowardSavingsCents — only on regular pay, never more than planned savings', () => {
  const b = (totalCents: number): BonusesThisMonth => ({ month: '2026-10', deposits: [], totalCents, categoryName: 'Bonus' });
  it('pays planned savings first, up to the savings', () => {
    expect(bonusTowardSavingsCents(b(900000), 195533, 'regular-pay')).toBe(195533);
    expect(bonusTowardSavingsCents(b(100000), 195533, 'regular-pay')).toBe(100000);
    expect(bonusTowardSavingsCents(b(900000), 0, 'regular-pay')).toBe(0);
    expect(bonusTowardSavingsCents(b(0), 195533, 'regular-pay')).toBe(0);
    expect(bonusTowardSavingsCents(null, 195533, 'regular-pay')).toBe(0);
  });
  it('test_regression__a_bonus_never_moves_a_figure_on_a_basis_that_can_already_hold_bonus_pay', () => {
    for (const basis of ['trailing-median', 'user-set', 'detected-series', 'none'] as const) {
      expect(bonusTowardSavingsCents(b(900000), 195533, basis)).toBe(0);
    }
  });
});

const PAY: RegularPay = {
  clean: true,
  fallback: null,
  streams: [
    {
      payerCanonical: 'Northwind Health Payroll',
      frequency: 'biweekly',
      paycheckCents: PAYCHECK,
      step: null,
      monthlyCents: 977665,
      firstPaidOn: isoDate('2026-06-12'),
      lastPaidOn: isoDate('2026-10-16'),
    },
  ],
  streamsMonthlyCents: 977665,
  otherMonthlyCents: 0,
  monthlyCents: 977665,
};
const ON_PAYDAY: BonusesThisMonth = {
  month: '2026-10',
  deposits: [{ date: isoDate('2026-10-02'), kind: 'above-paycheck', depositCents: 1351230, paycheckCents: PAYCHECK, bonusCents: 900000 }],
  totalCents: 900000,
  categoryName: 'Bonus',
};
const SMALL_FILED: BonusesThisMonth = {
  month: '2026-10',
  deposits: [{ date: isoDate('2026-10-05'), kind: 'filed', depositCents: 100000, paycheckCents: null, bonusCents: 100000 }],
  totalCents: 100000,
  categoryName: 'Bonus',
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
    today: TODAY,
    trailingMonthlyIncomeCents: [902460, 1353690, 902460],
    regularPay: PAY,
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

describe('the plan — a bonus pays this month’s savings first', () => {
  it('test_regression__a_bonus_that_landed_this_month_pays_planned_savings_first', () => {
    // Fail-old: guilt-free stayed $2,821.32 with $9,000.00 of bonus in the account.
    const p = computeSpendingPlan(input({ bonusesThisMonth: ON_PAYDAY }));
    expect(p.incomeBasis).toBe('regular-pay');
    expect(p.patternIncomeCents).toBe(977665); // the bonus is never income
    expect(p.plannedSavingsCents).toBe(195533); // 20% of $9,776.65 — the whole plan
    expect(p.bonusTowardSavingsCents).toBe(195533);
    expect(p.savingsFromPayCents).toBe(0);
    expect(p.leftToSpendFromPayCents).toBe(977665 - 500000 - 195533); // $2,821.32
    expect(p.leftToSpendCents).toBe(282132 + 195533); // $4,776.65
    // The identity with its fourth term.
    expect(p.patternIncomeCents + p.bonusTowardSavingsCents).toBe(
      p.fixedExpensesCents + p.plannedSavingsCents + p.leftToSpendCents,
    );
  });

  it('a bonus smaller than planned savings pays part of it', () => {
    const p = computeSpendingPlan(input({ bonusesThisMonth: SMALL_FILED }));
    expect(p).toMatchObject({ bonusTowardSavingsCents: 100000, savingsFromPayCents: 95533, leftToSpendCents: 382132, leftToSpendFromPayCents: 282132 });
  });

  it('no planned savings → nothing to pay, nothing moves', () => {
    const p = computeSpendingPlan(input({ bonusesThisMonth: ON_PAYDAY, savingsTargetBps: null }));
    expect(p).toMatchObject({ plannedSavingsCents: 0, bonusTowardSavingsCents: 0, leftToSpendCents: 477665 });
  });

  it('goal contributions are planned savings too: the bonus pays them first', () => {
    const p = computeSpendingPlan(input({ bonusesThisMonth: ON_PAYDAY, savingsTargetBps: null, goalContributionsCents: 80000 }));
    expect(p).toMatchObject({ plannedSavingsCents: 80000, bonusTowardSavingsCents: 80000, leftToSpendCents: 977665 - 500000 });
  });

  it('on the median, or under a typed income, the bonus moves nothing (fail closed)', () => {
    const median = computeSpendingPlan(input({ bonusesThisMonth: ON_PAYDAY, regularPay: { ...PAY, clean: false, fallback: 'pay-changed' } }));
    expect(median).toMatchObject({ incomeBasis: 'trailing-median', bonusTowardSavingsCents: 0 });
    expect(median.leftToSpendCents).toBe(median.leftToSpendFromPayCents);
    const typed = computeSpendingPlan(input({ bonusesThisMonth: ON_PAYDAY, incomeOverrideCents: 800000 }));
    expect(typed).toMatchObject({ incomeBasis: 'user-set', bonusTowardSavingsCents: 0 });
  });

  it('a month with no bonus is byte-for-byte the plan it was', () => {
    const before = computeSpendingPlan(input());
    const none = computeSpendingPlan(input({ bonusesThisMonth: { ...ON_PAYDAY, deposits: [], totalCents: 0 } }));
    expect(none.leftToSpendCents).toBe(before.leftToSpendCents);
    expect(before).toMatchObject({ bonusTowardSavingsCents: 0, savingsFromPayCents: 195533, leftToSpendFromPayCents: 282132 });
  });

  it('the conscious split is a split of PAY: its three buckets still sum to income', () => {
    const p = computeSpendingPlan(input({ bonusesThisMonth: SMALL_FILED }));
    const buckets = mapToConsciousBuckets(p).buckets;
    expect(buckets.map((x) => [x.key, x.cents])).toEqual([
      ['fixed', 500000],
      ['savings', 95533],
      ['guiltFree', 382132],
    ]);
    expect(buckets.reduce((s, x) => s + x.cents, 0)).toBe(p.patternIncomeCents);
  });
});

describe('every surface — one author (bonus-copy.ts)', () => {
  const full = computeSpendingPlan(input({ bonusesThisMonth: ON_PAYDAY }));

  it('the glass box adds the bonus as its own row and still matches to the penny', () => {
    const t = traceSafeToSpend(full, DISCLOSURES);
    expect(t.rows.map((r) => [r.id, r.amountCents])).toEqual([
      ['income', 977665],
      ['fixed', -500000],
      ['savings', -195533],
      ['bonus', 195533],
    ]);
    expect(t.rows[3]!.label).toBe(BONUS_ROW_LABEL);
    expect(t.sumCents).toBe(477665);
    expect(t.reconciles).toBe(true);
    expect(t.basis).toContain(bonusSentence(full));
  });

  it('no bonus row when nothing moved — and the sentence still says what landed', () => {
    const median = computeSpendingPlan(input({ bonusesThisMonth: ON_PAYDAY, regularPay: null }));
    const t = traceSafeToSpend(median, DISCLOSURES);
    expect(t.rows.map((r) => r.id)).toEqual(['income', 'fixed', 'savings']);
    expect(t.reconciles).toBe(true);
    expect(t.basis.some((b) => b.startsWith('Bonus money landed this month'))).toBe(true);
    expect(traceSafeToSpend(computeSpendingPlan(input()), DISCLOSURES).basis.some((b) => b.includes('Bonus money'))).toBe(false);
  });

  it('the /budgets savings panel shows the bonus row and reconciles to the part pay funds', () => {
    const p = computeSpendingPlan(input({ bonusesThisMonth: SMALL_FILED }));
    const panels = traceConsciousBuckets(p, DISCLOSURES);
    expect(panels.savings.rows.map((r) => [r.id, r.amountCents])).toEqual([
      ['savings', 195533],
      ['bonus', -100000],
    ]);
    expect(panels.savings).toMatchObject({ headlineCents: 95533, sumCents: 95533, reconciles: true });
    expect(panels.guiltFree).toMatchObject({ headlineCents: 382132, reconciles: true });
  });

  it('test_regression__the_bonus_sentence_states_what_landed_what_it_paid_and_the_rule', () => {
    expect(bonusSentence(full)).toBe(
      'Bonus money landed this month — Fri, Oct 2: $13,512.30 from the payer of your regular paycheck, $9,000.00 more than its usual $4,512.30. ' +
        'Bonus money is a deposit filed Bonus, counted whole, or a day the payer of a regular paycheck deposited more than one and a half times the usual paycheck, counted for what it brought above it — a bonus paid on a day of its own counts whole once just that deposit is filed Bonus. ' +
        "A bonus never plans the month — it pays this month's savings first: it covers all $1,955.33 of this month's planned savings, so guilt-free this month is $1,955.33 higher than your pay alone allows. " +
        'The other $7,044.67 is not counted anywhere in this plan — it is yours to decide: more savings or investing, money put aside for taxes, or something you have been wanting. ' +
        'This reads the deposits, not where the money went after it landed.',
    );
  });

  it('each other state says what it did — and only that', () => {
    const part = computeSpendingPlan(input({ bonusesThisMonth: SMALL_FILED }));
    expect(bonusSentence(part)).toContain('Mon, Oct 5: $1,000.00 filed Bonus.');
    expect(bonusSentence(part)).toContain("it covers $1,000.00 of this month's $1,955.33 planned savings, so guilt-free this month is $1,000.00 higher");
    expect(bonusSentence(part)).not.toContain('The other');

    const noSavings = computeSpendingPlan(input({ bonusesThisMonth: ON_PAYDAY, savingsTargetBps: null }));
    expect(bonusSentence(noSavings)).toContain(
      'this plan has no savings planned this month, so none of it is counted here — it is yours to decide: more savings or investing',
    );

    const median = computeSpendingPlan(input({ bonusesThisMonth: ON_PAYDAY, regularPay: null }));
    expect(bonusSentence(median)).toContain(
      'only while income is your regular pay, which leaves every bonus out; income right now is the median of your last 3 complete months, which counts bonus pay in the months it reads, so none of it is counted here.',
    );
    const typed = computeSpendingPlan(input({ bonusesThisMonth: ON_PAYDAY, incomeOverrideCents: 800000 }));
    expect(bonusSentence(typed)).toContain('income is the monthly figure you set, which may already include bonus pay');

    const twoAndBack: BonusesThisMonth = {
      ...SMALL_FILED,
      deposits: [...SMALL_FILED.deposits, { date: isoDate('2026-10-08'), kind: 'filed', depositCents: -100000, paycheckCents: null, bonusCents: -100000 }],
      totalCents: 0,
    };
    const nets = computeSpendingPlan(input({ bonusesThisMonth: twoAndBack }));
    expect(nets.bonusTowardSavingsCents).toBe(0);
    expect(bonusSentence(nets)).toContain('Thu, Oct 8: $1,000.00 filed Bonus, taken back: $0.00 in all.');
    expect(bonusSentence(nets)).toContain('It comes to nothing, so none of it is counted here.');

    expect(bonusSentence(computeSpendingPlan(input()))).toBeNull();

    // Only a bonus taken back: nothing landed, and the sentence does not say so.
    const onlyBack = computeSpendingPlan(
      input({ bonusesThisMonth: { ...twoAndBack, deposits: [twoAndBack.deposits[1]!], totalCents: 0 } }),
    );
    expect(bonusSentence(onlyBack)).toMatch(/^A bonus was taken back this month — Thu, Oct 8: \$1,000\.00 filed Bonus, taken back\./);
    expect(bonusSentence(onlyBack)).not.toContain('landed');
  });

  it('the short note speaks only when a bonus moved the figure', () => {
    expect(bonusShortNote(full)).toBe(
      "This month's bonus paid $1,955.33 of your savings, so guilt-free is $1,955.33 higher than your pay alone allows — the details are on Guilt-free.",
    );
    expect(bonusShortNote(computeSpendingPlan(input({ bonusesThisMonth: ON_PAYDAY, regularPay: null })))).toBeNull();
  });

  it('Ask: the bonus is a fact that sums to the headline, and the sentence rides the answer', () => {
    const a = answerSafeToSpend(full, DISCLOSURES);
    expect(a.headline).toBe('Your guilt-free allocation this month is $4,776.65.');
    expect(a.facts).toContainEqual({ label: BONUS_ROW_LABEL, value: '$1,955.33' });
    expect(a.detail).toContain(bonusSentence(full)!);
    const c = answerConsciousSpending(computeSpendingPlan(input({ bonusesThisMonth: SMALL_FILED })), DISCLOSURES);
    expect(c.detail).toContain('Savings here is the part your pay funds.');
  });

  it('every page that prints the figure reads the one author', () => {
    const src = (f: string) => readFileSync(resolve(f), 'utf8');
    expect(src('src/components/finance/safe-to-spend-card.tsx')).toContain('bonusShortNote(plan)');
    expect(src('src/components/finance/budgeting-composition-card.tsx')).toContain('bonusShortNote(plan)');
    expect(src('src/components/finance/conscious-buckets-strip.tsx')).toContain('bonusShortNote(plan)');
    expect(src('src/app/(app)/spending-plan/page.tsx')).toContain('p.savingsFromPayCents');
  });
});

describe('planning beyond this month never reads a bonus as monthly capacity', () => {
  it('test_regression__no_planner_reads_the_bonus_month_figure_as_monthly_capacity', () => {
    // Every solver input in src reads the pay-only figure. A bonus month's
    // credit fed to a debt-free, savings-goal, retirement or wealth-target
    // solve would be repeated for every month of the horizon.
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name)) files.push(p);
      }
    };
    walk(resolve('src'));
    const uses = files.flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .filter((l) => /safeToSpendCents[:=]\s*\{?\s*(cents\()?plan\./.test(l))
        .map((l) => `${f}: ${l.trim()}`),
    );
    expect(uses.length).toBeGreaterThanOrEqual(7);
    expect(uses.filter((u) => !u.includes('plan.leftToSpendFromPayCents'))).toEqual([]);
  });
});

describe('the real loader (DECISIONS #787)', () => {
  const USER = `bonus-line-${Date.now()}-${process.pid}`;

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
    const row = (date: string, amountCents: number, rawDescriptor = PAYROLL, categoryId = 'paycheck') => ({
      accountId: checking.id,
      date,
      amountCents,
      rawDescriptor,
      categoryId,
      confidenceBps: 10000,
      needsReview: false,
    });
    await prisma.transaction.createMany({
      data: [
        ...FRIDAYS.map((d) => row(d, PAYCHECK)),
        // A $2,500.00 deposit filed Bonus on Oct 9.
        row('2026-10-09', 250000, 'NORTHWIND HEALTH SPOT AWARD', 'bonus'),
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

  it('test_regression__the_loader_lets_this_months_bonus_pay_savings_first', async () => {
    vi.stubEnv('DEMO_TODAY', TODAY);
    const plan = await getSpendingPlan(USER);
    expect(plan.incomeBasis).toBe('regular-pay');
    expect(plan.patternIncomeCents).toBe(977665);
    expect(plan.bonusesThisMonth).toMatchObject({
      month: '2026-10',
      totalCents: 250000,
      deposits: [{ date: '2026-10-09', kind: 'filed', bonusCents: 250000 }],
    });
    // Rent $3,000.00; savings 20% = $1,955.33, all of it paid by the $2,500.00.
    expect(plan.fixedExpensesCents).toBe(300000);
    expect(plan.plannedSavingsCents).toBe(195533);
    expect(plan.bonusTowardSavingsCents).toBe(195533);
    expect(plan.leftToSpendFromPayCents).toBe(977665 - 300000 - 195533);
    expect(plan.leftToSpendCents).toBe(977665 - 300000);
  });
});
