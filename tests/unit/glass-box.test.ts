/**
 * Glass-Box trace suite (DECISIONS #178, Competitive-Gap Gap 4 §1).
 * Every expected value is HAND-COMPUTED in docs/EDGE_CASES.md §Glass-Box.
 * If code and doc disagree, resolve on paper — never edit the expectation
 * to match the code.
 *
 * The load-bearing invariant: a trace's rows are reshaped FROM the engine
 * result (never recomputed), so sum(rows) === headline must hold on every
 * path the engine can produce — and when a result is internally inconsistent
 * (doctored here), the trace must REPORT the mismatch, not hide it.
 */
import { describe, expect, it } from 'vitest';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import type { CardSnapshot, CashNeededInput } from '@/lib/engine/cash-needed/types';
import { traceCashNeeded, traceSafeToSpend } from '@/lib/engine/glass-box/trace';
import { computeSpendingPlan } from '@/lib/engine/spending-plan/plan';
import { cents } from '@/lib/money';
import { holidayTable, isoDate } from '@/lib/dates';

const d = isoDate;
const HOLIDAYS = holidayTable(2025, 2027);

function card(over: Partial<CardSnapshot> & { id: string; name: string }): CardSnapshot {
  return {
    aprBps: 2400,
    autopay: null,
    statement: null,
    currentBalanceCents: cents(0),
    paymentsAppliedCents: cents(0),
    ...over,
  };
}

function statement(balance: number, dueDate: string, min = 3500, cycleEnd = '2026-05-18') {
  return {
    statementBalanceCents: cents(balance),
    minimumPaymentCents: cents(min),
    dueDate: d(dueDate),
    cycleEnd: d(cycleEnd),
  };
}

function input(over: Partial<CashNeededInput>): CashNeededInput {
  return {
    today: d('2026-06-10'),
    paymentAccount: { name: 'Checking', balanceCents: cents(340000), pending: [], frozenSince: null },
    cards: [],
    scheduled: [],
    scenario: 'PAY_IN_FULL',
    holidayTable: HOLIDAYS,
    ...over,
  };
}

const amex = card({
  id: 'amex',
  name: 'Amex',
  statement: statement(210000, '2026-06-15'),
  autopay: { mode: 'STATEMENT_BALANCE' },
});
const chase = card({ id: 'chase', name: 'Chase', statement: statement(271233, '2026-06-15') });

describe('G1 — cash-needed trace: rows are the headline, to the penny', () => {
  const result = computeCashNeeded(input({ cards: [amex, chase] }));
  const trace = traceCashNeeded(result);

  it('two rows (Amex, Chase — date then name order), $2,100.00 + $2,712.33 = $4,812.33', () => {
    expect(trace.rows.map((r) => r.label)).toEqual(['Amex', 'Chase']);
    expect(trace.rows.map((r) => r.amountCents)).toEqual([210000, 271233]);
    expect(trace.sumCents).toBe(481233);
    expect(trace.headlineCents).toBe(481233);
    expect(trace.reconciles).toBe(true);
  });
  it('row count equals the headline cards-due count', () => {
    expect(trace.rows).toHaveLength(result.headline.cardsDueCount);
  });
  it('rows carry effective due date, autopay portion, and the engine-authored notes', () => {
    expect(trace.rows[0].date).toBe('2026-06-15');
    expect(trace.rows[0].autopayCents).toBe(210000);
    expect(trace.rows[0].notes.join(' ')).toMatch(/autopay handles this payment/i);
    expect(trace.rows[1].autopayCents).toBe(0);
    expect(trace.rows[1].notes).toEqual([]);
  });
  it('no estimated rows and no upcoming cards → no basis caveats', () => {
    expect(trace.rows.every((r) => !r.isEstimated)).toBe(true);
    expect(trace.basis).toEqual([]);
  });
});

describe('G2 — MINIMUM scenario reconciles (autopay max() path included)', () => {
  // Amex: scenario target = min $35, autopay pulls the full $2,100 anyway →
  // cash required = max = $2,100. Chase: min $35. Headline $2,135.00.
  const result = computeCashNeeded(input({ cards: [amex, chase], scenario: 'MINIMUM' }));
  const trace = traceCashNeeded(result);

  it('$2,100.00 + $35.00 = $2,135.00, reconciled', () => {
    expect(result.headline.requiredCents).toBe(213500);
    expect(trace.rows.map((r) => r.amountCents)).toEqual([210000, 3500]);
    expect(trace.sumCents).toBe(213500);
    expect(trace.reconciles).toBe(true);
  });
});

describe('G3 — estimated-only path (no statement generated at all)', () => {
  const est = card({
    id: 'est',
    name: 'Store Card',
    currentBalanceCents: cents(50000),
    nextDueDate: d('2026-06-20'),
  });
  const trace = traceCashNeeded(computeCashNeeded(input({ cards: [est] })));

  it('one estimated row for the full $500.00, reconciled, with the estimate stated in basis', () => {
    expect(trace.rows).toHaveLength(1);
    expect(trace.rows[0].isEstimated).toBe(true);
    expect(trace.rows[0].amountCents).toBe(50000);
    expect(trace.sumCents).toBe(50000);
    expect(trace.reconciles).toBe(true);
    expect(trace.basis.join(' ')).toMatch(/statement has not been generated/i);
  });
});

