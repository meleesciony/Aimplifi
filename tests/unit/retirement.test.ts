import { describe, expect, it } from 'vitest';
import {
  type RetirementInputs,
  buildRetirementInputs,
  projectRetirement,
  realReturnBps,
} from '@/lib/engine/investments/retirement';
import { cents } from '@/lib/money';

// Base case: every field explicit; tests override only what they exercise.
const base = (o: Partial<RetirementInputs> = {}): RetirementInputs => ({
  currentPortfolioCents: cents(0),
  currentAge: 65,
  retirementAge: 65,
  endAge: 95,
  monthlyContributionCents: cents(0),
  annualRetirementSpendingCents: cents(0),
  annualReturnBps: 0,
  swrBps: 400,
  ...o,
});

const at = (points: readonly { age: number; balanceCents: number }[], age: number): number => {
  const p = points.find((x) => x.age === age);
  if (!p) throw new Error(`no yearly point at age ${age}`);
  return p.balanceCents;
};

describe('projectRetirement — decumulation, 0% return (exact known-answers)', () => {
  it('sustains a 2-year drawdown that does not exhaust the portfolio', () => {
    // $120,000, retire now, spend $12,000/yr ($1,000/mo), 0% return, to age 67.
    // 24 months × $1,000 = $24,000 → ends at $96,000. Never hits zero.
    const r = projectRetirement(
      base({
        currentPortfolioCents: cents(12_000_000),
        currentAge: 65,
        retirementAge: 65,
        endAge: 67,
        annualRetirementSpendingCents: cents(1_200_000),
      }),
    );
    expect(r.balanceAtRetirementCents).toBe(12_000_000);
    expect(r.endBalanceCents).toBe(9_600_000);
    expect(r.outcome).toBe('sustained');
    expect(r.depletionAge).toBeNull();
    // SWR reference: 4% of $120,000 = $4,800/yr.
    expect(r.sustainableAnnualWithdrawalCents).toBe(480_000);
    expect(r.plannedAnnualWithdrawalCents).toBe(1_200_000);
  });

  it('depletes exactly when the money runs out and reports the age', () => {
    // $60,000, spend $12,000/yr ($1,000/mo), 0% → exhausts in 60 months = age 70.
    const r = projectRetirement(
      base({
        currentPortfolioCents: cents(6_000_000),
        currentAge: 65,
        retirementAge: 65,
        endAge: 75,
        annualRetirementSpendingCents: cents(1_200_000),
      }),
    );
    expect(r.outcome).toBe('depleted');
    expect(r.depletionAge).toBe(70);
    expect(r.endBalanceCents).toBe(0);
  });

  it('runs the full accumulate-then-spend path', () => {
    // Age 60: $100,000 + $1,000/mo for 5yr (0%) → $160,000 at retirement (age 65).
    // Then spend $24,000/yr ($2,000/mo) for 2yr → $112,000 at age 67.
    const r = projectRetirement(
      base({
        currentPortfolioCents: cents(10_000_000),
        currentAge: 60,
        retirementAge: 65,
        endAge: 67,
        monthlyContributionCents: cents(100_000),
        annualRetirementSpendingCents: cents(2_400_000),
      }),
    );
    expect(r.balanceAtRetirementCents).toBe(16_000_000);
    expect(r.endBalanceCents).toBe(11_200_000);
    expect(r.outcome).toBe('sustained');
    // yearly path checkpoints (one accumulation year, one decumulation year).
    expect(at(r.yearlyBalances, 60)).toBe(10_000_000);
    expect(at(r.yearlyBalances, 61)).toBe(11_200_000);
    expect(at(r.yearlyBalances, 65)).toBe(16_000_000);
    expect(at(r.yearlyBalances, 66)).toBe(13_600_000);
    expect(at(r.yearlyBalances, 67)).toBe(11_200_000);
    // currentAge … endAge inclusive.
    expect(r.yearlyBalances).toHaveLength(8);
  });

  it('rounds the monthly withdrawal once (annual spend not divisible by 12)', () => {
    // $10,000/yr → $833.33/mo → 83,333 cents (rounded once). 12 mo on $1,000,000
    // at 0% → $1,000,000 − 12×$833.33 = $1,000,000 − $9,999.96 = $990,000.04.
    const r = projectRetirement(
      base({
        currentPortfolioCents: cents(100_000_000),
        currentAge: 65,
        retirementAge: 65,
        endAge: 66,
        annualRetirementSpendingCents: cents(1_000_000),
      }),
    );
    expect(r.endBalanceCents).toBe(99_000_004);
  });
});

