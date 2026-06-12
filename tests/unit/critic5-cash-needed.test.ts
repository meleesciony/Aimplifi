/**
 * HOSTILE CRITIC — Phase 5 (final) probes, Cash-Needed engine.
 *
 * Part 1: re-verification of EDGE_CASES §Cash-Needed anchors (A/A2/A3, B2, E2,
 *         H, I) plus the full §Seed-headline arithmetic re-derived through the
 *         PURE engine (independent of the seed/assemble path).
 * Part 2: SIX brand-new adversarial scenarios (N1–N6) never tried before.
 *
 * Every expected value below was hand-computed on paper BEFORE running the
 * engine (working shown in comments). Do not edit expectations to match code.
 */
import { describe, expect, it } from 'vitest';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import type { CardSnapshot, CashNeededInput } from '@/lib/engine/cash-needed/types';
import { cents, type Cents } from '@/lib/money';
import { holidayTable, isoDate } from '@/lib/dates';

const HOLIDAYS_2026 = holidayTable(2026, 2026);
const d = isoDate;
const c = (n: number): Cents => cents(n);

function card(over: Partial<CardSnapshot> & { id: string; name: string }): CardSnapshot {
  return {
    aprBps: 2400,
    autopay: null,
    statement: null,
    currentBalanceCents: c(0),
    paymentsAppliedCents: c(0),
    ...over,
  };
}

