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
    // EDGE_CASES §Debt-payoff A (integer cents): month-end balances
    //   20300 → 10503 → 608 → 0; per-month interest 300+203+105+6 = 614.
    // Payments: 10000 + 10000 + 10000 + 614 (final = the residue) = 30614 total.
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

  it('a $0-budget plan (no minimum, no extra) reports no plan, not phantom interest', () => {
    // EDGE_CASES §Debt-payoff F: a LOAN with no stored minimum and no extra has a
    // budget of 0 — nothing is ever paid, so we must NOT accrue a month of interest.
    const r = planDebtPayoff({
      debts: [debt({ balanceCents: 100_000, aprBps: 1200, minimumPaymentCents: 0 })],
      strategy: 'avalanche',
      extraMonthlyCents: 0,
    });
    expect(r.monthsToDebtFree).toBeNull();
    expect(r.totalInterestCents).toBe(0); // no phantom accrual
    expect(r.totalPaidCents).toBe(0);
    expect(r.perDebt[0].payoffMonth).toBeNull();
  });
});

describe('planDebtPayoff — mixed portfolio: one debt clears while another never amortizes (DECISIONS #98)', () => {
  // A never amortizes (min 100 < ~200/mo interest) and gets no rollover (budget is
  // exactly Σ minimums); B is 0% so its 100/mo min pays it straight down. The OLD
  // portfolio-total guard broke in month 1 (endTotal ≥ startTotal because A grows
  // more than B shrinks) and wrongly reported BOTH debts as never paid off. The
  // per-debt guard keeps the plan alive while B is clearing.
  const debts: DebtInput[] = [
    { id: 'A', name: 'Big card', balanceCents: 1_000_000, aprBps: 2400, minimumPaymentCents: 10_000 },
    { id: 'B', name: 'Small 0% card', balanceCents: 30_000, aprBps: 0, minimumPaymentCents: 10_000 },
  ];

  it('clears B in month 3 (firstPayoffMonth) even though A never amortizes', () => {
    const r = planDebtPayoff({ debts, strategy: 'snowball', extraMonthlyCents: 0 });
    // B: 30000 → 20000 → 10000 → 0 (no interest, 10000/mo, no rollover) ⇒ month 3.
    expect(r.firstPayoffMonth).toBe(3);
    const b = r.perDebt.find((d) => d.id === 'B')!;
    expect(b.payoffMonth).toBe(3);
    expect(b.interestCents).toBe(0);
    // A's budget (10000) stays below its ~20000/mo interest, so it never clears.
    const a = r.perDebt.find((d) => d.id === 'A')!;
    expect(a.payoffMonth).toBeNull();
    // The overall plan is "never" (A remains), but B's win is no longer hidden.
    expect(r.monthsToDebtFree).toBeNull();
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