describe('projectRetirement — depletion boundary', () => {
  it('counts hitting zero on the final month as depleted', () => {
    // $12,000, $100/mo ($1,200/yr), 0%, 120 months → zero exactly at age 75.
    const r = projectRetirement(
      base({
        currentPortfolioCents: cents(1_200_000),
        currentAge: 65,
        retirementAge: 65,
        endAge: 75,
        annualRetirementSpendingCents: cents(120_000),
      }),
    );
    expect(r.outcome).toBe('depleted');
    expect(r.depletionAge).toBe(75);
    expect(r.endBalanceCents).toBe(0);
  });

  it('survives when one dollar more than the spend remains', () => {
    // $12,100 against $100/mo for 120 months → $100 left at the end.
    const r = projectRetirement(
      base({
        currentPortfolioCents: cents(1_210_000),
        currentAge: 65,
        retirementAge: 65,
        endAge: 75,
        annualRetirementSpendingCents: cents(120_000),
      }),
    );
    expect(r.outcome).toBe('sustained');
    expect(r.depletionAge).toBeNull();
    expect(r.endBalanceCents).toBe(10_000);
  });
});

describe('projectRetirement — compounding', () => {
  it('grows the portfolio when return exceeds the withdrawal rate (sustainable)', () => {
    // $1,000,000, withdraw exactly 4% ($40,000/yr) but earn 7% → balance climbs.
    const r = projectRetirement(
      base({
        currentPortfolioCents: cents(100_000_000),
        currentAge: 65,
        retirementAge: 65,
        endAge: 95,
        annualRetirementSpendingCents: cents(4_000_000),
        annualReturnBps: 700,
        swrBps: 400,
      }),
    );
    expect(r.outcome).toBe('sustained');
    expect(r.depletionAge).toBeNull();
    expect(r.endBalanceCents).toBeGreaterThan(100_000_000);
    // Withdrawing exactly the SWR amount — planned equals sustainable.
    expect(r.sustainableAnnualWithdrawalCents).toBe(4_000_000);
    expect(r.plannedAnnualWithdrawalCents).toBe(4_000_000);
  });

  it('matches a closed-form annual projection over a 10-year accumulation', () => {
    // $500,000, $0 contribution, 7.2%/yr for 10yr (no decumulation).
    const r = projectRetirement(
      base({
        currentPortfolioCents: cents(50_000_000),
        currentAge: 55,
        retirementAge: 65,
        endAge: 65,
        annualReturnBps: 720,
      }),
    );
    const expected = Math.round(50_000_000 * Math.pow(1.072, 10));
    // Monthly geometric loop vs the annual closed form: agreement to within bounded
    // per-month rounding drift (≤ ~$1 over 120 months) proves no ordering/off-by-one bug.
    expect(Math.abs(r.balanceAtRetirementCents - expected)).toBeLessThanOrEqual(200);
    // No decumulation phase → end balance equals the at-retirement balance.
    expect(r.endBalanceCents).toBe(r.balanceAtRetirementCents);
    expect(r.outcome).toBe('sustained');
    expect(r.yearlyBalances).toHaveLength(11); // ages 55..65 inclusive
  });

  it('decumulates in the right order (grow THEN withdraw) under a nonzero return', () => {
    // $1,000,000, retire now, draw $72,000/yr ($600,000/mo·¢) at 7.2%, for 12 months.
    // Independent closed-form annuity (end-of-month withdrawal):
    //   grow-then-withdraw:  P·(1+i)^12 − W·((1+i)^12−1)/i
    //   withdraw-then-grow:  P·(1+i)^12 − W·(1+i)·((1+i)^12−1)/i   (differs by a (1+i) factor)
    // The two orderings differ by ~$432 here, far above the rounding-drift bound, so this
    // pins the engine to grow-then-withdraw — the 0%-return tests above cannot tell them apart.
    const i = Math.pow(1.072, 1 / 12) - 1;
    const pow12 = Math.pow(1 + i, 12); // = 1.072
    const W = Math.round(7_200_000 / 12); // 600,000
    const annuity = (pow12 - 1) / i;
    const growThenWithdraw = Math.round(100_000_000 * pow12 - W * annuity);
    const withdrawThenGrow = Math.round(100_000_000 * pow12 - W * (1 + i) * annuity);
    expect(Math.abs(growThenWithdraw - withdrawThenGrow)).toBeGreaterThan(200); // bound discriminates

    const r = projectRetirement(
      base({
        currentPortfolioCents: cents(100_000_000),
        currentAge: 65,
        retirementAge: 65,
        endAge: 66,
        annualRetirementSpendingCents: cents(7_200_000),
        annualReturnBps: 720,
      }),
    );
    expect(Math.abs(r.endBalanceCents - growThenWithdraw)).toBeLessThanOrEqual(200);
    expect(Math.abs(r.endBalanceCents - withdrawThenGrow)).toBeGreaterThan(200);
  });

  it('applies growth during draw-down: a positive return extends runway vs 0%', () => {
    // $500,000 drawing $60,000/yr ($500,000/mo·¢) depletes under both, but later with growth.
    const args = {
      currentPortfolioCents: cents(50_000_000),
      currentAge: 65,
      retirementAge: 65,
      endAge: 95,
      annualRetirementSpendingCents: cents(6_000_000),
    } as const;
    const flat = projectRetirement(base({ ...args, annualReturnBps: 0 }));
    const grown = projectRetirement(base({ ...args, annualReturnBps: 700 }));
    expect(flat.outcome).toBe('depleted');
    expect(grown.outcome).toBe('depleted');
    // 0%: 50,000,000 / 500,000 = 100 months → age 65 + 100/12.
    expect(flat.depletionAge).toBeCloseTo(65 + 100 / 12, 4);
    // Growth must push depletion strictly later — proof the draw-down phase compounds.
    expect(grown.depletionAge!).toBeGreaterThan(flat.depletionAge!);
  });
});

