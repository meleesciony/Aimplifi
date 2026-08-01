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
import { answerSafeToSpend } from '@/lib/engine/assistant/answer';
import { computeSpendingPlan, type SpendingPlanDisclosures } from '@/lib/engine/spending-plan/plan';
import { planRowLabels } from '@/lib/engine/spending-plan/row-labels';
import { cents } from '@/lib/money';
import { holidayTable, isoDate } from '@/lib/dates';

const d = isoDate;
const HOLIDAYS = holidayTable(2025, 2027);

/** L.29: the two counts that separate "nothing qualified" from "not set up". */
const disclosures = (over: Partial<SpendingPlanDisclosures> = {}): SpendingPlanDisclosures => ({
  undatedCards: [],
  statementPendingCards: [],
  duplicatePairs: [],
  frozenCards: [],
  creditCardCount: 0,
  creditCardsOutsideFigure: 0,
  cardsDatedAfterThisMonth: 0,
  // L.30: the census that separates a true fixed-expenses zero from a broken one.
  // Default is the empty reader (nothing detected at all); the L.30 cases override it.
  fixedSeries: { detected: 0, counted: 0, onCard: 0, lapsed: 0, uncounted: 0, noCashAccount: 0 },
  ...over,
});
/** A reader with no linked cards and no goals — so a $0 row here means "nothing
 *  to count", which is what the pre-L.29 fixtures below all silently assumed. */
const NO_CARDS_OR_GOALS = disclosures();

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

