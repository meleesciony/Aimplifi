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
import {
  BONUS_ROW_LABEL,
  bonusParagraphs,
  bonusSentence,
  bonusShortNote,
  plannerGuiltFreeNoun,
} from '@/lib/engine/spending-plan/bonus-copy';
import { mapToConsciousBuckets } from '@/lib/engine/spending-plan/conscious';
import { traceConsciousBuckets, traceSafeToSpend } from '@/lib/engine/glass-box/trace';
import { answerConsciousSpending, answerSafeToSpend } from '@/lib/engine/assistant/answer';
import { deriveLearnedRules } from '@/lib/engine/categorize/learn';
import { categorize } from '@/lib/engine/categorize/pipeline';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { cents } from '@/lib/money';
import { assignToZeroLineFor } from '@/lib/engine/spending-plan/assign-to-zero';

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
        { date: '2026-10-02', kind: 'above-paycheck', depositCents: 1351230, less: { cents: PAYCHECK, reason: 'usual-paycheck' }, bonusCents: 900000 },
      ],
      netCents: 900000,
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
      { date: '2026-10-02', kind: 'filed', depositCents: 900000, less: null, bonusCents: 900000 },
    ]);
    expect(lines(rows).totalCents).toBe(900000);
    // Filed Bonus, it never touched regular pay.
    expect(regularPayFromRows(rows, TODAY)).toMatchObject({ clean: true, monthlyCents: 977665 });
  });

  it('a bonus on a day of its own, filed Paycheck, counts less one paycheck — low, never high', () => {
    // Oct 9: $9,000.00 alone. The rows cannot say no paycheck was inside it.
    const rows = [...PAYDAYS, dep('2026-10-09', 900000)];
    expect(lines(rows).deposits).toEqual([
      { date: '2026-10-09', kind: 'above-paycheck', depositCents: 900000, less: { cents: PAYCHECK, reason: 'usual-paycheck' }, bonusCents: 900000 - PAYCHECK },
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
  const b = (totalCents: number): BonusesThisMonth => ({ month: '2026-10', deposits: [], netCents: totalCents, totalCents, categoryName: 'Bonus' });
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
  deposits: [{ date: isoDate('2026-10-02'), kind: 'above-paycheck', depositCents: 1351230, less: { cents: PAYCHECK, reason: 'usual-paycheck' }, bonusCents: 900000 }],
  netCents: 900000,
  totalCents: 900000,
  categoryName: 'Bonus',
};
const SMALL_FILED: BonusesThisMonth = {
  month: '2026-10',
  deposits: [{ date: isoDate('2026-10-05'), kind: 'filed', depositCents: 100000, less: null, bonusCents: 100000 }],
  netCents: 100000,
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
    const none = computeSpendingPlan(input({ bonusesThisMonth: { ...ON_PAYDAY, deposits: [], netCents: 0, totalCents: 0 } }));
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
    for (const para of bonusParagraphs(full)) expect(t.basis).toContain(para);
    expect(bonusParagraphs(full)).toHaveLength(3);
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
    // Three paragraphs (critic cycle 2, P3-2): what landed, what it did, the rule.
    expect(bonusParagraphs(full)).toEqual([
      'Bonus money landed this month — Fri, Oct 2: $13,512.30 from the payer of your regular paycheck, $9,000.00 more than its usual $4,512.30.',
      "A bonus never plans the month — it pays this month's savings first: it covers all $1,955.33 of this month's planned savings, so guilt-free this month is $1,955.33 higher than your pay alone allows. " +
        'The other $7,044.67 is not counted anywhere in this plan — it is yours to decide: more savings or investing, money put aside for taxes, or something you have been wanting. ' +
        'This reads the deposits, not where the money went after it landed.',
      'Bonus money is a deposit filed Bonus, or a day the payer of your regular paycheck deposits over one and a half paychecks (the part above one paycheck, once a paycheck lands after it), in the accounts your income figure reads. ' +
        'From a payer whose pay is already counted, only the part above that pay counts. ' +
        'Money going out that month with no category, filed as income, or worded as a reversal or return comes off it; filing a purchase to its spending category on Transactions stops that, unless its words read as a reversal or return.',
    ]);
    expect(bonusSentence(full)).toBe(bonusParagraphs(full).join(' '));
    // Never the lever that teaches a rule filing the payer's next paycheck as
    // Bonus (cycle 1, P1-1).
    expect(bonusSentence(full)).not.toMatch(/file (just )?that deposit/i);
    for (const para of bonusParagraphs(full)) expect(para.length).toBeLessThan(560);
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
      'only while income is your regular pay, which leaves every bonus out; income right now is the median of your last 3 complete months, and those months can already include bonus pay, so none of it is counted here.',
    );
    const typed = computeSpendingPlan(input({ bonusesThisMonth: ON_PAYDAY, incomeOverrideCents: 800000 }));
    expect(bonusSentence(typed)).toContain('income is the monthly figure you set, which may already include bonus pay');

    const twoAndBack: BonusesThisMonth = {
      ...SMALL_FILED,
      deposits: [...SMALL_FILED.deposits, { date: isoDate('2026-10-08'), kind: 'filed', depositCents: -100000, less: null, bonusCents: -100000 }],
      netCents: 0,
      totalCents: 0,
    };
    const nets = computeSpendingPlan(input({ bonusesThisMonth: twoAndBack }));
    expect(nets.bonusTowardSavingsCents).toBe(0);
    expect(bonusSentence(nets)).toContain('Thu, Oct 8: $1,000.00 filed Bonus, taken back: $0.00 in all.');
    expect(bonusSentence(nets)).toContain('It nets to $0.00, so none of it is counted here.');

    expect(bonusSentence(computeSpendingPlan(input()))).toBeNull();

    // Only a bonus taken back: nothing landed, and the sentence does not say so.
    const onlyBack = computeSpendingPlan(
      input({ bonusesThisMonth: { ...twoAndBack, deposits: [twoAndBack.deposits[1]!], netCents: -100000, totalCents: 0 } }),
    );
    expect(bonusSentence(onlyBack)).toMatch(/^A bonus was taken back this month — Thu, Oct 8: \$1,000\.00 filed Bonus, taken back\./);
    expect(bonusSentence(onlyBack)).not.toContain('Bonus money landed');
  });

  it('the short note speaks only when a bonus moved the figure', () => {
    expect(bonusShortNote(full)).toBe(
      "This month's bonus counts $1,955.33 toward your savings, so guilt-free is $1,955.33 higher than your pay alone allows.",
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

  it('a bonus month: no "monthly capacity" leftover line, Ask names the split as pay, and every formula line carries the term (cycle 2, P3-3/4/7)', () => {
    const p = computeSpendingPlan(input({ bonusesThisMonth: SMALL_FILED }));
    expect(assignToZeroLineFor(p.leftToSpendCents, { uncountedFixed: false, cardNotesPresent: false, bonusPaidSavings: true })).toBeNull();
    expect(assignToZeroLineFor(p.leftToSpendCents, { uncountedFixed: false, cardNotesPresent: false, bonusPaidSavings: false })).not.toBeNull();
    expect(readFileSync(resolve('src/components/finance/conscious-buckets-strip.tsx'), 'utf8')).toContain(
      'bonusPaidSavings: plan.bonusTowardSavingsCents > 0',
    );
    expect(answerConsciousSpending(p, DISCLOSURES).headline).toContain("savings & investing from pay (this month's bonus paid the rest)");
    expect(answerConsciousSpending(computeSpendingPlan(input()), DISCLOSURES).headline).not.toContain('from pay');
    const page = readFileSync(resolve('src/app/(app)/spending-plan/page.tsx'), 'utf8');
    expect(page.match(/bonusTowardSavingsCents > 0 \? ' \+ the bonus that paid savings this month'/g)).toHaveLength(1);
    expect(page).toContain("p.bonusTowardSavingsCents > 0 ? ', + the bonus that paid savings this month'");
    expect(readFileSync(resolve('src/app/(app)/transactions/page.tsx'), 'utf8')).toContain(
      'income − savings − fixed, plus any bonus that paid savings this month',
    );
  });

  it('every page that prints the figure reads the one author', () => {
    const src = (f: string) => readFileSync(resolve(f), 'utf8');
    expect(src('src/components/finance/safe-to-spend-card.tsx')).toContain('bonusShortNote(plan)');
    expect(src('src/components/finance/budgeting-composition-card.tsx')).toContain('bonusShortNote(plan)');
    expect(src('src/components/finance/conscious-buckets-strip.tsx')).toContain('bonusShortNote(plan)');
    expect(src('src/app/(app)/spending-plan/page.tsx')).toContain('p.savingsFromPayCents');
  });
});

describe('critic cycle 1 (DECISIONS #787) — money taken back, pay filed Bonus, raises, direction', () => {
  // Biweekly from Fri May 1: eleven paydays through Sep 18, so a household
  // whose Oct 2 paycheck is missing still reads every two weeks (nine on the
  // grid) and is still live on Oct 5 (17 days ≤ 14 + 5).
  const LONG = Array.from({ length: 11 }, (_, i) => addDays(isoDate('2026-05-01'), 14 * i) as string);
  const OCT5 = isoDate('2026-10-05');
  const planOf = (rows: TxnLike[], today: ReturnType<typeof isoDate>, over: Partial<SpendingPlanInput> = {}) => {
    const pay = regularPayFromRows(rows, today);
    return computeSpendingPlan(input({ today, regularPay: pay, bonusesThisMonth: bonusesThisMonth(rows, today, pay), ...over }));
  };

  it('test_regression__a_paycheck_filed_bonus_is_never_counted_as_pay_and_as_bonus', () => {
    // P1-1, executed by the critic: the Oct 2 paycheck filed Bonus (as a learned
    // rule files it) while the stream, last paid Sep 18, is still live.
    const rows = [...LONG.map((d) => dep(d, PAYCHECK)), dep('2026-10-02', PAYCHECK, { categoryId: 'bonus' })];
    const p = planOf(rows, OCT5);
    expect(p.incomeBasis).toBe('regular-pay');
    expect(p.bonusesThisMonth?.deposits).toEqual([
      { date: '2026-10-02', kind: 'filed', depositCents: PAYCHECK, less: { cents: PAYCHECK, reason: 'usual-paycheck' }, bonusCents: 0 },
    ]);
    // Fail-old: $4,776.65. Now the pay-only figure, $2,821.32.
    expect(p.bonusTowardSavingsCents).toBe(0);
    expect(p.leftToSpendCents).toBe(282132);
    expect(bonusSentence(p)).toContain(
      'Fri, Oct 2: $4,512.30 filed Bonus from the payer of your regular paycheck, counted only above its usual $4,512.30 because no paycheck has landed after it yet.',
    );
    expect(bonusSentence(p)).toContain('It nets to $0.00, so none of it is counted here.');

    // The variant: the whole payday deposit (paycheck + $500.00) filed Bonus.
    const whole = [...LONG.map((d) => dep(d, PAYCHECK)), dep('2026-10-02', PAYCHECK + 50000, { categoryId: 'bonus' })];
    expect(planOf(whole, OCT5).bonusTowardSavingsCents).toBe(50000);
  });

  it('the chain the critic ran: two corrections teach a rule that files the next paycheck Bonus — still no double count', () => {
    const corr = (id: string, seq: number) => ({
      transactionId: id,
      toCategoryId: 'bonus',
      isUndo: false,
      seq,
      rawDescriptor: PAYROLL,
      amountCents: 900000,
    });
    const rules = deriveLearnedRules([corr('q2', 1), corr('q3', 2)]);
    const next = categorize({ rawDescriptor: PAYROLL, amountCents: PAYCHECK, date: '2026-10-02', accountId: 'chk' }, rules);
    expect(next.categoryId).toBe('bonus'); // the hazard is real
    const rows = [...LONG.map((d) => dep(d, PAYCHECK)), dep('2026-10-02', PAYCHECK, { categoryId: next.categoryId })];
    expect(planOf(rows, OCT5).bonusTowardSavingsCents).toBe(0);
  });

  it('a bonus filed Bonus from the payroll counts whole once a paycheck lands after it', () => {
    const rows = [...PAYDAYS, dep('2026-10-09', 900000, { categoryId: 'bonus' })];
    // Oct 10: last payday Oct 2, so the Oct 9 deposit may be a paycheck.
    expect(lines(rows.filter((t) => t.date <= '2026-10-10'), isoDate('2026-10-10')).totalCents).toBe(900000 - PAYCHECK);
    // Oct 17: the Oct 16 paycheck landed after it — all of it counts.
    expect(lines(rows).totalCents).toBe(900000);
    // From another payer it is never held.
    const award = [...PAYDAYS.filter((t) => t.date <= '2026-10-10'), dep('2026-10-09', 900000, { categoryId: 'bonus', rawDescriptor: 'NORTHWIND HEALTH SPOT AWARD' })];
    expect(lines(award, isoDate('2026-10-10')).totalCents).toBe(900000);
  });

  it('test_regression__money_the_payroll_takes_back_nets_against_its_bonus', () => {
    // P1-2, executed by the critic on the loader: a duplicate paycheck on Oct 2
    // and the same amount taken back the same day.
    const dup = [...PAYDAYS, dep('2026-10-02', PAYCHECK, { id: 'dup' }), dep('2026-10-02', -PAYCHECK, { categoryId: 'uncategorized', id: 'rev' })];
    const p = planOf(dup, TODAY);
    expect(p.incomeBasis).toBe('regular-pay');
    expect(p.bonusesThisMonth).toMatchObject({ netCents: 0, totalCents: 0 });
    // Fail-old: credit $1,955.33.
    expect(p.bonusTowardSavingsCents).toBe(0);
    expect(bonusSentence(p)).toContain(
      'Fri, Oct 2: $9,024.60 from the payer of your regular paycheck, $4,512.30 more than its usual $4,512.30; less $4,512.30 going out this month in a debit with no category, filed as income, or worded as a reversal or return: $0.00 in all.',
    );

    // A $9,000.00 bonus taken back four days later, under a descriptor the
    // normalizer reads as a longer name ("… Ppd Reversal").
    const reversed = [
      ...PAYDAYS,
      dep('2026-10-02', 900000, { id: 'b' }),
      dep('2026-10-06', -900000, { rawDescriptor: `${PAYROLL} REVERSAL` }),
    ];
    expect(planOf(reversed, TODAY).bonusTowardSavingsCents).toBe(0);
    // Filed Bonus, taken back filed Paycheck: nets too.
    const filedBack = [...PAYDAYS, dep('2026-10-05', 300000, { categoryId: 'bonus' }), dep('2026-10-08', -300000)];
    expect(lines(filedBack).totalCents).toBe(0);
  });

  it('test_regression__a_reversal_in_any_bank_shape_nets_against_the_bonus', () => {
    // Critic cycle 2, F1, executed on the loader: real reversals change a
    // MIDDLE word, so no payer match finds them. Every shape below is filed the
    // way the real categorizer files it (uncategorized) — fail closed.
    const PPD = 'NORTHWIND HEALTH PAYROLL PPD ID: 9876543210';
    const pay = FRIDAYS.map((d) => dep(d, PAYCHECK, { rawDescriptor: PPD }));
    for (const reversal of [
      'NORTHWIND HEALTH REVERSAL PPD ID: 9876543210', // Chase-style
      'NORTHWIND HEALTH DES:REVERSAL ID:XXXX INDN:DOE JANE', // Bank of America-style
      'DEPOSITED ITEM RETURNED', // a returned check
    ]) {
      const rows = [
        ...pay,
        dep('2026-10-02', 900000, { rawDescriptor: PPD, id: 'b' }),
        dep('2026-10-06', -900000, { rawDescriptor: reversal, categoryId: 'uncategorized', id: 'r' }),
      ];
      const p = planOf(rows, TODAY);
      expect(p.incomeBasis).toBe('regular-pay');
      // Fail-old (cycle 1): credit $1,955.33, guilt-free $6,776.65.
      expect(p.bonusesThisMonth).toMatchObject({ netCents: 0, totalCents: 0 });
      expect(p.bonusTowardSavingsCents).toBe(0);
    }
    // A reversal filed to a spending category still nets on its words.
    const filed = [
      ...pay,
      dep('2026-10-02', 900000, { rawDescriptor: PPD }),
      dep('2026-10-06', -900000, { rawDescriptor: 'PAYROLL RETURN NORTHWIND', categoryId: 'bank-fees' }),
    ];
    expect(lines(filed).totalCents).toBe(0);
    // A bonus check deposited by phone and returned.
    const check = [
      ...PAYDAYS,
      dep('2026-10-05', 300000, { rawDescriptor: 'MOBILE DEPOSIT REF 1234', categoryId: 'bonus' }),
      dep('2026-10-08', -300000, { rawDescriptor: 'DEPOSITED ITEM RETURNED', categoryId: 'uncategorized' }),
    ];
    expect(lines(check).totalCents).toBe(0);
  });

  it('a purchase filed to its spending category never comes off the bonus — at the employer or anywhere (cycle 2, P2-A)', () => {
    const rows = [
      ...PAYDAYS,
      dep('2026-10-05', 300000, { categoryId: 'bonus' }),
      dep('2026-10-06', -8412, { rawDescriptor: PAYROLL, categoryId: 'shopping' }), // a purchase at the employer
      dep('2026-10-07', -120000, { rawDescriptor: 'MAPLE COURT APTS RENT', categoryId: 'rent' }),
      dep('2026-10-08', -2399, { rawDescriptor: 'ZELLE PAYMENT TO CASEY', categoryId: 'dining' }),
    ];
    expect(lines(rows)).toMatchObject({ totalCents: 300000, deposits: [{ kind: 'filed' }] });
  });

  it('money going out that is not filed as spending comes off it — whoever it went to — and the sentence says how to stop that', () => {
    const rows = [
      ...PAYDAYS,
      dep('2026-10-05', 300000, { categoryId: 'bonus' }),
      dep('2026-10-06', -80000, { rawDescriptor: 'ZELLE PAYMENT TO CASEY', categoryId: 'uncategorized' }),
      dep('2026-10-07', -20000, { rawDescriptor: 'SQ *CORNER CAFE', categoryId: null }),
    ];
    const b = lines(rows);
    expect(b).toMatchObject({ netCents: 200000, totalCents: 200000 });
    const p = computeSpendingPlan(input({ bonusesThisMonth: b }));
    expect(bonusParagraphs(p)[0]).toBe(
      'Bonus money landed this month — Mon, Oct 5: $3,000.00 filed Bonus; less $1,000.00 going out this month in 2 debits with no category, filed as income, or worded as a reversal or return: $2,000.00 in all.',
    );
    expect(bonusParagraphs(p)[2]).toContain('filing a purchase to its spending category on Transactions stops that');
    // No bonus money: nothing is listed, however many debits are unfiled.
    expect(lines(rows.filter((t) => t.categoryId !== 'bonus')).deposits).toEqual([]);
  });

  it('test_regression__a_bonus_from_a_payer_already_counted_as_other_income_is_not_counted_twice', () => {
    // Cycle 2, P2-B: a $500.00 stipend filed Income every month is regular
    // pay's "other income"; this month's, filed Bonus, is already expected.
    const STIPEND = 'NORTHWIND WELLNESS STIPEND';
    const stipends = ['2026-07-20', '2026-08-20', '2026-09-20'].map((d) =>
      dep(d, 50000, { rawDescriptor: STIPEND, categoryId: 'income' }),
    );
    const rows = [...PAYDAYS, ...stipends, dep('2026-10-09', 50000, { rawDescriptor: STIPEND, categoryId: 'bonus' })];
    const p = planOf(rows, TODAY);
    expect(p.regularPay).toMatchObject({ clean: true, otherMonthlyCents: 50000 });
    expect(p.bonusesThisMonth?.deposits).toEqual([
      { date: '2026-10-09', kind: 'filed', depositCents: 50000, less: { cents: 50000, reason: 'usual-month' }, bonusCents: 0 },
    ]);
    // Fail-old: credit $500.00.
    expect(p.bonusTowardSavingsCents).toBe(0);
    expect(bonusSentence(p)).toContain(
      'Fri, Oct 9: $500.00 filed Bonus from a payer whose pay is already counted, counted only above the $500.00 it usually pays you in a month.',
    );
    // A real bonus from that payer counts above its usual month.
    const big = [...PAYDAYS, ...stipends, dep('2026-10-09', 250000, { rawDescriptor: STIPEND, categoryId: 'bonus' })];
    expect(lines(big).totalCents).toBe(200000);
  });

  it('a Bonus row on the same day as the newest paycheck counts whole (the boundary is AFTER the last payday)', () => {
    // Cycle 2, P3-1: the Oct 16 paycheck and a separate Oct 16 bonus filed Bonus.
    const rows = [...PAYDAYS, dep('2026-10-16', 250000, { categoryId: 'bonus' })];
    expect(lines(rows).deposits).toEqual([
      { date: '2026-10-16', kind: 'filed', depositCents: 250000, less: null, bonusCents: 250000 },
    ]);
  });

  it('pay drift inside the 2% band: the usual paycheck is the newest ordinary one (cycle 2, P3-5)', () => {
    // $4,512.30 paychecks, then $4,600.00 from Sep 4; Oct 2 = $4,600.00 + $9,000.00.
    const rows = PAYDAYS.map((t) =>
      t.date === '2026-10-02' ? dep('2026-10-02', 1360000) : t.date >= '2026-09-04' ? dep(t.date, 460000) : t,
    );
    expect(lines(rows).deposits).toEqual([
      {
        date: '2026-10-02',
        kind: 'above-paycheck',
        depositCents: 1360000,
        less: { cents: 460000, reason: 'usual-paycheck' },
        bonusCents: 900000,
      },
    ]);
  });

  it('a payroll day counts only once an ordinary paycheck lands after it — a raise of more than half is not a bonus', () => {
    // P2-3: $7,000.00 on Oct 2 and Oct 16 after $4,512.30 paychecks.
    // A $50.00 deposit from the payroll after it (an expense paid back) is not
    // an ordinary paycheck — under half of one.
    const raise = [
      ...PAYDAYS.filter((t) => t.date < '2026-10-02'),
      dep('2026-10-02', 700000),
      dep('2026-10-09', 5000),
      dep('2026-10-16', 700000),
    ];
    expect(lines(raise, isoDate('2026-10-20')).deposits).toEqual([]);
    // A bonus on the newest payday waits for the next paycheck.
    const newest = [...PAYDAYS.filter((t) => t.date < '2026-10-16'), dep('2026-10-16', 1351230)];
    expect(lines(newest).deposits).toEqual([]);
    // …and a row dated after today is not that paycheck landing.
    expect(lines([...newest, dep('2026-10-30', PAYCHECK)]).deposits).toEqual([]);
  });

  it('after a rise, the usual paycheck is the newest level', () => {
    // P2-4: $4,000.00 through Aug 7, $4,800.00 from Aug 21; Oct 2 = $4,800.00 + $3,000.00.
    const dates = Array.from({ length: 13 }, (_, i) => addDays(isoDate('2026-05-01'), 14 * i) as string);
    const rows = dates.map((d) => dep(d, d === '2026-10-02' ? 780000 : d <= '2026-08-07' ? 400000 : 480000));
    const pay = regularPayFromRows(rows, isoDate('2026-10-20'));
    expect(pay.streams[0]).toMatchObject({ paycheckCents: 400000, step: { direction: 'rose', newestCents: 480000 } });
    expect(bonusesThisMonth(rows, isoDate('2026-10-20'), pay).deposits).toEqual([
      { date: '2026-10-02', kind: 'above-paycheck', depositCents: 780000, less: { cents: 480000, reason: 'usual-paycheck' }, bonusCents: 300000 },
    ]);
  });

  it('payroll days from last month are not this month’s bonus', () => {
    // P2-6(a): Sep 18 carried a $9,000.00 bonus; today is Oct 17.
    const rows = PAYDAYS.map((t) => (t.date === '2026-09-18' ? dep('2026-09-18', 1351230) : t));
    expect(lines(rows).deposits).toEqual([]);
  });

  it('over plan, the words follow the overage (P2-1)', () => {
    const over = computeSpendingPlan(input({ bonusesThisMonth: ON_PAYDAY, categoryFixedCents: 1000000 }));
    expect(over.overspent).toBe(true);
    expect(bonusSentence(over)).toContain("so this month's overage is $1,955.33 smaller than your pay alone would make it.");
    expect(bonusSentence(over)).toContain('it is yours to decide: covering this month’s overage, more savings or investing');
    expect(bonusSentence(over)).not.toContain('higher');
    expect(bonusShortNote(over)).toBe(
      "This month's bonus counts $1,955.33 toward your savings, so the overage is $1,955.33 smaller than your pay alone would make it.",
    );
    const a = answerSafeToSpend(over, DISCLOSURES);
    expect(a.headline).toMatch(/over your plan/);
    expect(a.detail).not.toContain('higher than your pay alone');
  });

  it('a total below zero prints as what it is (P2-2)', () => {
    const rows = [...PAYDAYS, dep('2026-10-05', 300000, { categoryId: 'bonus' }), dep('2026-10-08', -500000, { categoryId: 'bonus' })];
    const p = computeSpendingPlan(input({ bonusesThisMonth: lines(rows) }));
    expect(p.bonusesThisMonth).toMatchObject({ netCents: -200000, totalCents: 0 });
    expect(bonusSentence(p)).toContain(': -$2,000.00 in all.');
    expect(bonusSentence(p)).toContain('It nets to -$2,000.00, so none of it is counted here.');
  });

  it('planners name the figure they read — guilt-free from pay — in a bonus month (P2-5)', () => {
    expect(plannerGuiltFreeNoun(false)).toBe('guilt-free spending');
    expect(plannerGuiltFreeNoun(true)).toBe('guilt-free spending from pay');
    expect(COACH_COPY.wealthTargetAdditional(cents(50000), cents(282132), true, true)).toBe(
      "That's $500.00/month more than you save today, and it fits inside your $2,821.32 of monthly guilt-free spending from pay.",
    );
    expect(COACH_COPY.wealthTargetAdditional(cents(50000), cents(282132), true)).toContain('of monthly guilt-free spending.');
    const server = readFileSync(resolve('src/server/assistant.ts'), 'utf8');
    for (const fn of ['answerDebtFreeByDate', 'answerSavingsGoalByDate', 'answerRetireAtAge']) {
      expect(server).toMatch(new RegExp(`return ${fn}\\([^;]*plan\\.bonusTowardSavingsCents > 0\\);`));
    }
    expect(readFileSync(resolve('src/app/(app)/coach/page.tsx'), 'utf8')).toContain('bonusMonth={plan.bonusTowardSavingsCents > 0}');
  });
});

describe('critic cycle 3 (DECISIONS #787) — the paycheck payer’s extra pay, two untested guards, the words', () => {
  it('test_regression__a_bonus_from_the_paycheck_payer_already_counted_as_its_extra_pay_is_not_counted_twice', () => {
    // Cycle 3, P2-1, executed on the loader by the critic: the payroll also
    // pays $400.00 filed Paycheck every month (regular pay's "other"), and this
    // month's $400.00 from it is filed Bonus.
    const extras = ['2026-07-21', '2026-08-18', '2026-09-15'].map((d) => dep(d, 40000));
    const rows = [...PAYDAYS, ...extras, dep('2026-10-07', 40000, { categoryId: 'bonus' })];
    const pay = regularPayFromRows(rows, TODAY);
    expect(pay).toMatchObject({ clean: true, otherMonthlyCents: 40000 });
    const p = computeSpendingPlan(input({ regularPay: pay, bonusesThisMonth: bonusesThisMonth(rows, TODAY, pay) }));
    expect(p.bonusesThisMonth?.deposits).toEqual([
      { date: '2026-10-07', kind: 'filed', depositCents: 40000, less: { cents: 40000, reason: 'usual-extra' }, bonusCents: 0 },
    ]);
    // Fail-old: credit $400.00.
    expect(p.bonusTowardSavingsCents).toBe(0);
    expect(bonusSentence(p)).toContain(
      'Wed, Oct 7: $400.00 filed Bonus from the payer of your regular paycheck, counted only above the $400.00 a month it usually pays you besides that paycheck.',
    );
    // A payroll with no extra pay in the window keeps its bonus whole.
    expect(lines([...PAYDAYS, dep('2026-10-07', 40000, { categoryId: 'bonus' })]).totalCents).toBe(40000);
  });

  it('a reversal filed as a purchase still nets on its words (cycle 3, P2-2a)', () => {
    // The real categorizer files big-retail payroll rows as shopping.
    const rows = [
      ...PAYDAYS,
      dep('2026-10-05', 300000, { rawDescriptor: 'WAL-MART ASSOCIATES DES:BONUS', categoryId: 'bonus' }),
      dep('2026-10-08', -300000, { rawDescriptor: 'WAL-MART ASSOCIATES DES:REVERSAL ID:XXXX', categoryId: 'shopping' }),
    ];
    expect(lines(rows).totalCents).toBe(0);
    for (const word of ['REVERSED', 'REVERSE', 'REV', 'RETURNED', 'CHARGEBACK', 'CHGBK']) {
      const r = [...rows.slice(0, -1), dep('2026-10-08', -300000, { rawDescriptor: `NORTHWIND ${word} 1234`, categoryId: 'shopping' })];
      expect(lines(r).totalCents).toBe(0);
    }
  });

  it('a bonus clawed back after the last payday nets whole (cycle 3, P2-2b)', () => {
    const rows = [...PAYDAYS, dep('2026-10-05', 300000, { categoryId: 'bonus' }), dep('2026-10-17', -300000, { categoryId: 'bonus' })];
    expect(lines(rows)).toMatchObject({ netCents: 0, totalCents: 0 });
    expect(computeSpendingPlan(input({ bonusesThisMonth: lines(rows) })).bonusTowardSavingsCents).toBe(0);
  });

  it('the words: never "never plans the month" beside a basis that may hold bonus pay; from over plan to positive (cycle 3, P3-1/P3-5)', () => {
    const median = computeSpendingPlan(input({ bonusesThisMonth: ON_PAYDAY, regularPay: null }));
    expect(bonusParagraphs(median)[1]).toMatch(/^A bonus pays this month's savings first only while income is your regular pay/);
    expect(bonusSentence(median)).not.toContain('never plans the month');
    // Fixed $9,000.00: pay alone is −$1,178.68; the bonus makes it +$776.65.
    const crossing = computeSpendingPlan(input({ bonusesThisMonth: ON_PAYDAY, categoryFixedCents: 900000 }));
    expect(crossing).toMatchObject({ leftToSpendFromPayCents: -117868, leftToSpendCents: 77665, overspent: false });
    expect(bonusSentence(crossing)).toContain('so instead of $1,178.68 over plan on your pay alone, this month has $776.65 guilt-free.');
    expect(bonusShortNote(crossing)).toBe(
      "This month's bonus counts $1,955.33 toward your savings, so instead of $1,178.68 over plan on your pay alone, this month has $776.65 guilt-free.",
    );
    expect(bonusSentence(crossing)).not.toContain('higher than your pay alone');
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
    // A savings account the income figure does not read (P2-6(b)).
    const savings = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'manual',
        providerRef: `${USER}-sav`,
        name: 'High-Yield Savings',
        type: 'SAVINGS',
        currentBalanceCents: 1500000,
        currency: 'USD',
      },
    });
    await prisma.transaction.create({
      data: {
        accountId: savings.id,
        date: '2026-10-12',
        amountCents: 400000,
        rawDescriptor: 'NORTHWIND HEALTH RETENTION AWARD',
        categoryId: 'bonus',
        confidenceBps: 10000,
        needsReview: false,
      },
    });
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
    // Only the checking account the income figure reads — never the $4,000.00
    // filed Bonus in savings.
    expect(plan.bonusesThisMonth).toMatchObject({
      month: '2026-10',
      totalCents: 250000,
      deposits: [{ date: '2026-10-09', kind: 'filed', bonusCents: 250000 }],
    });
    expect(plan.bonusesThisMonth?.deposits).toHaveLength(1);
    // Rent $3,000.00; savings 20% = $1,955.33, all of it paid by the $2,500.00.
    expect(plan.fixedExpensesCents).toBe(300000);
    expect(plan.plannedSavingsCents).toBe(195533);
    expect(plan.bonusTowardSavingsCents).toBe(195533);
    expect(plan.leftToSpendFromPayCents).toBe(977665 - 300000 - 195533);
    expect(plan.leftToSpendCents).toBe(977665 - 300000);
  });
});