describe('projectRetirement — input validation (fail loud)', () => {
  it('rejects non-integer ages', () => {
    expect(() => projectRetirement(base({ currentAge: 65.5 }))).toThrow(/whole years/);
  });

  it('rejects currentAge greater than retirementAge', () => {
    expect(() => projectRetirement(base({ currentAge: 70, retirementAge: 65 }))).toThrow(
      /currentAge ≤ retirementAge/,
    );
  });

  it('rejects endAge over 120', () => {
    expect(() => projectRetirement(base({ endAge: 121 }))).toThrow(/≤ 120/);
  });

  it('rejects a zero-length horizon (endAge === currentAge)', () => {
    expect(() => projectRetirement(base({ currentAge: 65, retirementAge: 65, endAge: 65 }))).toThrow(
      /endAge > currentAge/,
    );
  });

  it('rejects a non-positive SWR', () => {
    expect(() => projectRetirement(base({ swrBps: 0 }))).toThrow(/swrBps must be positive/);
  });

  it('rejects a negative return', () => {
    expect(() => projectRetirement(base({ annualReturnBps: -1 }))).toThrow(/return cannot be negative/);
  });

  it('rejects a negative portfolio, contribution, or spend', () => {
    expect(() => projectRetirement(base({ currentPortfolioCents: cents(-1) }))).toThrow(
      /portfolio cannot be negative/,
    );
    expect(() => projectRetirement(base({ monthlyContributionCents: cents(-1) }))).toThrow(
      /contribution cannot be negative/,
    );
    expect(() => projectRetirement(base({ annualRetirementSpendingCents: cents(-1) }))).toThrow(
      /spending cannot be negative/,
    );
  });
});

describe('realReturnBps — today’s-dollars haircut (DECISIONS #123)', () => {
  it('subtracts inflation from the nominal return', () => {
    expect(realReturnBps(700, 250)).toBe(450);
    expect(realReturnBps(700, 0)).toBe(700);
  });
  it('floors at zero when inflation meets/exceeds the nominal return', () => {
    expect(realReturnBps(250, 250)).toBe(0);
    expect(realReturnBps(200, 250)).toBe(0);
  });
});

describe('buildRetirementInputs — one builder, no drift (DECISIONS #123)', () => {
  const BASE = {
    currentPortfolioCents: 14_200_000,
    monthlyContributionCents: 120_000,
    annualRetirementSpendingCents: 6_000_000,
    nominalReturnBps: 700,
    swrBps: 400,
  };
  const PLAN = { currentAge: 40, retirementAge: 65, endAge: 95, inflationBps: 250 };

  it('passes the planning ages through and derives the real return', () => {
    const inputs = buildRetirementInputs(BASE, PLAN);
    expect(inputs.currentAge).toBe(40);
    expect(inputs.retirementAge).toBe(65);
    expect(inputs.endAge).toBe(95);
    expect(inputs.annualReturnBps).toBe(450); // 700 − 250
    expect(inputs.swrBps).toBe(400);
  });

  it('floors negative financial figures at zero', () => {
    const inputs = buildRetirementInputs(
      { ...BASE, currentPortfolioCents: -1, monthlyContributionCents: -50_000 },
      PLAN,
    );
    expect(inputs.currentPortfolioCents).toBe(0);
    expect(inputs.monthlyContributionCents).toBe(0);
  });

  it('feeds projectRetirement an input that is identical to a hand-assembled one', () => {
    const viaBuilder = projectRetirement(buildRetirementInputs(BASE, PLAN));
    const direct = projectRetirement({
      currentPortfolioCents: cents(14_200_000),
      currentAge: 40,
      retirementAge: 65,
      endAge: 95,
      monthlyContributionCents: cents(120_000),
      annualRetirementSpendingCents: cents(6_000_000),
      annualReturnBps: 450,
      swrBps: 400,
    });
    expect(viaBuilder).toEqual(direct);
  });

  it('a later retirement age extends the runway (more accumulation, fewer draw years)', () => {
    const early = projectRetirement(buildRetirementInputs(BASE, { ...PLAN, retirementAge: 55 }));
    const late = projectRetirement(buildRetirementInputs(BASE, { ...PLAN, retirementAge: 70 }));
    expect(late.balanceAtRetirementCents).toBeGreaterThan(early.balanceAtRetirementCents);
  });
});
