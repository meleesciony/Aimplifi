/**
 * Cash-Needed Engine edge-case suite.
 * Every test asserts the HAND-COMPUTED expected values from docs/EDGE_CASES.md
 * §Cash-Needed. If code and doc disagree, resolve on paper — never edit the
 * expectation to match the code.
 */
import { describe, expect, it } from 'vitest';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import type { CardSnapshot, CashNeededInput } from '@/lib/engine/cash-needed/types';
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

describe('A — autopay card: included in cash, excluded from action', () => {
  const amex = card({
    id: 'amex',
    name: 'Amex',
    statement: statement(210000, '2026-06-15'),
    autopay: { mode: 'STATEMENT_BALANCE' },
  });
  const chase = card({ id: 'chase', name: 'Chase', statement: statement(271233, '2026-06-15') });
  const result = computeCashNeeded(input({ cards: [amex, chase] }));

  it('requires $4,812.33 by 2026-06-15', () => {
    expect(result.headline.requiredCents).toBe(481233);
    expect(result.headline.byDate).toBe('2026-06-15');
  });
  it('shortfall is $1,412.33; recommendation $1,450.00 by 2026-06-12 (Friday)', () => {
    expect(result.headline.shortfallCents).toBe(141233);
    expect(result.headline.recommendation).toEqual({ amountCents: 145000, byDate: '2026-06-12' });
  });
  it('Amex counted exactly once: single obligation point totaling both cards', () => {
    expect(result.perDueDate).toHaveLength(1);
    expect(result.perDueDate[0].dayTotalCents).toBe(481233);
    expect(result.perDueDate[0].cards).toHaveLength(2);
  });
  it('action list: Chase requires user action; Amex is autopay-covered with a funds-present note', () => {
    const amexOb = result.cards.find((c) => c.cardId === 'amex')!;
    const chaseOb = result.cards.find((c) => c.cardId === 'chase')!;
    expect(amexOb.userActionCents).toBe(0);
    expect(amexOb.autopayCents).toBe(210000);
    expect(amexOb.notes.join(' ')).toMatch(/autopay handles this payment.*funds.*present/i);
    expect(chaseOb.userActionCents).toBe(271233);
  });

  it('A2 — Amex autopay=MINIMUM ($35), scenario PAY_IN_FULL: total unchanged, Amex top-up $2,065.00', () => {
    const amexMin = card({
      id: 'amex',
      name: 'Amex',
      statement: statement(210000, '2026-06-15'),
      autopay: { mode: 'MINIMUM' },
    });
    const r = computeCashNeeded(input({ cards: [amexMin, chase] }));
    expect(r.headline.requiredCents).toBe(481233);
    const amexOb = r.cards.find((c) => c.cardId === 'amex')!;
    expect(amexOb.autopayCents).toBe(3500);
    expect(amexOb.userActionCents).toBe(206500); // $2,100 − $35
    expect(r.cards.find((c) => c.cardId === 'chase')!.userActionCents).toBe(271233);
  });

  it('A3 — Amex autopay=FIXED $500: autopay covers $500, user action $1,600, total cash unchanged', () => {
    const amexFixed = card({
      id: 'amex',
      name: 'Amex',
      statement: statement(210000, '2026-06-15'),
      autopay: { mode: 'FIXED_AMOUNT', fixedAmountCents: cents(50000) },
    });
    const r = computeCashNeeded(input({ cards: [amexFixed, chase] }));
    expect(r.headline.requiredCents).toBe(481233);
    const amexOb = r.cards.find((c) => c.cardId === 'amex')!;
    expect(amexOb.autopayCents).toBe(50000);
    expect(amexOb.userActionCents).toBe(160000);
  });
});

describe('B — mid-cycle manual payment reduces remaining due', () => {
  it('statement $1,000 with $400 paid → remaining due $600', () => {
    const c = card({
      id: 'freedom',
      name: 'Freedom',
      statement: statement(100000, '2026-06-28'),
      paymentsAppliedCents: cents(40000),
    });
    const r = computeCashNeeded(input({ cards: [c] }));
    expect(r.cards[0].remainingDueCents).toBe(60000);
    expect(r.headline.requiredCents).toBe(60000);
  });
  it('B2 — overpayment floors at $0 (never negative cash need)', () => {
    const c = card({
      id: 'x',
      name: 'X',
      statement: statement(50000, '2026-06-15'),
      paymentsAppliedCents: cents(60000),
    });
    const r = computeCashNeeded(input({ cards: [c] }));
    expect(r.cards[0].remainingDueCents).toBe(0);
    expect(r.headline.requiredCents).toBe(0);
    expect(r.headline.byDate).toBeNull();
  });
});