describe('S — guilt-free-spending trace: the pattern-model identity as signed rows (L.22)', () => {
  it('S1 normal month: +$5,000.00 − $2,023.56 − $500.00 = $2,476.44', () => {
    const plan = computeSpendingPlan({
      today: d('2026-06-10'),
      trailingMonthlyIncomeCents: [500000, 500000],
      scheduledIncome: [],
      scheduledFixed: [{ amountCents: -202356, cadence: 'MONTHLY' }],
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 50000,
      savingsTargetBps: null,
    });
    const trace = traceSafeToSpend(plan, NO_CARDS_OR_GOALS);
    // Owner 2026-08-01: exactly three rows — income, fixed, savings. Cards are not a term.
    expect(trace.rows.map((r) => r.id)).toEqual(['income', 'fixed', 'savings']);
    expect(trace.rows.map((r) => r.label)).toEqual([
      'Income (median of last 2 months)',
      'Fixed & recurring expenses (monthly pattern)',
      'Planned savings (goals)',
    ]);
    expect(trace.rows.map((r) => r.amountCents)).toEqual([500000, -202356, -50000]);
    expect(trace.sumCents).toBe(247644);
    expect(trace.headlineCents).toBe(247644);
    expect(trace.reconciles).toBe(true);
  });
  it('S1b card obligations are carried on the plan but are NOT a guilt-free row', () => {
    const plan = computeSpendingPlan({
      today: d('2026-06-10'),
      trailingMonthlyIncomeCents: [500000],
      scheduledIncome: [],
      scheduledFixed: [{ amountCents: -202356, cadence: 'MONTHLY' }],
      cardObligationsCents: 90000,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 50000,
      savingsTargetBps: null,
    });
    expect(plan.cardObligationsCents).toBe(90000);
    const trace = traceSafeToSpend(plan, disclosures({ creditCardCount: 1 }));
    expect(trace.rows.map((r) => r.id)).toEqual(['income', 'fixed', 'savings']);
    expect(trace.rows.map((r) => r.amountCents)).toEqual([500000, -202356, -50000]);
    expect(trace.sumCents).toBe(247644);
    expect(trace.headlineCents).toBe(247644);
    expect(trace.reconciles).toBe(true);
    expect(trace.basis.some((b) => b.includes('Card statement payments are not subtracted here'))).toBe(true);
  });
  it('S1c a winning savings target renames the savings row so the label matches the deciding input', () => {
    const plan = computeSpendingPlan({
      today: d('2026-06-10'),
      trailingMonthlyIncomeCents: [500000],
      scheduledIncome: [],
      scheduledFixed: [],
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 50000,
      savingsTargetBps: 2000, // 20% of $5,000 = $1,000 > $500 goals
    });
    const trace = traceSafeToSpend(plan, NO_CARDS_OR_GOALS);
    const savings = trace.rows[2];
    expect(savings.id).toBe('savings');
    expect(savings.label).toBe('Savings target (from Settings)');
    expect(savings.amountCents).toBe(-100000);
    expect(trace.reconciles).toBe(true);
  });
  it('S1d the income row names the basis it actually used — median, detected series, or none', () => {
    const series = computeSpendingPlan({
      today: d('2026-06-10'),
      trailingMonthlyIncomeCents: [],
      scheduledIncome: [{ amountCents: 500000, cadence: 'MONTHLY' }],
      scheduledFixed: [],
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
    });
    expect(traceSafeToSpend(series, NO_CARDS_OR_GOALS).rows[0].label).toBe('Income (detected recurring, monthly)');
    expect(traceSafeToSpend(series, NO_CARDS_OR_GOALS).rows[0].amountCents).toBe(500000);
    const none = computeSpendingPlan({
      today: d('2026-06-10'),
      trailingMonthlyIncomeCents: [],
      scheduledIncome: [],
      scheduledFixed: [],
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
    });
    expect(traceSafeToSpend(none, NO_CARDS_OR_GOALS).rows[0].label).toBe('Income (no pattern yet)');
  });
  it('S2 overspent month reconciles to a negative headline', () => {
    const plan = computeSpendingPlan({
      today: d('2026-06-10'),
      trailingMonthlyIncomeCents: [100000],
      scheduledIncome: [],
      scheduledFixed: [{ amountCents: -150000, cadence: 'MONTHLY' }],
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
    });
    const trace = traceSafeToSpend(plan, NO_CARDS_OR_GOALS);
    expect(trace.sumCents).toBe(-50000);
    expect(trace.headlineCents).toBe(-50000);
    expect(trace.reconciles).toBe(true);
  });
  it('S3 empty month: three $0 rows, $0, reconciled', () => {
    const plan = computeSpendingPlan({
      today: d('2026-06-10'),
      trailingMonthlyIncomeCents: [],
      scheduledIncome: [],
      scheduledFixed: [],
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
    });
    const trace = traceSafeToSpend(plan, NO_CARDS_OR_GOALS);
    expect(trace.rows).toHaveLength(3);
    expect(trace.rows.map((r) => r.id)).toEqual(['income', 'fixed', 'savings']);
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
      trailingMonthlyIncomeCents: [500000],
      scheduledIncome: [],
      scheduledFixed: [{ amountCents: -202356, cadence: 'MONTHLY' }],
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 50000,
      savingsTargetBps: null,
    });
    const doctored = { ...plan, leftToSpendCents: plan.leftToSpendCents + 1 };
    const trace = traceSafeToSpend(doctored, NO_CARDS_OR_GOALS);
    expect(trace.reconciles).toBe(false);
    expect(trace.sumCents).toBe(247644);
    expect(trace.headlineCents).toBe(247645);
  });
});

