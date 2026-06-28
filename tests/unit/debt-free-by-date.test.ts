/**
 * Known-answer + property tests for the inverse debt planner
 * (src/lib/engine/solve/debt-free-by-date.ts, DECISIONS #125).
 *
 * Every required-extra figure below is hand-derived to the cent and pinned in
 * docs/EDGE_CASES.md §Debt-free-by-date. The two load-bearing locks are:
 *   - MINIMALITY: works(required) is true AND works(required-1) is false, computed
 *     INDEPENDENTLY from planDebtPayoff — proving the bisection returns the true minimum.
 *   - MONOTONICITY: monthsToDebtFree is non-increasing in extra (the property the
 *     bisection's correctness rests on).
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import { type DebtInput, planDebtPayoff } from '@/lib/engine/debt/payoff';
import {
  type DebtFreeByDateInput,
  solveDebtFreeByDate,
  wholeMonthsUntil,
} from '@/lib/engine/solve/debt-free-by-date';

const d = isoDate;
const TODAY = d('2026-06-10');

function debt(partial: Partial<DebtInput> & { balanceCents: number }): DebtInput {
  return {
    id: partial.id ?? 'debt-1',
    name: partial.name ?? 'Card',
    aprBps: partial.aprBps ?? 0,
    minimumPaymentCents: partial.minimumPaymentCents ?? 0,
    balanceCents: partial.balanceCents,
  };
}

function solve(over: Partial<DebtFreeByDateInput>): ReturnType<typeof solveDebtFreeByDate> {
  return solveDebtFreeByDate({
    debts: over.debts ?? [debt({ balanceCents: 120_000 })],
    strategy: over.strategy ?? 'avalanche',
    targetDate: over.targetDate ?? d('2027-06-10'),
    today: over.today ?? TODAY,
    safeToSpendCents: over.safeToSpendCents ?? 100_000,
  });
}

/** Independent oracle: does this extra make the date? Recomputed straight from the engine. */
function worksIndependently(
  debts: DebtInput[],
  extraMonthlyCents: number,
  targetMonths: number,
): boolean {
  const m = planDebtPayoff({ debts, strategy: 'avalanche', extraMonthlyCents }).monthsToDebtFree;
  return m !== null && m <= targetMonths;
}

describe('wholeMonthsUntil — month-end-clamp-correct month counting', () => {
  it('a clean year out is 12 months', () => {
    expect(wholeMonthsUntil(d('2026-06-10'), d('2027-06-10'))).toBe(12);
  });

  it('Jan 31 → Feb 28 counts as one whole month (clamp-aware, not 0)', () => {
    expect(wholeMonthsUntil(d('2026-01-31'), d('2026-02-28'))).toBe(1);
  });

  it('mid-month short of the anniversary does not count', () => {
    expect(wholeMonthsUntil(d('2026-06-10'), d('2026-07-09'))).toBe(0);
    expect(wholeMonthsUntil(d('2026-06-10'), d('2026-07-10'))).toBe(1);
  });

  it('Jun 10 → Dec 31 is 6 whole months', () => {
    expect(wholeMonthsUntil(d('2026-06-10'), d('2026-12-31'))).toBe(6);
  });

  it('today or a past date is 0', () => {
    expect(wholeMonthsUntil(d('2026-06-10'), d('2026-06-10'))).toBe(0);
    expect(wholeMonthsUntil(d('2026-06-10'), d('2026-01-01'))).toBe(0);
  });
});