describe('C — statement not yet generated → labeled estimate', () => {
  const store = card({
    id: 'store',
    name: 'Store Card',
    currentBalanceCents: cents(123400),
    nextCycleCloseDate: d('2026-06-20'),
    nextDueDate: d('2026-07-15'),
  });
  const r = computeCashNeeded(input({ cards: [store] }));

  it('estimates due $1,234.00 from the current balance with isEstimated = true', () => {
    expect(r.cards[0].cashRequiredCents).toBe(123400);
    expect(r.cards[0].isEstimated).toBe(true);
    expect(r.headline.requiredCents).toBe(123400); // only card → estimate IS the answer
  });
  it('assumptions contain an "estimated from the current balance" string', () => {
    expect(r.assumptions.join(' ')).toMatch(/estimated from the current balance/i);
  });
  it('estimated next-cycle obligations are excluded from the headline when real statements exist', () => {
    const real = card({ id: 'real', name: 'Real', statement: statement(50000, '2026-06-15') });
    const r2 = computeCashNeeded(input({ cards: [store, real] }));
    expect(r2.headline.requiredCents).toBe(50000);
    expect(r2.upcoming).toHaveLength(1);
    expect(r2.upcoming[0].cardId).toBe('store');
    expect(r2.upcoming[0].isEstimated).toBe(true);
  });
});

describe('D — two cards due the same day aggregate into one obligation point', () => {
  it('single point on 06-15 totaling $2,000.00, listing both cards', () => {
    const c1 = card({ id: 'c1', name: 'Card1', statement: statement(123456, '2026-06-15') });
    const c2 = card({ id: 'c2', name: 'Card2', statement: statement(76544, '2026-06-15') });
    const r = computeCashNeeded(input({ cards: [c1, c2] }));
    expect(r.perDueDate).toHaveLength(1);
    expect(r.perDueDate[0].date).toBe('2026-06-15');
    expect(r.perDueDate[0].dayTotalCents).toBe(200000);
    expect(r.perDueDate[0].cards.map((c) => c.cardName).sort()).toEqual(['Card1', 'Card2']);
  });
});

describe('E — weekend/holiday due dates adjust to the prior business day', () => {
  it('E: Saturday 2026-06-13 → effective Friday 2026-06-12, with an assumption note', () => {
    const c = card({ id: 'c', name: 'C', statement: statement(10000, '2026-06-13') });
    const r = computeCashNeeded(input({ cards: [c] }));
    expect(r.cards[0].effectiveDueDate).toBe('2026-06-12');
    expect(r.assumptions.join(' ')).toMatch(/weekend.*prior business day/i);
  });
  it('E2: Saturday 2026-07-04 walks back over observed July 4th (Fri 07-03) to Thursday 2026-07-02', () => {
    const c = card({ id: 'c', name: 'C', statement: statement(10000, '2026-07-04') });
    const r = computeCashNeeded(input({ cards: [c] }));
    expect(r.cards[0].effectiveDueDate).toBe('2026-07-02');
  });
});

describe('F — refund/credit posting after statement close', () => {
  it('due remains $800.00 and an informational note mentions the $50.00 credit', () => {
    const c = card({
      id: 'sapphire',
      name: 'Sapphire',
      statement: statement(80000, '2026-06-15', 3500, '2026-06-01'),
      postCloseCreditCents: cents(5000),
    });
    const r = computeCashNeeded(input({ cards: [c] }));
    expect(r.cards[0].remainingDueCents).toBe(80000);
    expect(r.headline.requiredCents).toBe(80000);
    expect(r.cards[0].notes.join(' ')).toMatch(/\$50\.00 credit posted after statement close/i);
  });
});

describe('G — card with $0 due', () => {
  it('contributes $0, excluded from obligation points, still present in cards list', () => {
    const zero = card({ id: 'zero', name: 'Zero', statement: statement(0, '2026-06-15', 0) });
    const other = card({ id: 'other', name: 'Other', statement: statement(10000, '2026-06-15') });
    const r = computeCashNeeded(input({ cards: [zero, other] }));
    expect(r.headline.requiredCents).toBe(10000);
    expect(r.headline.cardsDueCount).toBe(1);
    expect(r.perDueDate[0].cards.map((c) => c.cardId)).toEqual(['other']);
    expect(r.cards.find((c) => c.cardId === 'zero')).toBeDefined();
    expect(r.cards.find((c) => c.cardId === 'zero')!.cashRequiredCents).toBe(0);
  });
});