describe("S6 — cards dated past the month's edge are NOT a guilt-free row (owner 2026-08-01)", () => {
  const beyond = (obligationsBeyondMonthCents: number) => {
    const plan = computeSpendingPlan({
      today: d('2026-07-26'),
      trailingMonthlyIncomeCents: [1000000],
      scheduledIncome: [],
      scheduledFixed: [],
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents,
      obligationsBeyondMonthThroughDate: obligationsBeyondMonthCents > 0 ? 'Wed, Aug 5' : null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
    });
    return {
      plan,
      trace: traceSafeToSpend(plan, disclosures({ creditCardCount: 1 })),
    };
  };

  it('keeps three rows; leftToSpend equals pattern income; basis points at Cash needed', () => {
    const { plan, trace } = beyond(900000);
    // Beyond-month obligations are still carried for cash-needed / disclosures…
    expect(plan.obligationsBeyondMonthCents).toBe(900000);
    // …but they are not a guilt-free subtraction.
    expect(trace.rows).toHaveLength(3);
    expect(trace.rows.map((r) => r.id)).toEqual(['income', 'fixed', 'savings']);
    expect(trace.rows.find((r) => r.id === 'card-payments-next')).toBeUndefined();
    expect(trace.sumCents).toBe(1000000);
    expect(trace.headlineCents).toBe(1000000);
    expect(plan.leftToSpendCents).toBe(plan.patternIncomeCents);
    expect(trace.reconciles).toBe(true);
    expect(trace.basis.some((b) => b.includes('Card statement payments are not subtracted here'))).toBe(true);
    expect(trace.basis.some((b) => b.includes('no plan you can see'))).toBe(false);
    expect(trace.basis.some((b) => b.includes("next month's card-payments line"))).toBe(false);
  });

  it('still has exactly three rows when every card is due inside the month', () => {
    const { trace } = beyond(0);
    expect(trace.rows).toHaveLength(3);
    expect(trace.reconciles).toBe(true);
    expect(trace.basis.some((b) => b.includes('Card statement payments are not subtracted here'))).toBe(true);
    expect(trace.basis.some((b) => b.includes('no plan you can see'))).toBe(false);
  });
});