describe('solveDebtFreeByDate — known-answer outcomes', () => {
  it('DF-A zero-interest: $1,200 over 12 months needs exactly $100/mo extra', () => {
    // budget = extra (min 0); cleared at ceil(120000/extra). ≤12 ⇔ extra ≥ 10000.
    const r = solve({
      debts: [debt({ balanceCents: 120_000, aprBps: 0, minimumPaymentCents: 0 })],
      targetDate: d('2027-06-10'),
      safeToSpendCents: 100_000,
    });
    expect(r.outcome).toBe('reachable');
    expect(r.requiredExtraMonthlyCents).toBe(10_000);
    expect(r.monthsToDebtFree).toBe(12);
    expect(r.shareOfSafeToSpendBps).toBe(1_000); // 10% of safe-to-spend
    expect(r.withinSafeToSpend).toBe(true);
    expect(r.totalBalanceCents).toBe(120_000);
  });

  it('DF-B on-track: minimums alone already clear by the date → $0 extra', () => {
    const r = solve({
      debts: [debt({ balanceCents: 120_000, aprBps: 0, minimumPaymentCents: 20_000 })],
      targetDate: d('2027-06-10'),
      safeToSpendCents: 100_000,
    });
    expect(r.outcome).toBe('on-track');
    expect(r.requiredExtraMonthlyCents).toBe(0);
    expect(r.monthsToDebtFree).toBe(6); // 120000 / 20000
    expect(r.shareOfSafeToSpendBps).toBe(0);
    expect(r.withinSafeToSpend).toBe(true);
  });

  it('DF-C unreachable: a date today or in the past', () => {
    const past = solve({
      debts: [debt({ balanceCents: 500_000 })],
      targetDate: d('2026-06-10'),
      safeToSpendCents: 100_000,
    });
    expect(past.outcome).toBe('unreachable');
    expect(past.targetMonths).toBe(0);
    expect(past.requiredExtraMonthlyCents).toBeNull();
    expect(past.monthsToDebtFree).toBeNull();
    expect(past.shareOfSafeToSpendBps).toBeNull();
    expect(past.withinSafeToSpend).toBeNull();
  });

  it('DF-D reachable but over budget: honest figure AND flagged unaffordable', () => {
    // $12,000 in 3 months needs $4,000/mo extra; safe-to-spend is only $1,000.
    const r = solve({
      debts: [debt({ balanceCents: 1_200_000, aprBps: 0, minimumPaymentCents: 0 })],
      targetDate: d('2026-09-10'),
      safeToSpendCents: 100_000,
    });
    expect(r.outcome).toBe('reachable');
    expect(r.targetMonths).toBe(3);
    expect(r.requiredExtraMonthlyCents).toBe(400_000);
    expect(r.monthsToDebtFree).toBe(3);
    expect(r.shareOfSafeToSpendBps).toBe(40_000); // 400% of safe-to-spend — honest, not clamped
    expect(r.withinSafeToSpend).toBe(false);
  });

  it('DF-E1 with interest: $1,000 at 24% APR in 1 month needs exactly $1,020.00', () => {
    // month1 interest = round(100000 * 0.02) = 2000 → owed 102000; cleared iff extra ≥ 102000.
    const r = solve({
      debts: [debt({ balanceCents: 100_000, aprBps: 2_400, minimumPaymentCents: 0 })],
      targetDate: d('2026-07-10'),
      safeToSpendCents: 200_000,
    });
    expect(r.outcome).toBe('reachable');
    expect(r.targetMonths).toBe(1);
    expect(r.requiredExtraMonthlyCents).toBe(102_000);
    expect(r.monthsToDebtFree).toBe(1);
    expect(r.shareOfSafeToSpendBps).toBe(5_100); // 102000 / 200000
    expect(r.withinSafeToSpend).toBe(true);
  });

  it('DF-E2 with interest: $1,000 at 24% APR in 2 months needs exactly $515.05', () => {
    // m1: 102000 - E. m2: (102000-E) + round((102000-E)*0.02) ≤ E. Max remaining 50495 ⇒ E=51505.
    const r = solve({
      debts: [debt({ balanceCents: 100_000, aprBps: 2_400, minimumPaymentCents: 0 })],
      targetDate: d('2026-08-10'),
      safeToSpendCents: 515_050, // exactly 10× the answer → clean 1000 bps
    });
    expect(r.outcome).toBe('reachable');
    expect(r.targetMonths).toBe(2);
    expect(r.requiredExtraMonthlyCents).toBe(51_505);
    expect(r.monthsToDebtFree).toBe(2);
    expect(r.shareOfSafeToSpendBps).toBe(1_000);
    expect(r.withinSafeToSpend).toBe(true);
  });

  it('DF-F already debt-free: no debts (or zero balances) → nothing to solve', () => {
    const empty = solve({ debts: [], safeToSpendCents: 100_000 });
    expect(empty.outcome).toBe('already-debt-free');
    expect(empty.requiredExtraMonthlyCents).toBe(0);
    expect(empty.monthsToDebtFree).toBe(0);
    expect(empty.totalBalanceCents).toBe(0);

    const zeroed = solve({ debts: [debt({ balanceCents: 0 })], safeToSpendCents: 100_000 });
    expect(zeroed.outcome).toBe('already-debt-free');
    expect(zeroed.totalBalanceCents).toBe(0);
  });

  it('DF-G overspent: safe-to-spend ≤ 0 → still a real figure, but share/affordability null', () => {
    const r = solve({
      debts: [debt({ balanceCents: 120_000, aprBps: 0, minimumPaymentCents: 0 })],
      targetDate: d('2027-06-10'),
      safeToSpendCents: 0,
    });
    expect(r.outcome).toBe('reachable');
    expect(r.requiredExtraMonthlyCents).toBe(10_000); // unchanged by safe-to-spend
    expect(r.shareOfSafeToSpendBps).toBeNull();
    expect(r.withinSafeToSpend).toBeNull();

    const neg = solve({ targetDate: d('2027-06-10'), safeToSpendCents: -50_000 });
    expect(neg.shareOfSafeToSpendBps).toBeNull();
    expect(neg.withinSafeToSpend).toBeNull();
  });

  it('DF-I pathological high APR: still reachable (hi grows past one month of interest, not a fixed 2×)', () => {
    // monthly interest at 50000% APR on $1,000 is ~$41,667 — far above the old hi0 = 2× balance,
    // which would have falsely reported "unreachable". The growing bound must still solve it.
    const r = solve({
      debts: [debt({ balanceCents: 100_000, aprBps: 5_000_000, minimumPaymentCents: 0 })],
      targetDate: d('2027-06-10'),
      safeToSpendCents: 100_000_000,
    });
    expect(r.outcome).toBe('reachable');
    expect(r.requiredExtraMonthlyCents).not.toBeNull();
    expect(r.monthsToDebtFree as number).toBeLessThanOrEqual(r.targetMonths);
  });

  it('DF-H multi-debt avalanche: solves over the real portfolio engine', () => {
    const debts = [
      debt({ id: 'a', name: 'Card A', balanceCents: 300_000, aprBps: 2_499, minimumPaymentCents: 3_500 }),
      debt({ id: 'b', name: 'Card B', balanceCents: 50_000, aprBps: 1_999, minimumPaymentCents: 3_500 }),
    ];
    const r = solve({ debts, targetDate: d('2027-06-10'), safeToSpendCents: 200_000 });
    expect(r.outcome === 'reachable' || r.outcome === 'on-track').toBe(true);
    expect(r.monthsToDebtFree).not.toBeNull();
    expect(r.monthsToDebtFree as number).toBeLessThanOrEqual(12);
    expect(r.totalBalanceCents).toBe(350_000);
  });
});