describe('H — intra-period dip (the killer test)', () => {
  // Today 06-01, Checking $2,000. Rent −$1,800 on 06-03; payroll +$2,500 on 06-05.
  // Card1 $500 due 06-04; Card2 $2,000 due 06-10.
  // Walk: 06-01 $2,000 → 06-03 $200 → 06-04 −$300 → 06-05 $2,200 → 06-10 $200.
  const r = computeCashNeeded(
    input({
      today: d('2026-06-01'),
      paymentAccount: { name: 'Checking', balanceCents: cents(200000), pending: [], frozenSince: null },
      cards: [
        card({ id: 'c1', name: 'Card1', statement: statement(50000, '2026-06-04') }),
        card({ id: 'c2', name: 'Card2', statement: statement(200000, '2026-06-10') }),
      ],
      scheduled: [
        { date: d('2026-06-03'), amountCents: cents(-180000), description: 'Rent' },
        { date: d('2026-06-05'), amountCents: cents(250000), description: 'Payroll' },
      ],
    }),
  );

  it('the endpoint (06-10) is fine but the engine flags the 06-04 dip', () => {
    const last = r.perDueDate[r.perDueDate.length - 1];
    expect(last.date).toBe('2026-06-10');
    expect(last.projectedBalanceAfterCents).toBe(20000); // $200, recovers
    expect(r.headline.shortfallCents).toBe(30000); // $300
    expect(r.headline.shortfallDate).toBe('2026-06-04');
  });
  it('intraPeriodMinimum = (2026-06-04, −$300.00)', () => {
    expect(r.intraPeriodMinimum).toEqual({ date: '2026-06-04', balanceCents: -30000 });
  });
  it('transfer recommendation: $300.00 by 2026-06-03', () => {
    expect(r.headline.recommendation).toEqual({ amountCents: 30000, byDate: '2026-06-03' });
  });
  it('total required across the cycle is $2,500 by 2026-06-10', () => {
    expect(r.headline.requiredCents).toBe(250000);
    expect(r.headline.byDate).toBe('2026-06-10');
  });
});

describe('I — minimum-payment path interest (average-daily-balance method)', () => {
  it('statement $3,000, min $35, APR 24.00%, cycle 05-18→06-18 (31d), due 06-15 → interest $61.08', () => {
    // ADB hand math: full $3,000 for 28 days (close 05-18 → due 06-15), then the
    // carried $2,965 for 3 days (→ next close 06-18). Σ daily balances =
    // 300000·28 + 296500·3 = 9,289,500; × 2400/10000/365 = 2,229,480/365 = 6108.16 → 6108.
    const c = card({
      id: 'c',
      name: 'C',
      aprBps: 2400,
      statement: statement(300000, '2026-06-15'),
    });
    const r = computeCashNeeded(input({ cards: [c], scenario: 'MINIMUM' }));
    expect(r.minimumPathInterestCents).toBe(6108);
    expect(r.headline.requiredCents).toBe(3500); // minimum scenario needs only the min
  });
  it('labels the interest as the average-daily-balance method in assumptions', () => {
    const c = card({ id: 'c', name: 'C', statement: statement(300000, '2026-06-15') });
    const r = computeCashNeeded(input({ cards: [c], scenario: 'MINIMUM' }));
    expect(r.assumptions.join(' ')).toMatch(/average-daily-balance/i);
  });
  it('autopay STATEMENT_BALANCE card carries nothing on the minimum path', () => {
    const auto = card({
      id: 'a',
      name: 'A',
      aprBps: 2400,
      statement: statement(300000, '2026-06-15'),
      autopay: { mode: 'STATEMENT_BALANCE' },
    });
    const r = computeCashNeeded(input({ cards: [auto], scenario: 'MINIMUM' }));
    expect(r.minimumPathInterestCents).toBe(0);
    // autopay pulls the full statement even in the MINIMUM scenario — cash must be present
    expect(r.headline.requiredCents).toBe(300000);
  });
});

describe('J — pending transactions affect the projection exactly once', () => {
  it('checking $1,000 with pending −$250 → projection starts from $750', () => {
    const c = card({ id: 'c', name: 'C', statement: statement(80000, '2026-06-15') });
    const r = computeCashNeeded(
      input({
        paymentAccount: {
          name: 'Checking',
          balanceCents: cents(100000),
          pending: [{ amountCents: cents(-25000), description: 'Pending card payment' }],
          frozenSince: null,
        },
        cards: [c],
      }),
    );
    // start 750 → 06-15 pay 800 → −50: shortfall $50 proves the pending applied once
    expect(r.headline.shortfallCents).toBe(5000);
    expect(r.assumptions.join(' ')).toMatch(/pending transaction.*applied.*once/i);
  });
});

describe('cross-cutting invariants', () => {
  it('no cards → empty result with zero need', () => {
    const r = computeCashNeeded(input({}));
    expect(r.headline.requiredCents).toBe(0);
    expect(r.headline.byDate).toBeNull();
    expect(r.perDueDate).toEqual([]);
    expect(r.headline.recommendation).toBeNull();
  });
  it('an overdue statement is treated as due today, never in the past', () => {
    const c = card({ id: 'c', name: 'C', statement: statement(10000, '2026-06-01') });
    const r = computeCashNeeded(input({ today: d('2026-06-10'), cards: [c] }));
    expect(r.cards[0].effectiveDueDate).toBe('2026-06-10');
    expect(r.cards[0].notes.join(' ')).toMatch(/due date has passed/i);
  });
  it('cumulative need accumulates across due dates in order', () => {
    const c1 = card({ id: 'c1', name: 'C1', statement: statement(10000, '2026-06-15') });
    const c2 = card({ id: 'c2', name: 'C2', statement: statement(20000, '2026-06-26') });
    const r = computeCashNeeded(input({ cards: [c1, c2] }));
    expect(r.perDueDate.map((p) => p.cumulativeNeedCents)).toEqual([10000, 30000]);
  });
});
