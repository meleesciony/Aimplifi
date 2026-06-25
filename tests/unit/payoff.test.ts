/**
 * Debt payoff engine (Wave 3, DECISIONS #95). Known-answer tests pinned to the
 * hand-verified amortization in docs/EDGE_CASES.md §Debt-payoff. Money is
 * integer cents; interest = round(balance * aprBps / 10000 / 12) monthly.
 */
import { describe, expect, it } from 'vitest';
import { planDebtPayoff, type DebtInput } from '@/lib/engine/debt/payoff';

const debt = (over: Partial<DebtInput> = {}): DebtInput => ({
  id: 'd1',
  name: 'Loan',
  balanceCents: 30_000,
  aprBps: 1200, // 1%/mo
  minimumPaymentCents: 10_000,
  ...over,
});

describe('planDebtPayoff — single-debt hand-verified amortization', () => {
  it('clears a $300 @ 12% APR, $100/mo loan in 4 months with $6.14 interest', () => {
    // EDGE_CASES §Debt-payoff: 300→(+300i)−100=203.00; 205.03−100=105.03... etc.
    // months 1..4 interest = 300,203,105,6 → total 614; payments 100+100+100+6.14
    const r = planDebtPayoff({ debts: [debt()], strategy: 'avalanche', extraMonthlyCents: 0 });
    expect(r.monthsToDebtFree).toBe(4);
    expect(r.totalInterestCents).toBe(614);
    expect(r.totalPaidCents).toBe(30_614); // principal 30000 + interest 614
    expect(r.perDebt[0].payoffMonth).toBe(4);
    expect(r.perDebt[0].interestCents).toBe(614);
  });

  it('a 0% loan is pure principal division — no interest', () => {
    const r = planDebtPayoff({
      debts: [debt({ balanceCents: 100_000, aprBps: 0, minimumPaymentCents: 10_000 })],
      strategy: 'avalanche',
      extraMonthlyCents: 0,
    });
    expect(r.monthsToDebtFree).toBe(10);
    expect(r.totalInterestCents).toBe(0);
    expect(r.totalPaidCents).toBe(100_000);
  });

  it('extra payments accelerate payoff', () => {
    const r = planDebtPayoff({ debts: [debt()], strategy: 'avalanche', extraMonthlyCents: 10_000 });
    expect(r.monthsToDebtFree).toBe(2); // budget 20000/mo clears 300+interest in 2 months
    expect(r.monthsToDebtFree!).toBeLessThan(4);
  });

  it('reports never (null) on negative amortization (minimum below interest)', () => {
    const r = planDebtPayoff({
      debts: [debt({ balanceCents: 100_000, aprBps: 3600, minimumPaymentCents: 1_000 })], // 3%/mo = 3000 > 1000
      strategy: 'avalanche',
      extraMonthlyCents: 0,
    });
    expect(r.monthsToDebtFree).toBeNull();
    expect(r.perDebt[0].payoffMonth).toBeNull();
  });
});

describe('planDebtPayoff — snowball vs avalanche (Conflict A)', () => {
  const debts: DebtInput[] = [
    { id: 'A', name: 'High-rate card', balanceCents: 50_000, aprBps: 2400, minimumPaymentCents: 5_000 },
    { id: 'B', name: 'Small loan', balanceCents: 20_000, aprBps: 600, minimumPaymentCents: 5_000 },
  ];

  it('snowball clears the smallest balance first (earlier first win)', () => {
    const snow = planDebtPayoff({ debts, strategy: 'snowball', extraMonthlyCents: 10_000 });
    const ava = planDebtPayoff({ debts, strategy: 'avalanche', extraMonthlyCents: 10_000 });
    // snowball focuses B (smaller balance) → its first payoff lands sooner than avalanche's
    expect(snow.firstPayoffMonth!).toBeLessThan(ava.firstPayoffMonth!);
    expect(snow.perDebt[0].id).toBe('B'); // first cleared under snowball is the small loan
    expect(ava.perDebt[0].id).toBe('A'); // avalanche focuses the high-rate card first
  });

  it('avalanche never costs more interest than snowball', () => {
    const snow = planDebtPayoff({ debts, strategy: 'snowball', extraMonthlyCents: 10_000 });
    const ava = planDebtPayoff({ debts, strategy: 'avalanche', extraMonthlyCents: 10_000 });
    expect(ava.totalInterestCents).toBeLessThanOrEqual(snow.totalInterestCents);
    expect(snow.monthsToDebtFree).not.toBeNull();
    expect(ava.monthsToDebtFree).not.toBeNull();
  });
});