describe('G4 — mixed real + estimated: next-cycle estimates are excluded and disclosed', () => {
  const est = card({
    id: 'est',
    name: 'Store Card',
    currentBalanceCents: cents(50000),
    nextDueDate: d('2026-06-20'),
  });
  const result = computeCashNeeded(input({ cards: [chase, est] }));
  const trace = traceCashNeeded(result);

  it('only the real Chase row; $2,712.33 reconciles; the exclusion is stated in basis', () => {
    expect(result.upcoming).toHaveLength(1);
    expect(trace.rows.map((r) => r.label)).toEqual(['Chase']);
    expect(trace.sumCents).toBe(271233);
    expect(trace.reconciles).toBe(true);
    expect(trace.basis.join(' ')).toMatch(/next cycle/i);
    expect(trace.basis.join(' ')).toMatch(/not included in this number/i);
  });
});

describe('G5 — date edges still reconcile and rows show the effective date', () => {
  it('past-due card is clamped to today (2026-06-10)', () => {
    const overdue = card({ id: 'od', name: 'Overdue', statement: statement(10000, '2026-06-05') });
    const trace = traceCashNeeded(computeCashNeeded(input({ cards: [overdue] })));
    expect(trace.rows[0].date).toBe('2026-06-10');
    expect(trace.sumCents).toBe(10000);
    expect(trace.reconciles).toBe(true);
  });
  it('weekend due date walks back: Sat 2026-06-13 → Fri 2026-06-12', () => {
    const sat = card({ id: 'sat', name: 'Weekend', statement: statement(10000, '2026-06-13') });
    const trace = traceCashNeeded(computeCashNeeded(input({ cards: [sat] })));
    expect(trace.rows[0].date).toBe('2026-06-12');
    expect(trace.reconciles).toBe(true);
  });
});

describe('G6 — empty and zero-due paths', () => {
  it('no cards: zero rows, $0 headline, vacuously reconciled', () => {
    const trace = traceCashNeeded(computeCashNeeded(input({})));
    expect(trace.rows).toEqual([]);
    expect(trace.headlineCents).toBe(0);
    expect(trace.sumCents).toBe(0);
    expect(trace.reconciles).toBe(true);
  });
  it('a fully-paid card contributes no row; the rest still reconcile', () => {
    const paid = card({
      id: 'paid',
      name: 'Paid Off',
      statement: statement(100000, '2026-06-15'),
      paymentsAppliedCents: cents(100000),
    });
    const trace = traceCashNeeded(computeCashNeeded(input({ cards: [paid, chase] })));
    expect(trace.rows.map((r) => r.label)).toEqual(['Chase']);
    expect(trace.sumCents).toBe(271233);
    expect(trace.reconciles).toBe(true);
  });
});

describe('G7 — a doctored (internally inconsistent) result is REPORTED, not hidden', () => {
  it('reconciles=false and sumCents keeps the true row sum', () => {
    const result = computeCashNeeded(input({ cards: [amex, chase] }));
    const doctored = {
      ...result,
      headline: { ...result.headline, requiredCents: cents(result.headline.requiredCents + 1) },
    };
    const trace = traceCashNeeded(doctored);
    expect(trace.reconciles).toBe(false);
    expect(trace.sumCents).toBe(481233);
    expect(trace.headlineCents).toBe(481234);
  });
});

