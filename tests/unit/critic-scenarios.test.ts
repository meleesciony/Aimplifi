/**
 * Adversarial scenarios from the Phase 1 Hostile Critic review (2026-06-12),
 * kept as permanent regressions. Each expected value was computed BY HAND
 * first (arithmetic in comments), then run against the engine. Probes S3/S9
 * and S4 caught findings P1-1 (recommendation dated in the past) and P1-2
 * (assembler dropped delinquent statements) — both fixed in critic cycle 2.
 */
import { describe, expect, it } from 'vitest';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import { assembleCashNeededInput } from '@/lib/engine/cash-needed/assemble';
import type { CardSnapshot, CashNeededInput } from '@/lib/engine/cash-needed/types';
import { cents } from '@/lib/money';
import { holidayTable, isoDate } from '@/lib/dates';

const d = isoDate;
const HOLIDAYS = holidayTable(2025, 2033);

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
    paymentAccount: { name: 'Checking', balanceCents: cents(340000), pending: [] },
    cards: [],
    scheduled: [],
    scenario: 'PAY_IN_FULL',
    holidayTable: HOLIDAYS,
    ...over,
  };
}

describe('S1 — autopay scheduled but payment account insufficient on the autopay date', () => {
  // Hand: checking $1,000. Autopay STATEMENT_BALANCE $2,100 due Mon 06-15.
  // 06-15: 1,000 − 2,100 = −1,100 → shortfall $1,100 on 06-15.
  // Rec: roundUp50(1,100) = 1,100 (exact multiple) by prev business day of 06-15 = Fri 06-12.
  it('flags the shortfall even though no user action is required', () => {
    const auto = card({
      id: 'a',
      name: 'Auto',
      statement: statement(210000, '2026-06-15'),
      autopay: { mode: 'STATEMENT_BALANCE' },
    });
    const r = computeCashNeeded(
      input({ paymentAccount: { name: 'Checking', balanceCents: cents(100000), pending: [] }, cards: [auto] }),
    );
    expect(r.headline.requiredCents).toBe(210000);
    expect(r.cards[0].userActionCents).toBe(0);
    expect(r.headline.shortfallCents).toBe(110000);
    expect(r.headline.shortfallDate).toBe('2026-06-15');
    expect(r.headline.recommendation).toEqual({ amountCents: 110000, byDate: '2026-06-12' });
  });
});

describe('S2 — card payment in transit at asOf', () => {
  // Variant 1 (recorded both sides): CardPayment $400 applied, checking debit still PENDING −$400.
  // Hand: start = 2,000 − 400 = 1,600; remaining due = 1,000 − 400 = 600.
  // 06-15: 1,600 − 600 = 1,000 → no shortfall. Required $600.
  it('payment recorded + pending debit: counted once on each side, no double count', () => {
    const c = card({
      id: 'c',
      name: 'C',
      statement: statement(100000, '2026-06-15'),
      paymentsAppliedCents: cents(40000),
    });
    const r = computeCashNeeded(
      input({
        paymentAccount: {
          name: 'Checking',
          balanceCents: cents(200000),
          pending: [{ amountCents: cents(-40000), description: 'EPAY in transit' }],
        },
        cards: [c],
      }),
    );
    expect(r.headline.requiredCents).toBe(60000);
    expect(r.headline.shortfallCents).toBe(0);
  });

  // Variant 2 (recorded NOWHERE — true in-transit): engine cannot know; it must
  // be conservative: full $1,000 required from a balance that still holds the money.
  // Hand: 06-15: 2,000 − 1,000 = 1,000 → no shortfall, required $1,000 (over-asks by
  // the in-flight $400 — conservative, documented behavior, not a math error).
  it('payment visible nowhere: conservative full requirement (documented)', () => {
    const c = card({ id: 'c', name: 'C', statement: statement(100000, '2026-06-15') });
    const r = computeCashNeeded(
      input({ paymentAccount: { name: 'Checking', balanceCents: cents(200000), pending: [] }, cards: [c] }),
    );
    expect(r.headline.requiredCents).toBe(100000);
    expect(r.headline.shortfallCents).toBe(0);
  });
});