describe('solveDebtFreeByDate — minimality (independent oracle)', () => {
  const cases: { name: string; debts: DebtInput[]; targetDate: ReturnType<typeof isoDate> }[] = [
    { name: 'DF-A', debts: [debt({ balanceCents: 120_000 })], targetDate: d('2027-06-10') },
    {
      name: 'DF-E2',
      debts: [debt({ balanceCents: 100_000, aprBps: 2_400 })],
      targetDate: d('2026-08-10'),
    },
    {
      name: 'multi-debt',
      debts: [
        debt({ id: 'a', balanceCents: 300_000, aprBps: 2_499, minimumPaymentCents: 3_500 }),
        debt({ id: 'b', balanceCents: 90_000, aprBps: 2_924, minimumPaymentCents: 3_500 }),
      ],
      targetDate: d('2027-12-10'),
    },
  ];

  for (const c of cases) {
    it(`${c.name}: required works and required-1 does not`, () => {
      const r = solve({ debts: c.debts, targetDate: c.targetDate, safeToSpendCents: 1_000_000 });
      expect(r.requiredExtraMonthlyCents).not.toBeNull();
      const required = r.requiredExtraMonthlyCents as number;
      const targetMonths = r.targetMonths;
      expect(worksIndependently(c.debts, required, targetMonths)).toBe(true);
      if (required > 0) {
        expect(worksIndependently(c.debts, required - 1, targetMonths)).toBe(false);
      }
    });
  }
});

describe('solveDebtFreeByDate — monotonicity (the property the bisection rests on)', () => {
  it('monthsToDebtFree is non-increasing as extra rises, under BOTH strategies (null = never = +∞)', () => {
    const debts = [
      debt({ id: 'a', balanceCents: 240_000, aprBps: 1_200, minimumPaymentCents: 2_000 }),
      debt({ id: 'b', balanceCents: 80_000, aprBps: 2_400, minimumPaymentCents: 1_000 }),
    ];
    for (const strategy of ['avalanche', 'snowball'] as const) {
      let prev = Number.POSITIVE_INFINITY;
      // tighter 1000-cent step than the bisection samples, to catch any blip
      for (let extra = 0; extra <= 200_000; extra += 1_000) {
        const m = planDebtPayoff({ debts, strategy, extraMonthlyCents: extra }).monthsToDebtFree;
        const eff = m === null ? Number.POSITIVE_INFINITY : m;
        expect(eff, `${strategy} @ ${extra}`).toBeLessThanOrEqual(prev);
        prev = eff;
      }
    }
  });
});