describe('S — guilt-free-spending trace: the five-term identity as signed rows', () => {
  it('S1 normal month: +$5,000.00 − $1,234.56 − $789.00 − $0.00 − $500.00 = $2,476.44', () => {
    const plan = computeSpendingPlan({
      today: d('2026-06-10'),
      expectedIncomeCents: 500000,
      spentSoFarCents: 123456,
      upcomingBillsCents: 78900,
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 50000,
      savingsTargetBps: null,
    });
    const trace = traceSafeToSpend(plan);
    expect(trace.rows.map((r) => r.label)).toEqual([
      'Expected income',
      'Spent so far (cash accounts)',
      'Bills still coming',
      'Card payments due this month',
      'Planned savings (goals)',
    ]);
    expect(trace.rows.map((r) => r.amountCents)).toEqual([500000, -123456, -78900, 0, -50000]);
    expect(trace.sumCents).toBe(247644);
    expect(trace.headlineCents).toBe(247644);
    expect(trace.reconciles).toBe(true);
  });
  it('S1b card obligations appear as their own signed row and the identity still reconciles (#295)', () => {
    const plan = computeSpendingPlan({
      today: d('2026-06-10'),
      expectedIncomeCents: 500000,
      spentSoFarCents: 123456,
      upcomingBillsCents: 78900,
      cardObligationsCents: 90000,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 50000,
      savingsTargetBps: null,
    });
    const trace = traceSafeToSpend(plan);
    expect(trace.rows.map((r) => r.amountCents)).toEqual([500000, -123456, -78900, -90000, -50000]);
    expect(trace.sumCents).toBe(157644);
    expect(trace.headlineCents).toBe(157644);
    expect(trace.reconciles).toBe(true);
  });
  it('S1c a winning savings target renames the savings row so the label matches the deciding input', () => {
    const plan = computeSpendingPlan({
      today: d('2026-06-10'),
      expectedIncomeCents: 500000,
      spentSoFarCents: 0,
      upcomingBillsCents: 0,
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 50000,
      savingsTargetBps: 2000, // 20% of $5,000 = $1,000 > $500 goals
    });
    const trace = traceSafeToSpend(plan);
    const savings = trace.rows[4];
    expect(savings.label).toBe('Savings target (from Settings)');
    expect(savings.amountCents).toBe(-100000);
    expect(trace.reconciles).toBe(true);
  });
  it('S2 overspent month reconciles to a negative headline', () => {
    const plan = computeSpendingPlan({
      today: d('2026-06-10'),
      expectedIncomeCents: 100000,
      spentSoFarCents: 150000,
      upcomingBillsCents: 0,
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
    });
    const trace = traceSafeToSpend(plan);
    expect(trace.sumCents).toBe(-50000);
    expect(trace.headlineCents).toBe(-50000);
    expect(trace.reconciles).toBe(true);
  });
  it('S3 empty month: five $0 rows, $0, reconciled', () => {
    const plan = computeSpendingPlan({
      today: d('2026-06-10'),
      expectedIncomeCents: 0,
      spentSoFarCents: 0,
      upcomingBillsCents: 0,
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
    });
    const trace = traceSafeToSpend(plan);
    expect(trace.rows).toHaveLength(5);
    expect(trace.sumCents).toBe(0);
    expect(trace.reconciles).toBe(true);
  });
});

describe('S4 — a doctored (inconsistent) plan is REPORTED, not hidden', () => {
  it('reconciles=false and sumCents keeps the true row sum', () => {
    // Note: computeSpendingPlan can never actually produce this (the trace and
    // the engine evaluate the same identity on the same fields), so this branch
    // is unreachable from real code — locked here so the fail-loud contract
    // survives any future engine refactor that breaks that symmetry.
    const plan = computeSpendingPlan({
      today: d('2026-06-10'),
      expectedIncomeCents: 500000,
      spentSoFarCents: 123456,
      upcomingBillsCents: 78900,
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 50000,
      savingsTargetBps: null,
    });
    const doctored = { ...plan, leftToSpendCents: plan.leftToSpendCents + 1 };
    const trace = traceSafeToSpend(doctored);
    expect(trace.reconciles).toBe(false);
    expect(trace.sumCents).toBe(247644);
    expect(trace.headlineCents).toBe(247645);
  });
});

describe("S6 — a card dated past the month's edge is a ROW, not an adjustment (L.11(D))", () => {
  const beyond = (obligationsBeyondMonthCents: number) =>
    traceSafeToSpend(
      computeSpendingPlan({
        today: d('2026-07-26'),
        expectedIncomeCents: 1000000,
        spentSoFarCents: 0,
        upcomingBillsCents: 0,
        cardObligationsCents: 0,
        cardObligationsEstimated: false,
        obligationsBeyondMonthCents,
        obligationsBeyondMonthThroughDate: obligationsBeyondMonthCents > 0 ? 'Wed, Aug 5' : null,
        obligationsBeyondMonthEstimated: false,
        goalContributionsCents: 0,
        savingsTargetBps: null,
      }),
    );

  it('adds a sixth row the panel can actually falsify, and reconciles to it', () => {
    const trace = beyond(900000);
    expect(trace.rows).toHaveLength(6);
    expect(trace.rows[5].label).toBe(
      'Card payments already dated, due after this month (through Wed, Aug 5)',
    );
    expect(trace.rows[5].amountCents).toBe(-900000);
    expect(trace.sumCents).toBe(100000);
    expect(trace.headlineCents).toBe(100000);
    expect(trace.reconciles).toBe(true);
    // The date reads in the product's own voice, never as a raw ISO string.
    expect(trace.rows[5].label).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(trace.basis.some((b) => b.includes('would otherwise sit in no plan you can see'))).toBe(true);
    // And it states the cost it accepts rather than hiding it.
    expect(trace.basis.some((b) => b.includes("next month's card-payments line"))).toBe(true);
  });

  it('adds no row and no sentence when every card is due inside the month', () => {
    const trace = beyond(0);
    expect(trace.rows).toHaveLength(5);
    expect(trace.reconciles).toBe(true);
    expect(trace.basis.some((b) => b.includes('no plan you can see'))).toBe(false);
  });
});