describe('S3 — statement due date earlier than cycle close (data error) and already past', () => {
  // Statement: cycleEnd 06-20 but dueDate 06-05 (data error), unpaid, today 06-10.
  // Hand: engine clamps to "due today" (06-10). Checking $0 → shortfall $500 on 06-10.
  // Recommendation: prev business day of 06-10 (Wed) = 06-09 — WHICH IS IN THE PAST.
  // The sensible answer is "transfer TODAY"; a by-date before `today` is wrong.
  it('treats it as due today', () => {
    const c = card({ id: 'c', name: 'C', statement: statement(50000, '2026-06-05', 3500, '2026-06-20') });
    const r = computeCashNeeded(
      input({ paymentAccount: { name: 'Checking', balanceCents: cents(0), pending: [] }, cards: [c] }),
    );
    expect(r.cards[0].effectiveDueDate).toBe('2026-06-10');
    expect(r.headline.shortfallCents).toBe(50000);
    expect(r.headline.shortfallDate).toBe('2026-06-10');
  });
  it('FINDING PROBE: recommendation byDate must not be before today', () => {
    const c = card({ id: 'c', name: 'C', statement: statement(50000, '2026-06-05', 3500, '2026-06-20') });
    const r = computeCashNeeded(
      input({ paymentAccount: { name: 'Checking', balanceCents: cents(0), pending: [] }, cards: [c] }),
    );
    // Hand-computed CORRECT answer: transfer TODAY (2026-06-10), never a past date.
    expect(r.headline.recommendation).not.toBeNull();
    expect(r.headline.recommendation!.byDate).toBe('2026-06-10');
  });
});

describe('S4 — missed (past-due, unpaid) statement goes through the ASSEMBLER', () => {
  // Card A: generated statement $800 due 06-08, NEVER PAID (delinquent). Today 06-10.
  // Card B: statement $500 due 06-15.
  // Hand (truth): user owes 800 NOW + 500 by 06-15 → headline must include $1,300,
  // with the past-due card due today.
  // Assembler rule: "current = most recent statement with dueDate >= today" drops
  // card A's real unpaid statement and substitutes a next-cycle ESTIMATE, which is
  // then excluded from the headline because card B has a real statement.
  it('FINDING PROBE: a delinquent statement must not vanish from the headline', () => {
    const params = {
      today: d('2026-06-10'),
      scenario: 'PAY_IN_FULL' as const,
      paymentAccountId: 'chk',
      accounts: [
        { id: 'chk', name: 'Checking', type: 'CHECKING', currentBalanceCents: 300000, aprBps: null, dueDayOfMonth: null, cycleCloseDayOfMonth: null },
        { id: 'cardA', name: 'Card A', type: 'CREDIT', currentBalanceCents: 80000, aprBps: 2400, dueDayOfMonth: 8, cycleCloseDayOfMonth: 11 },
        { id: 'cardB', name: 'Card B', type: 'CREDIT', currentBalanceCents: 50000, aprBps: 2400, dueDayOfMonth: 15, cycleCloseDayOfMonth: 18 },
      ],
      autopays: [],
      statements: [
        { id: 'sA', accountId: 'cardA', cycleEnd: '2026-05-11', dueDate: '2026-06-08', statementBalanceCents: 80000, minimumPaymentCents: 3500 },
        { id: 'sB', accountId: 'cardB', cycleEnd: '2026-05-18', dueDate: '2026-06-15', statementBalanceCents: 50000, minimumPaymentCents: 3500 },
      ],
      cardPayments: [],
      transactions: [],
      scheduled: [],
      holidayTable: HOLIDAYS,
    };
    const r = computeCashNeeded(assembleCashNeededInput(params));
    // Hand-computed truth: required = 800 (past due, NOW) + 500 (06-15) = $1,300.
    // If this fails, the assembler silently dropped a delinquent obligation.
    expect(r.headline.requiredCents).toBe(130000);
  });
});