describe('S7 — a true zero and a broken zero must not print the same line (TASKS L.29)', () => {
  const planWith = (over: Partial<Parameters<typeof computeSpendingPlan>[0]> = {}) =>
    computeSpendingPlan({
      today: d('2026-07-27'),
      trailingMonthlyIncomeCents: [500000, 500000, 500000],
      scheduledIncome: [],
      scheduledFixed: [],
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
      ...over,
    });
  const rowById = (id: string, plan = planWith(), disc = NO_CARDS_OR_GOALS) =>
    traceSafeToSpend(plan, disc).rows.find((r) => r.id === id)!;
  // Card-payment LABELS still live on planRowLabels for cash-needed / disclosures
  // surfaces — they are no longer a guilt-free trace row (owner 2026-08-01).
  const cardLabel = (disc: Partial<SpendingPlanDisclosures>, plan = planWith()) =>
    planRowLabels(plan, disclosures(disc)).cardPayments.label;

  it('the card-payments zero names WHICH zero it is, and never claims an absence it cannot prove', () => {
    // (a) nothing linked at all.
    expect(cardLabel({ creditCardCount: 0 })).toBe('Card payments (no credit cards linked)');
    // (b) cards linked, every one accounted for, none owing this month.
    expect(cardLabel({ creditCardCount: 2 })).toBe('Card payments (none due this month)');
    // (c) a payment IS dated, past the edge. Keyed to the DATED population, not to
    // `obligationsBeyondMonthCents` — that figure is the worst gap NET of scheduled
    // income, so it is 0 in the commonest issuer pattern of all (paid the 1st, cards
    // due the 3rd), and the first cut called a statement three days out "none due
    // this month" (L.29 critic P1-1). Here the reservation is deliberately ZERO.
    expect(cardLabel({ creditCardCount: 1, cardsDatedAfterThisMonth: 1 })).toBe(
      'Card payments (none due until after this month)',
    );
    // (d) a card the figure could not COUNT may well be due inside this month — the
    // page says exactly that twelve lines lower — so "none due" would contradict the
    // same screen. Both exclusion mechanisms, plus the withheld (non-USD) card that
    // is in no list at all because the snapshot dropped it before the engine ran.
    expect(
      cardLabel({ creditCardCount: 2, undatedCards: [{ cardName: 'Sapphire', frozenSince: null }] }),
    ).toBe('Card payments (none counted this month)');
    expect(
      cardLabel({
        creditCardCount: 2,
        statementPendingCards: [{ cardName: 'Bonvoy', dueDate: '2026-07-28' }],
      }),
    ).toBe('Card payments (none counted this month)');
    expect(cardLabel({ creditCardCount: 1, creditCardsOutsideFigure: 1 })).toBe(
      'Card payments (none counted this month)',
    );
    // …and "not counted" outranks "dated later": the uncounted card may be the
    // earlier one, so the softer claim has to win.
    expect(
      cardLabel({
        creditCardCount: 2,
        cardsDatedAfterThisMonth: 1,
        undatedCards: [{ cardName: 'Venture', frozenSince: null }],
      }),
    ).toBe('Card payments (none counted this month)');
    // A real obligation keeps the original label, and carries no control.
    const due = planRowLabels(
      planWith({ cardObligationsCents: 45000 }),
      disclosures({ creditCardCount: 1 }),
    ).cardPayments;
    expect(due.label).toBe('Card payments due this month');
    expect(due.action).toBeUndefined();
    // And that label is NOT a guilt-free row.
    expect(
      traceSafeToSpend(planWith({ cardObligationsCents: 45000 }), disclosures({ creditCardCount: 1 })).rows.find(
        (r) => r.id === 'card-payments',
      ),
    ).toBeUndefined();
  });

  it('the fixed-expenses zero names WHICH zero it is, from the recorded reason (L.30)', () => {
    // L.29 could only ever say "none counted" here, because nothing downstream of
    // the projection knew WHY a series had not become a row. `fixedSeries` records
    // it, so each of these four zeros is now a different sentence. Written as a
    // matrix on purpose: the failure that started this thread was four facts
    // sharing one pixel.
    const census = (over: Partial<SpendingPlanDisclosures['fixedSeries']>) =>
      rowById('fixed', planWith(), disclosures({ fixedSeries: { detected: 0, counted: 0, onCard: 0, lapsed: 0, uncounted: 0, noCashAccount: 0, ...over } }));

    // (a) THE ALARM: a bill was found and is not in the figure. Named first
    // because it is the only branch where the $0.00 is WRONG, and it carries the
    // list. It states the count and points at the list; it names no cause,
    // because two mechanisms reach it.
    // The count is UNCOUNTED, not detected. Both critics found the first cut
    // printing "3 bills found" beside a note that said one: two of those three are
    // correctly elsewhere, so naming all three invited the reader to add back money
    // that is not missing -- two answers to one question, on one page.
    const broken = census({ detected: 3, uncounted: 1 });
    expect(broken.label).toBe('Fixed & recurring expenses (1 bill found, not counted here)');
    expect(broken.label).not.toContain('3 bills');
    expect(broken.action).toEqual({ label: 'See your recurring bills', href: '/recurring' });
    expect(census({ detected: 4, uncounted: 2 }).label).toBe(
      'Fixed & recurring expenses (2 bills found, not counted here)',
    );

    // (b) nothing to project FROM — a different fact with a different control.
    const noCash = census({ detected: 2, noCashAccount: 2 });
    expect(noCash.label).toBe('Fixed & recurring expenses (no checking or savings account linked)');
    expect(noCash.action).toEqual({ label: 'Link an account', href: '/accounts' });

    // (c) and (d) are CORRECT zeros, so neither offers a control: a link beside a
    // figure that is right reads as a correction (the L.29 rule).
    //
    // "All charged to a card" claims ANOTHER line holds the money, so it requires
    // that line to be acting: a non-zero card term with no card excluded from it.
    // Otherwise an undated or statement-pending card's bills sit in NO term and both
    // lines read $0.00 -- the false all-clear this thread exists to remove (copy
    // critic P1-2, executed).
    const cardHolds = { cardObligationsCents: 45000 };
    const censusOnCard = { detected: 2, counted: 0, onCard: 2, lapsed: 0, uncounted: 0, noCashAccount: 0 };
    const onCard = rowById(
      'fixed',
      planWith(cardHolds),
      disclosures({ creditCardCount: 1, fixedSeries: censusOnCard }),
    );
    expect(onCard.label).toBe('Fixed & recurring expenses (all charged to a card)');
    expect(onCard.action).toBeUndefined();
    // FAIL-OLD, every exclusion mechanism: the bills are on cards and nothing holds
    // them, so the reassuring sentence may not be printed.
    const excludedShapes: Partial<SpendingPlanDisclosures>[] = [
      { undatedCards: [{ cardName: 'Sapphire', frozenSince: null }] },
      { statementPendingCards: [{ cardName: 'Bonvoy', dueDate: '2026-07-28' }] },
      { creditCardsOutsideFigure: 1 },
    ];
    for (const excluded of excludedShapes) {
      const notHeld = rowById(
        'fixed',
        planWith(cardHolds),
        disclosures({ creditCardCount: 2, ...excluded, fixedSeries: censusOnCard }),
      );
      expect(notHeld.label).toBe('Fixed & recurring expenses (none counted)');
    }
    // ...and with no card term at all, the same rule.
    expect(
      rowById('fixed', planWith(), disclosures({ creditCardCount: 1, fixedSeries: censusOnCard })).label,
    ).toBe('Fixed & recurring expenses (none counted)');

    const lapsed = census({ detected: 2, lapsed: 2 });
    expect(lapsed.label).toBe('Fixed & recurring expenses (none still charging)');
    expect(lapsed.action).toBeUndefined();

    // (e) THERE IS NO "nothing was found" BRANCH, and this pins its absence.
    // `detected` counts STORED rows, and a series is stored only when its merchant
    // has a Merchant row -- which manual entry and CSV import never create. Both
    // critics executed a reader who had TYPED IN a monthly bill and was told none
    // was found, while /recurring listed it. An empty table is not an empty world.
    const empty = census({});
    expect(empty.label).toBe('Fixed & recurring expenses (none counted)');
    expect(empty.label).not.toMatch(/no repeating bills|none detected/i);

    // (f) THE FALLBACK, and the L.29 invariant that must survive: where the reason
    // is mixed or was never recorded, no good reason may be asserted. A mixture of
    // two correct absences gets no single mechanism named…
    expect(census({ detected: 2, onCard: 1, lapsed: 1 }).label).toBe(
      'Fixed & recurring expenses (none counted)',
    );
    // …and a row stored before this shipped (null reason: counted in `detected`
    // and in nothing else) may never be read as either a true or a broken zero.
    const unrecorded = census({ detected: 1 });
    expect(unrecorded.label).toBe('Fixed & recurring expenses (none counted)');
    expect(unrecorded.action).toEqual({ label: 'See your recurring bills', href: '/recurring' });

    // Series exist but round to nothing: "none counted" would be false while rows
    // are in the term, so the pattern label stays and no control is offered.
    const rounded = rowById('fixed', planWith({ scheduledFixed: [{ amountCents: -5, cadence: 'ANNUAL' }] }));
    expect(rounded.amountCents).toBe(0);
    expect(rounded.label).toBe('Fixed & recurring expenses (monthly pattern)');
    expect(rounded.action).toBeUndefined();
  });

  it('an UNDERSTATED non-zero fixed line is disclosed too — the case no label can reach (L.30)', () => {
    // The quiet half of the same defect: four bills counted, a fifth lost. The
    // label returns early on a non-zero figure, so without this sentence the
    // reader sees a confident number and no hint that it is short.
    const withBills = planWith({ scheduledFixed: [{ amountCents: -120000, cadence: 'MONTHLY' }] });
    const short = disclosures({
      fixedSeries: { detected: 5, counted: 4, onCard: 0, lapsed: 0, uncounted: 1, noCashAccount: 0 },
    });
    const trace = traceSafeToSpend(withBills, short);
    expect(trace.rows.find((r) => r.id === 'fixed')!.label).toBe(
      'Fixed & recurring expenses (monthly pattern)',
    );
    const note = trace.basis.find((b) => b.includes('not in the fixed-expenses line'));
    expect(note).toBe(
      'One repeating bill we found is not in the fixed-expenses line, so your real fixed costs are higher than shown and the real amount free to spend is smaller than shown by that much. Your recurring list shows every bill we found, including it.',
    );
    // No amount is named: the census counts series and never sums them, so a
    // dollar figure here would be one this panel cannot reconcile to its rows.
    expect(note).not.toMatch(/\$/);
    // Plural, and silent when there is nothing to disclose — a caller must never
    // be able to print an empty qualifier.
    expect(
      traceSafeToSpend(
        withBills,
        disclosures({ fixedSeries: { detected: 6, counted: 4, onCard: 0, lapsed: 0, uncounted: 2, noCashAccount: 0 } }),
      ).basis.some((b) => b.includes('2 repeating bills we found are not in the fixed-expenses line')),
    ).toBe(true);
    expect(traceSafeToSpend(withBills, NO_CARDS_OR_GOALS).basis.some((b) => b.includes('not in the fixed-expenses line'))).toBe(false);
  });

  it('the savings zero names the missing input and offers a control that EXISTS', () => {
    const nothingSet = rowById('savings');
    expect(nothingSet.label).toBe('Planned savings (no monthly amount set)');
    // The first cut split this by a goal count and sent the "goals contributing
    // nothing" reader to /goals to "set a monthly amount on a goal" — a control the
    // app does not have (goal-actions.ts creates and deletes; nothing updates one),
    // on the figure most likely to be too generous (L.29 critic P1-2).
    expect(nothingSet.action).toEqual({ label: 'Set a savings target', href: '/settings' });
    expect(JSON.stringify(traceSafeToSpend(planWith(), NO_CARDS_OR_GOALS).rows)).not.toContain('/goals');
  });

  it('a target set but yielding $0 names the target — not goals the reader does not have', () => {
    // No income pattern yet, so 20% of $0 is $0 and `savingsSource` resolves the
    // tie to 'goals'. Before L.29 this told a reader whose ONLY savings input is
    // a Settings target that his goals decided the line.
    const noIncomeYet = planWith({ trailingMonthlyIncomeCents: [], savingsTargetBps: 2000 });
    const row = rowById('savings', noIncomeYet, NO_CARDS_OR_GOALS);
    expect(row.amountCents).toBe(0);
    expect(row.label).toBe('Savings target (from Settings)');
    // It is set — so no control is offered for setting it.
    expect(row.action).toBeUndefined();
  });

  it('an income row of $0 says nothing ARRIVED, not that a median was taken of it', () => {
    // `incomeBasis` is 'trailing-median' whenever any complete month exists — three
    // months of zeros included — so a reader whose pay stopped, or who is paid in
    // cash the app never sees, read "Income (median of last 3 months) — $0.00"
    // (L.29 critic P2-5).
    const noPay = rowById('income', planWith({ trailingMonthlyIncomeCents: [0, 0, 0] }));
    expect(noPay.amountCents).toBe(0);
    expect(noPay.label).toBe('Income (none arrived in the last 3 months)');
    expect(rowById('income').label).toBe('Income (median of last 3 months)');
  });

  it('a basis sentence explaining a mechanism stays silent when the mechanism held nothing', () => {
    // The same rule this builder already states for a $0 ROW, applied to the
    // sentence beside it: with no bills, the rate arithmetic describes something
    // that never ran. Card paid-in-full copy is gone from guilt-free (owner 2026-08-01).
    const empty = traceSafeToSpend(planWith(), NO_CARDS_OR_GOALS).basis.join(' ');
    expect(empty).not.toContain('52/12');
    expect(empty).not.toContain('assumes each is paid in full');
    expect(empty).not.toContain('Card statement payments are not subtracted here');
    // …while the clause that is true for EVERY reader survives — without it, a $0
    // fixed line could be read as "nothing I spend is counted anywhere".
    expect(empty).toContain('Discretionary spending is never subtracted');

    const held = traceSafeToSpend(
      planWith({ scheduledFixed: [{ amountCents: -120000, cadence: 'MONTHLY' }] }),
      disclosures({ creditCardCount: 1 }),
    ).basis.join(' ');
    expect(held).toContain('a weekly bill counts 52/12 each month, a biweekly one 26/12');
    expect(held).not.toContain('assumes each is paid in full');
    expect(held).toContain('Card statement payments are not subtracted here');
  });

  it('the Ask answer prints the IDENTICAL three labels — one author, so they cannot drift again', () => {
    // FAIL-OLD: before L.29 these were two copies of four strings and had already
    // drifted ('Savings target (Settings)' in Ask against '(from Settings)' in the
    // panel) — the L.21 rule (fix the data class, not the reported surface).
    // Owner 2026-08-01: three standing lines only (income, fixed, savings).
    const fixtures: [ReturnType<typeof planWith>, ReturnType<typeof disclosures>][] = [
      [planWith(), NO_CARDS_OR_GOALS],
      [planWith(), disclosures({ creditCardCount: 3, cardsDatedAfterThisMonth: 1 })],
      [planWith({ trailingMonthlyIncomeCents: [], savingsTargetBps: 2000 }), NO_CARDS_OR_GOALS],
      [
        planWith({ trailingMonthlyIncomeCents: [0, 0, 0] }),
        disclosures({ creditCardCount: 1, creditCardsOutsideFigure: 1 }),
      ],
      [
        planWith({
          scheduledFixed: [{ amountCents: -120000, cadence: 'MONTHLY' }],
          cardObligationsCents: 45000,
          goalContributionsCents: 50000,
        }),
        disclosures({ creditCardCount: 1 }),
      ],
    ];
    for (const [plan, disc] of fixtures) {
      const panel = traceSafeToSpend(plan, disc).rows.map((r) => r.label);
      const ask = answerSafeToSpend(plan, disc).facts.map((f) => f.label);
      expect(panel).toHaveLength(3);
      expect(ask).toEqual(panel);
    }
  });

  it('estimated card obligations do not become a guilt-free fact or row', () => {
    // Card payments left the three-term identity; the label author still names
    // them for cash-needed / disclosure surfaces, but Ask and the trace do not.
    const est = planWith({ cardObligationsCents: 45000, cardObligationsEstimated: true });
    const disc = disclosures({ creditCardCount: 1 });
    const ask = answerSafeToSpend(est, disc);
    expect(ask.facts).toHaveLength(3);
    expect(ask.facts.map((f) => f.label).join(' ')).not.toMatch(/Card payments/i);
    expect(traceSafeToSpend(est, disc).rows.find((r) => r.id === 'card-payments')).toBeUndefined();
    expect(ask.detail).toContain('Card statement payments are not subtracted here');
    expect(planRowLabels(est, disc).cardPayments.label).toBe('Card payments due this month');
  });

  it('no working figure carries a control (a control beside a real number reads as a correction)', () => {
    const working = traceSafeToSpend(
      planWith({
        scheduledFixed: [{ amountCents: -120000, cadence: 'MONTHLY' }],
        cardObligationsCents: 45000,
        goalContributionsCents: 50000,
      }),
      disclosures({ creditCardCount: 1 }),
    );
    expect(working.rows).toHaveLength(3);
    expect(working.rows.map((r) => r.action).filter(Boolean)).toEqual([]);
    expect(working.reconciles).toBe(true);
  });
});