function input(over: Partial<CashNeededInput>): CashNeededInput {
  return {
    today: d('2026-06-10'),
    paymentAccount: { name: 'Checking', balanceCents: c(0), pending: [] },
    cards: [],
    scheduled: [],
    scenario: 'PAY_IN_FULL',
    holidayTable: HOLIDAYS_2026,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 1 — EDGE_CASES anchors re-verified by hand
// ─────────────────────────────────────────────────────────────────────────────

describe('critic5: EDGE_CASES §A — autopay in cash, out of action', () => {
  const amex = card({
    id: 'amex', name: 'Amex',
    statement: { statementBalanceCents: c(210000), minimumPaymentCents: c(3500), dueDate: d('2026-06-15'), cycleEnd: d('2026-05-21') },
    autopay: { mode: 'STATEMENT_BALANCE' },
  });
  const chase = card({
    id: 'chase', name: 'Chase',
    statement: { statementBalanceCents: c(271233), minimumPaymentCents: c(3500), dueDate: d('2026-06-15'), cycleEnd: d('2026-05-18') },
  });

  it('A: required $4,812.33; shortfall $1,412.33; rec $1,450.00 by Fri 06-12; Amex action $0', () => {
    // Hand: 3400.00 − 4812.33 = −1412.33 on 06-15; ceil(141233/5000)=29 → 145000;
    // prev business day of Mon 06-15 = Fri 06-12.
    const r = computeCashNeeded(input({
      paymentAccount: { name: 'Checking', balanceCents: c(340000), pending: [] },
      cards: [amex, chase],
    }));
    expect(r.headline.requiredCents).toBe(481233);
    expect(r.headline.byDate).toBe('2026-06-15');
    expect(r.headline.shortfallCents).toBe(141233);
    expect(r.headline.shortfallDate).toBe('2026-06-15');
    expect(r.headline.recommendation).toEqual({ amountCents: 145000, byDate: '2026-06-12' });
    const amexOb = r.cards.find((o) => o.cardId === 'amex')!;
    expect(amexOb.userActionCents).toBe(0); // autopay handles it
    expect(amexOb.cashRequiredCents).toBe(210000); // but cash must be present — counted once
    const chaseOb = r.cards.find((o) => o.cardId === 'chase')!;
    expect(chaseOb.userActionCents).toBe(271233);
  });

  it('A2: autopay MINIMUM under PAY_IN_FULL → Amex top-up $2,065.00, total unchanged', () => {
    // Hand: scenario target 2100.00, autopay pulls min 35.00 → user acts on 2065.00.
    const amexMin = { ...amex, autopay: { mode: 'MINIMUM' as const } };
    const r = computeCashNeeded(input({
      paymentAccount: { name: 'Checking', balanceCents: c(340000), pending: [] },
      cards: [amexMin, chase],
    }));
    expect(r.headline.requiredCents).toBe(481233); // unchanged
    const amexOb = r.cards.find((o) => o.cardId === 'amex')!;
    expect(amexOb.autopayCents).toBe(3500);
    expect(amexOb.userActionCents).toBe(206500);
  });

  it('A3: autopay FIXED $500 → autopay 500, user action $1,600, cash unchanged', () => {
    const amexFixed = { ...amex, autopay: { mode: 'FIXED_AMOUNT' as const, fixedAmountCents: c(50000) } };
    const r = computeCashNeeded(input({
      paymentAccount: { name: 'Checking', balanceCents: c(340000), pending: [] },
      cards: [amexFixed, chase],
    }));
    expect(r.headline.requiredCents).toBe(481233);
    const amexOb = r.cards.find((o) => o.cardId === 'amex')!;
    expect(amexOb.autopayCents).toBe(50000);
    expect(amexOb.userActionCents).toBe(160000);
  });
});

describe('critic5: EDGE_CASES §B2 — overpayment floors at $0', () => {
  it('statement $500, payments $600 → remaining $0, excluded from headline', () => {
    const r = computeCashNeeded(input({
      paymentAccount: { name: 'Checking', balanceCents: c(100000), pending: [] },
      cards: [card({
        id: 'x', name: 'X',
        statement: { statementBalanceCents: c(50000), minimumPaymentCents: c(3500), dueDate: d('2026-06-15'), cycleEnd: d('2026-06-01') },
        paymentsAppliedCents: c(60000),
      })],
    }));
    expect(r.headline.requiredCents).toBe(0);
    expect(r.headline.cardsDueCount).toBe(0);
    expect(r.cards[0].remainingDueCents).toBe(0); // never negative
  });
});

describe('critic5: EDGE_CASES §E2 — Sat due + observed July 4th', () => {
  it('due Sat 2026-07-04 → Fri 07-03 is the observed holiday → effective Thu 2026-07-02', () => {
    const r = computeCashNeeded(input({
      today: d('2026-07-01'),
      paymentAccount: { name: 'Checking', balanceCents: c(100000), pending: [] },
      cards: [card({
        id: 'x', name: 'X',
        statement: { statementBalanceCents: c(10000), minimumPaymentCents: c(3500), dueDate: d('2026-07-04'), cycleEnd: d('2026-06-10') },
      })],
    }));
    expect(r.cards[0].effectiveDueDate).toBe('2026-07-02');
  });
});

describe('critic5: EDGE_CASES §H — the intra-period dip (re-verified)', () => {
  it('endpoint fine but −$300 on 06-04; rec $300 by 06-03', () => {
    // Hand walk: 06-01 2000 → 06-03 rent 200 → 06-04 −300 → 06-05 +2500 → 2200 → 06-10 200.
    const r = computeCashNeeded(input({
      today: d('2026-06-01'),
      paymentAccount: { name: 'Checking', balanceCents: c(200000), pending: [] },
      scheduled: [
        { date: d('2026-06-03'), amountCents: c(-180000), description: 'Rent' },
        { date: d('2026-06-05'), amountCents: c(250000), description: 'Payroll' },
      ],
      cards: [
        card({ id: 'c1', name: 'Card1', statement: { statementBalanceCents: c(50000), minimumPaymentCents: c(3500), dueDate: d('2026-06-04'), cycleEnd: d('2026-05-10') } }),
        card({ id: 'c2', name: 'Card2', statement: { statementBalanceCents: c(200000), minimumPaymentCents: c(3500), dueDate: d('2026-06-10'), cycleEnd: d('2026-05-16') } }),
      ],
    }));
    expect(r.headline.requiredCents).toBe(250000);
    expect(r.headline.byDate).toBe('2026-06-10');
    expect(r.headline.shortfallCents).toBe(30000);
    expect(r.headline.shortfallDate).toBe('2026-06-04');
    expect(r.intraPeriodMinimum).toEqual({ date: '2026-06-04', balanceCents: -30000 });
    expect(r.headline.recommendation).toEqual({ amountCents: 30000, byDate: '2026-06-03' });
  });
});

describe('critic5: EDGE_CASES §I — minimum-path interest v1 formula', () => {
  it('$3,000 stmt, $35 min, 24.00% APR → carried $2,965 → $59.30', () => {
    // Hand: 296500 × 2400 / 10000 / 12 = 296500 × 0.02 = 5930.
    const r = computeCashNeeded(input({
      scenario: 'MINIMUM',
      paymentAccount: { name: 'Checking', balanceCents: c(500000), pending: [] },
      cards: [card({
        id: 'x', name: 'X', aprBps: 2400,
        statement: { statementBalanceCents: c(300000), minimumPaymentCents: c(3500), dueDate: d('2026-06-15'), cycleEnd: d('2026-06-01') },
      })],
    }));
    expect(r.minimumPathInterestCents).toBe(5930);
  });
});

describe('critic5: §Seed-headline re-derived through the PURE engine', () => {
  const seedCards: CardSnapshot[] = [
    card({
      id: 'sapphire', name: 'Sapphire', aprBps: 2499,
      statement: { statementBalanceCents: c(271233), minimumPaymentCents: c(3500), dueDate: d('2026-06-15'), cycleEnd: d('2026-05-18') },
      postCloseCreditCents: c(5000),
    }),
    card({
      id: 'platinum', name: 'Platinum', aprBps: 2924,
      statement: { statementBalanceCents: c(210000), minimumPaymentCents: c(3500), dueDate: d('2026-06-15'), cycleEnd: d('2026-05-21') },
      autopay: { mode: 'STATEMENT_BALANCE' },
    }),
    card({
      id: 'freedom', name: 'Freedom', aprBps: 1999,
      statement: { statementBalanceCents: c(100000), minimumPaymentCents: c(3500), dueDate: d('2026-06-28'), cycleEnd: d('2026-06-01') },
      paymentsAppliedCents: c(40000),
    }),
    card({
      id: 'store', name: 'Store Card', aprBps: 2999,
      currentBalanceCents: c(4350), nextCycleCloseDate: d('2026-06-20'), nextDueDate: d('2026-07-15'),
    }),
  ];
  const seedInput = (scenario: 'PAY_IN_FULL' | 'MINIMUM') => input({
    scenario,
    paymentAccount: { name: 'Everyday Checking', balanceCents: c(340000), pending: [{ amountCents: c(-25000), description: 'pending' }] },
    cards: seedCards,
    scheduled: [
      { date: d('2026-06-12'), amountCents: c(245000), description: 'Payroll' },
      { date: d('2026-06-24'), amountCents: c(-180000), description: 'Rent' },
      { date: d('2026-06-26'), amountCents: c(245000), description: 'Payroll' },
    ],
  });

  it('PAY_IN_FULL: $5,412.33 / 3 cards / by 06-26 / dip −$1,012.33 on 06-24 / rec $1,050 by 06-23', () => {
    // Hand walk: 3150.00 → 06-12 5600.00 → 06-15 787.67 → 06-24 −1012.33 → 06-26 +2450−600 = 837.67.
    const r = computeCashNeeded(seedInput('PAY_IN_FULL'));
    expect(r.headline.requiredCents).toBe(541233);
    expect(r.headline.cardsDueCount).toBe(3);
    expect(r.headline.byDate).toBe('2026-06-26'); // Freedom Sun 06-28 → Fri 06-26
    expect(r.headline.shortfallCents).toBe(101233);
    expect(r.headline.shortfallDate).toBe('2026-06-24');
    expect(r.intraPeriodMinimum).toEqual({ date: '2026-06-24', balanceCents: -101233 });
    expect(r.headline.recommendation).toEqual({ amountCents: 105000, byDate: '2026-06-23' });
    // perDueDate table
    expect(r.perDueDate).toHaveLength(2);
    expect(r.perDueDate[0]).toMatchObject({ date: '2026-06-15', dayTotalCents: 481233, cumulativeNeedCents: 481233, projectedBalanceAfterCents: 78767 });
    expect(r.perDueDate[1]).toMatchObject({ date: '2026-06-26', dayTotalCents: 60000, cumulativeNeedCents: 541233, projectedBalanceAfterCents: 83767 });
    // upcoming: Store Card estimate, NOT in the headline
    expect(r.upcoming).toHaveLength(1);
    expect(r.upcoming[0]).toMatchObject({ cardId: 'store', isEstimated: true, cashRequiredCents: 4350 });
  });

  it('MINIMUM: $2,135.00 by 06-15, no shortfall, interest $65.76', () => {
    // Hand: 35 + 2100 (autopay full) + 0 (Freedom min satisfied) = 2135.00 due 06-15.
    // Interest: Sapphire 267733×2499/120000 = 5575.54 → 5576; Platinum 0; Freedom 60000×1999/120000 = 999.5 → 1000.
    const r = computeCashNeeded(seedInput('MINIMUM'));
    expect(r.headline.requiredCents).toBe(213500);
    expect(r.headline.byDate).toBe('2026-06-15');
    expect(r.headline.shortfallCents).toBe(0);
    expect(r.headline.recommendation).toBeNull();
    expect(r.minimumPathInterestCents).toBe(6576);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 2 — SIX brand-new adversarial scenarios (never probed before)
// ─────────────────────────────────────────────────────────────────────────────

describe('critic5 N1: autopay FIXED_AMOUNT larger than the remaining due', () => {
  it('fixed $1,500 vs $400 remaining → engine demands only $400, action $0', () => {
    // Hand: remaining = 1000 − 600 = 400; autopay = min(1500, 400) = 400;
    // cashRequired = max(400, 400) = 400 — the engine must NOT demand $1,500.
    // (v1 semantic: issuer pull capped at remaining due — see findings re:
    // issuers that pull the full fixed amount.)
    const r = computeCashNeeded(input({
      paymentAccount: { name: 'Checking', balanceCents: c(100000), pending: [] },
      cards: [card({
        id: 'x', name: 'X',
        statement: { statementBalanceCents: c(100000), minimumPaymentCents: c(3500), dueDate: d('2026-06-15'), cycleEnd: d('2026-06-01') },
        paymentsAppliedCents: c(60000),
        autopay: { mode: 'FIXED_AMOUNT', fixedAmountCents: c(150000) },
      })],
    }));
    expect(r.headline.requiredCents).toBe(40000);
    expect(r.cards[0].autopayCents).toBe(40000);
    expect(r.cards[0].userActionCents).toBe(0);
    expect(r.headline.shortfallCents).toBe(0); // 1000.00 ≥ 400.00
  });
});

describe('critic5 N2: weekend walk-back lands two cards on the SAME effective day', () => {
  it('A due Fri 06-12, B due Sat 06-13 → one ObligationPoint on 06-12 totaling both', () => {
    // Hand: B effective = Fri 06-12. Day total 700+500 = 1200; balance 1000 − 1200 = −200;
    // rec = roundUp50(200) = 200 by prev business day of Fri 06-12 = Thu 06-11.
    const r = computeCashNeeded(input({
      paymentAccount: { name: 'Checking', balanceCents: c(100000), pending: [] },
      cards: [
        card({ id: 'a', name: 'A', statement: { statementBalanceCents: c(70000), minimumPaymentCents: c(3500), dueDate: d('2026-06-12'), cycleEnd: d('2026-05-20') } }),
        card({ id: 'b', name: 'B', statement: { statementBalanceCents: c(50000), minimumPaymentCents: c(3500), dueDate: d('2026-06-13'), cycleEnd: d('2026-05-20') } }),
      ],
    }));
    expect(r.headline.byDate).toBe('2026-06-12');
    expect(r.perDueDate).toHaveLength(1); // merged onto one day
    expect(r.perDueDate[0].dayTotalCents).toBe(120000);
    expect(r.perDueDate[0].cards.map((x) => x.cardId).sort()).toEqual(['a', 'b']);
    expect(r.headline.shortfallCents).toBe(20000);
    expect(r.headline.shortfallDate).toBe('2026-06-12');
    expect(r.headline.recommendation).toEqual({ amountCents: 20000, byDate: '2026-06-11' });
  });
});

describe('critic5 N3: scheduled inflow lands ON the recommendation byDate itself', () => {
  it('inflow on 06-12 is counted once; rec is the residual gap, dated 06-12', () => {
    // Hand: 100.00 → 06-12 +500.00 = 600.00 → 06-15 −1000.00 = −400.00.
    // Shortfall 400.00 on 06-15; rec = 400 (already a $50 multiple) by Fri 06-12 —
    // the same day as the inflow. Must be 400, NOT 900 (inflow not ignored).
    const r = computeCashNeeded(input({
      paymentAccount: { name: 'Checking', balanceCents: c(10000), pending: [] },
      scheduled: [{ date: d('2026-06-12'), amountCents: c(50000), description: 'Payroll' }],
      cards: [card({ id: 'x', name: 'X', statement: { statementBalanceCents: c(100000), minimumPaymentCents: c(3500), dueDate: d('2026-06-15'), cycleEnd: d('2026-06-01') } })],
    }));
    expect(r.headline.shortfallCents).toBe(40000);
    expect(r.headline.shortfallDate).toBe('2026-06-15');
    expect(r.headline.recommendation).toEqual({ amountCents: 40000, byDate: '2026-06-12' });
  });
});

describe('critic5 N4: statement with a NEGATIVE balance (credit balance)', () => {
  it('credit statement contributes $0, never negative cash, no crash', () => {
    // Hand: remaining = floorAtZero(−50 − 0) = 0 → excluded from headline.
    const r = computeCashNeeded(input({
      paymentAccount: { name: 'Checking', balanceCents: c(10000), pending: [] },
      cards: [card({
        id: 'x', name: 'X',
        statement: { statementBalanceCents: c(-5000), minimumPaymentCents: c(0), dueDate: d('2026-06-15'), cycleEnd: d('2026-06-01') },
        autopay: { mode: 'STATEMENT_BALANCE' },
      })],
    }));
    expect(r.headline.requiredCents).toBe(0);
    expect(r.headline.cardsDueCount).toBe(0);
    expect(r.headline.byDate).toBeNull();
    expect(r.cards[0].remainingDueCents).toBe(0);
    expect(r.cards[0].cashRequiredCents).toBe(0);
    expect(r.headline.recommendation).toBeNull();
  });

  it('credit statement + a $35 minimum (issuer data error) still demands $0', () => {
    const r = computeCashNeeded(input({
      scenario: 'MINIMUM',
      paymentAccount: { name: 'Checking', balanceCents: c(10000), pending: [] },
      cards: [card({
        id: 'x', name: 'X',
        statement: { statementBalanceCents: c(-5000), minimumPaymentCents: c(3500), dueDate: d('2026-06-15'), cycleEnd: d('2026-06-01') },
      })],
    }));
    // min(3500, −5000) = −5000 → floorAtZero → 0.
    expect(r.headline.requiredCents).toBe(0);
    expect(r.minimumPathInterestCents).toBe(0);
  });
});

describe('critic5 N5: every generated statement is $0 but an estimated card exists', () => {
  it('headline $0/byDate null; the estimated card stays in `upcoming` (not silently dropped)', () => {
    // Engine rule: estimated obligations are next-cycle unless NO generated
    // statement exists. A $0 statement IS generated → estimate stays upcoming.
    const r = computeCashNeeded(input({
      paymentAccount: { name: 'Checking', balanceCents: c(10000), pending: [] },
      cards: [
        card({ id: 'a', name: 'A', statement: { statementBalanceCents: c(0), minimumPaymentCents: c(0), dueDate: d('2026-06-15'), cycleEnd: d('2026-06-01') } }),
        card({ id: 'b', name: 'B', currentBalanceCents: c(30000), nextCycleCloseDate: d('2026-06-18'), nextDueDate: d('2026-06-20') }),
      ],
    }));
    expect(r.headline.requiredCents).toBe(0);
    expect(r.headline.byDate).toBeNull();
    expect(r.upcoming).toHaveLength(1);
    expect(r.upcoming[0]).toMatchObject({ cardId: 'b', isEstimated: true, cashRequiredCents: 30000 });
  });

  it('…and when NO statement is generated at all, the estimate IS the headline', () => {
    const r = computeCashNeeded(input({
      paymentAccount: { name: 'Checking', balanceCents: c(10000), pending: [] },
      cards: [card({ id: 'b', name: 'B', currentBalanceCents: c(30000), nextCycleCloseDate: d('2026-06-18'), nextDueDate: d('2026-06-19') })],
    }));
    // due 06-19 is Juneteenth (Fri, observed) → effective Thu 06-18.
    expect(r.headline.requiredCents).toBe(30000);
    expect(r.headline.byDate).toBe('2026-06-18');
    expect(r.headline.shortfallCents).toBe(20000);
    expect(r.upcoming).toHaveLength(0);
  });
});

describe('critic5 N6: MINIMUM scenario + autopay MINIMUM + partial payment', () => {
  it('partial $20 against a $35 min → cash $15, action $0, interest on the true carry', () => {
    // Hand: minimumDue = 3500 − 2000 = 1500; autopay MINIMUM pulls 1500;
    // carried = (100000 − 2000) − 1500 = 96500 → 96500 × 2400/120000 = 1930.
    const r = computeCashNeeded(input({
      scenario: 'MINIMUM',
      paymentAccount: { name: 'Checking', balanceCents: c(50000), pending: [] },
      cards: [card({
        id: 'x', name: 'X', aprBps: 2400,
        statement: { statementBalanceCents: c(100000), minimumPaymentCents: c(3500), dueDate: d('2026-06-15'), cycleEnd: d('2026-06-01') },
        paymentsAppliedCents: c(2000),
        autopay: { mode: 'MINIMUM' },
      })],
    }));
    expect(r.headline.requiredCents).toBe(1500);
    expect(r.cards[0].autopayCents).toBe(1500);
    expect(r.cards[0].userActionCents).toBe(0);
    expect(r.minimumPathInterestCents).toBe(1930);
  });

  it('partial $50 already exceeds the min → $0 due, interest still computed ($19.00)', () => {
    // Hand: minimumDue = floorAtZero(3500 − 5000) = 0; carried = 95000 − 0 = 95000
    // → 95000 × 2400/120000 = 1900. Card owes nothing this cycle but interest
    // on the carried balance must still appear.
    const r = computeCashNeeded(input({
      scenario: 'MINIMUM',
      paymentAccount: { name: 'Checking', balanceCents: c(50000), pending: [] },
      cards: [card({
        id: 'x', name: 'X', aprBps: 2400,
        statement: { statementBalanceCents: c(100000), minimumPaymentCents: c(3500), dueDate: d('2026-06-15'), cycleEnd: d('2026-06-01') },
        paymentsAppliedCents: c(5000),
        autopay: { mode: 'MINIMUM' },
      })],
    }));
    expect(r.headline.requiredCents).toBe(0);
    expect(r.minimumPathInterestCents).toBe(1900);
  });
});