describe('S5 — leap-day cycle', () => {
  // 2028-02-29 is a Tuesday (hand: Jan 1 2028 = Sat; day-of-year 60 → Sat+3 = Tue).
  it('due on Feb 29 2028 (business day) stays Feb 29', () => {
    const c = card({ id: 'c', name: 'C', statement: statement(100000, '2028-02-29', 3500, '2028-02-01') });
    const r = computeCashNeeded(input({ today: d('2028-02-10'), cards: [c] }));
    expect(r.cards[0].effectiveDueDate).toBe('2028-02-29');
    expect(r.headline.byDate).toBe('2028-02-29');
  });
  // 2032-02-29 is a Sunday (hand: Jan 1 2032 = Thu; +59 → Thu+3 = Sun) → walk back to Fri 02-27.
  it('due on Feb 29 2032 (Sunday) walks back to Friday Feb 27', () => {
    const c = card({ id: 'c', name: 'C', statement: statement(100000, '2032-02-29', 3500, '2032-02-01') });
    const r = computeCashNeeded(input({ today: d('2032-02-10'), cards: [c] }));
    expect(r.cards[0].effectiveDueDate).toBe('2032-02-27');
  });
});

describe('S6 — pending REFUND (positive pending) on the payment account', () => {
  // Hand: checking 1,000 + pending +250 = 1,250 start; card 1,100 due 06-15 →
  // 1,250 − 1,100 = 150 → no shortfall.
  it('raises the effective start balance once', () => {
    const c = card({ id: 'c', name: 'C', statement: statement(110000, '2026-06-15') });
    const r = computeCashNeeded(
      input({
        paymentAccount: {
          name: 'Checking',
          balanceCents: cents(100000),
          pending: [{ amountCents: cents(25000), description: 'Pending refund' }],
        },
        cards: [c],
      }),
    );
    expect(r.headline.shortfallCents).toBe(0);
    expect(r.headline.requiredCents).toBe(110000);
  });
});

describe('S7 — two scheduled items land ON a due date', () => {
  // Hand: checking $100. 06-15: payroll +1,200 and rent −200 post FIRST (documented
  // rule) → 100 + 1,200 − 200 = 1,100; then card draw 1,000 → 100. No shortfall.
  it('aggregates same-day flows before the card draw', () => {
    const c = card({ id: 'c', name: 'C', statement: statement(100000, '2026-06-15') });
    const r = computeCashNeeded(
      input({
        paymentAccount: { name: 'Checking', balanceCents: cents(10000), pending: [] },
        cards: [c],
        scheduled: [
          { date: d('2026-06-15'), amountCents: cents(120000), description: 'Payroll' },
          { date: d('2026-06-15'), amountCents: cents(-20000), description: 'Rent' },
        ],
      }),
    );
    expect(r.headline.shortfallCents).toBe(0);
    expect(r.perDueDate[0].projectedBalanceAfterCents).toBe(10000);
  });
});

describe('S8 — MINIMUM scenario, mid-cycle payment exceeds the minimum but not the statement', () => {
  // Hand: statement 1,000, min 35, paid 400 → minimum already satisfied → required $0.
  // Carried into next cycle = 1,000 − 400 = 600 → interest = 600 × 24% / 12 = $12.00.
  it('requires nothing more and prices the carried $600 at $12.00', () => {
    const c = card({
      id: 'c',
      name: 'C',
      aprBps: 2400,
      statement: statement(100000, '2026-06-28'),
      paymentsAppliedCents: cents(40000),
    });
    const r = computeCashNeeded(input({ cards: [c], scenario: 'MINIMUM' }));
    expect(r.headline.requiredCents).toBe(0);
    expect(r.cards[0].minimumDueCents).toBe(0);
    expect(r.minimumPathInterestCents).toBe(1200);
  });
});

describe('S9 — card due TODAY with a shortfall: recommendation date sanity', () => {
  // Hand: due today 06-10 (Wed), checking 0, owe 500 → must transfer TODAY.
  // previousBusinessDay(06-10) = 06-09 = YESTERDAY → engine output would be useless.
  it('FINDING PROBE: never recommend a transfer dated in the past', () => {
    const c = card({ id: 'c', name: 'C', statement: statement(50000, '2026-06-10') });
    const r = computeCashNeeded(
      input({ paymentAccount: { name: 'Checking', balanceCents: cents(0), pending: [] }, cards: [c] }),
    );
    expect(r.headline.recommendation).not.toBeNull();
    expect(r.headline.recommendation!.byDate >= '2026-06-10').toBe(true);
  });
});
