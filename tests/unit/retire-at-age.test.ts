/**
 * Known-answer + property tests for the inverse retirement planner
 * (src/lib/engine/solve/retire-at-age.ts, DECISIONS #131).
 *
 * The load-bearing locks:
 *   - EXACT cents: in the real-return-0 cases (nominal == inflation) the engine's
 *     growOneMonth is the identity, so balance-at-retirement = accumMonths × monthly and
 *     the sustain threshold is closed-form — every required figure below is hand-derived
 *     to the cent and pinned in docs/EDGE_CASES.md §Retire-at-age.
 *   - MINIMALITY: sustains(required) is true AND sustains(required-1) is false, computed
 *     INDEPENDENTLY straight from projectRetirement — proving the bisection returns the
 *     true minimum, including under real compounding (the growth case).
 *   - MONOTONICITY: the sustained predicate is one-directional in the contribution (the
 *     property the bisection's correctness rests on).
 *
 * Note on the "+1": the engine treats a balance hitting exactly 0 after a withdrawal as
 * DEPLETED (p <= 0), so the minimal SUSTAINING contribution is one cent above the
 * break-even — e.g. break-even 200,000 ⇒ minimal 200,001. That edge is deliberately pinned.
 */
import { describe, expect, it } from 'vitest';

import { buildRetirementInputs, projectRetirement } from '@/lib/engine/investments/retirement';
import { type RetireAtAgeInput, solveRetireAtAge } from '@/lib/engine/solve/retire-at-age';

/** Default = the RA-0PCT scenario (real return 0): 10y accumulation, 20y retirement,
 *  $0 start, $12k/yr spend ⇒ $100,000/mo withdrawal, $3,000/mo safe-to-spend. */
function base(over: Partial<RetireAtAgeInput> = {}): RetireAtAgeInput {
  return {
    targetRetirementAge: 50,
    currentPortfolioCents: 0,
    monthlyContributionCents: 0,
    annualRetirementSpendingCents: 1_200_000, // $12,000/yr → $1,000/mo withdrawal
    nominalReturnBps: 250,
    swrBps: 400,
    currentAge: 40,
    endAge: 70,
    inflationBps: 250, // real return = 250 - 250 = 0
    safeToSpendCents: 300_000,
    ...over,
  };
}

function solve(over: Partial<RetireAtAgeInput> = {}): ReturnType<typeof solveRetireAtAge> {
  return solveRetireAtAge(base(over));
}

/** Independent oracle: does this monthly contribution sustain? Recomputed straight from the
 *  #122 engine via the SAME builder the solver uses — no shared code with the bisection. */
function sustainsIndependently(input: RetireAtAgeInput, monthly: number): boolean {
  const proj = projectRetirement(
    buildRetirementInputs(
      {
        currentPortfolioCents: input.currentPortfolioCents,
        monthlyContributionCents: monthly,
        annualRetirementSpendingCents: input.annualRetirementSpendingCents,
        nominalReturnBps: input.nominalReturnBps,
        swrBps: input.swrBps,
      },
      {
        currentAge: input.currentAge,
        retirementAge: input.targetRetirementAge,
        endAge: input.endAge,
        inflationBps: input.inflationBps,
      },
    ),
  );
  return proj.outcome === 'sustained';
}

describe('solveRetireAtAge — known-answer outcomes (real-return-0, exact cents)', () => {
  it('RA-0PCT reachable: 10y accum, $0 start, needs exactly $2,000.01/mo', () => {
    // accum 120mo; decum 240mo × $1,000 = $24,000.00 to clear. balAtRet = 120 × monthly.
    // sustained ⇔ 120·monthly > 2,400,000,000¢? No — 240·100,000 = 24,000,000¢.
    // 120·monthly > 24,000,000 ⇔ monthly > 200,000 ⇒ minimal 200,001.
    const r = solve();
    expect(r.outcome).toBe('reachable');
    expect(r.yearsToRetirement).toBe(10);
    expect(r.requiredMonthlyContributionCents).toBe(200_001);
    expect(r.requiredAdditionalMonthlyCents).toBe(200_001); // current is 0
    expect(r.balanceAtRetirementCents).toBe(24_000_120); // 120 × 200,001
    expect(r.endBalanceCents).toBe(120); // 24,000,120 − 240×100,000
    expect(r.sustainableAnnualWithdrawalCents).toBe(960_005); // round(24,000,120 × 4%)
    expect(r.plannedAnnualWithdrawalCents).toBe(1_200_000);
    expect(r.shareOfSafeToSpendBps).toBe(6_667); // round(200,001 / 300,000 × 10000)
    expect(r.withinSafeToSpend).toBe(true);
    expect(r.unreachableReason).toBeNull();
  });

  it('RA-CURRENT reachable: a $500/mo current rate is subtracted from the required total', () => {
    const r = solve({ monthlyContributionCents: 50_000 });
    expect(r.outcome).toBe('reachable');
    expect(r.currentMonthlyContributionCents).toBe(50_000);
    expect(r.requiredMonthlyContributionCents).toBe(200_001); // minimal TOTAL is unchanged
    expect(r.requiredAdditionalMonthlyCents).toBe(150_001); // 200,001 − 50,000
    expect(r.shareOfSafeToSpendBps).toBe(5_000); // round(150,001 / 300,000 × 10000)
    expect(r.withinSafeToSpend).toBe(true);
  });

  it('RA-ONTRACK already-on-track: a $2,500/mo current rate already sustains', () => {
    const r = solve({ monthlyContributionCents: 250_000 });
    expect(r.outcome).toBe('already-on-track');
    expect(r.requiredMonthlyContributionCents).toBe(250_000); // echo current; no extra needed
    expect(r.requiredAdditionalMonthlyCents).toBe(0);
    expect(r.balanceAtRetirementCents).toBe(30_000_000); // 120 × 250,000
    expect(r.endBalanceCents).toBe(6_000_000); // 30,000,000 − 24,000,000
    expect(r.sustainableAnnualWithdrawalCents).toBe(1_200_000); // round(30,000,000 × 4%)
    expect(r.shareOfSafeToSpendBps).toBe(0);
    expect(r.withinSafeToSpend).toBe(true);
  });

  it('RA-D reachable but over budget: honest figure AND flagged unaffordable', () => {
    // 1y accum (12mo); same $24,000 decum need ⇒ 12·monthly > 24,000,000 ⇒ minimal 2,000,001.
    const r = solve({
      targetRetirementAge: 41,
      endAge: 61, // decum still 240 months
      safeToSpendCents: 100_000,
    });
    expect(r.outcome).toBe('reachable');
    expect(r.yearsToRetirement).toBe(1);
    expect(r.requiredAdditionalMonthlyCents).toBe(2_000_001);
    expect(r.shareOfSafeToSpendBps).toBe(200_000); // 2000% of safe-to-spend — honest, not clamped
    expect(r.withinSafeToSpend).toBe(false);
  });

  it('RA-G overspent: safe-to-spend ≤ 0 → still a real figure, but share/affordability null', () => {
    const zero = solve({ safeToSpendCents: 0 });
    expect(zero.outcome).toBe('reachable');
    expect(zero.requiredAdditionalMonthlyCents).toBe(200_001); // unchanged by safe-to-spend
    expect(zero.shareOfSafeToSpendBps).toBeNull();
    expect(zero.withinSafeToSpend).toBeNull();

    const neg = solve({ safeToSpendCents: -50_000 });
    expect(neg.shareOfSafeToSpendBps).toBeNull();
    expect(neg.withinSafeToSpend).toBeNull();
  });
});

describe('solveRetireAtAge — unreachable branches', () => {
  it('RA-PAST age-in-past: a target age before the current age', () => {
    const r = solve({ targetRetirementAge: 39 });
    expect(r.outcome).toBe('unreachable');
    expect(r.unreachableReason).toBe('age-in-past');
    expect(r.yearsToRetirement).toBe(0);
    expect(r.requiredMonthlyContributionCents).toBeNull();
    expect(r.requiredAdditionalMonthlyCents).toBeNull();
    expect(r.shareOfSafeToSpendBps).toBeNull();
    expect(r.withinSafeToSpend).toBeNull();
  });

  it('RA-AFTEREND age-after-end: a target age at or beyond the plan-through age', () => {
    const r = solve({ targetRetirementAge: 72, endAge: 70 });
    expect(r.outcome).toBe('unreachable');
    expect(r.unreachableReason).toBe('age-after-end');
    expect(r.requiredMonthlyContributionCents).toBeNull();
    // #131 critic P2: retiring AT the plan-through age (0 retirement years) is also after-end —
    // the save validator rejects it, so the answer must not offer a savable "on-track".
    expect(solve({ targetRetirementAge: 70, endAge: 70 }).unreachableReason).toBe('age-after-end');
  });

  it('RA-CANNOT cannot-sustain: retiring now with too little, no contribution can land in time', () => {
    const r = solve({ targetRetirementAge: 40, currentPortfolioCents: 0 });
    expect(r.outcome).toBe('unreachable');
    expect(r.unreachableReason).toBe('cannot-sustain');
    expect(r.requiredMonthlyContributionCents).toBeNull();
    expect(r.plannedAnnualWithdrawalCents).toBe(1_200_000); // spend still echoed for the copy
  });

  it('retiring now WITH enough is already-on-track, not cannot-sustain', () => {
    // $5,000,000 portfolio, 4% SWR ($200k) easily covers $12k/yr to 70 at 0 real growth.
    const r = solve({ targetRetirementAge: 40, currentPortfolioCents: 500_000_000 });
    expect(r.outcome).toBe('already-on-track');
    expect(r.requiredAdditionalMonthlyCents).toBe(0);
  });
});

describe('solveRetireAtAge — minimality (independent oracle, incl. real compounding)', () => {
  const cases: { name: string; over: Partial<RetireAtAgeInput> }[] = [
    { name: 'RA-0PCT', over: {} },
    { name: 'RA-CURRENT', over: { monthlyContributionCents: 50_000 } },
    { name: 'RA-D near-term', over: { targetRetirementAge: 41, endAge: 61, safeToSpendCents: 100_000 } },
    {
      // Real compounding (nominal 7% − inflation 2.5% = 4.5% real): no closed form,
      // the bisection MUST find the exact minimum over the engine.
      name: 'RA-GROWTH',
      over: {
        targetRetirementAge: 65,
        endAge: 95,
        currentPortfolioCents: 10_000_000,
        annualRetirementSpendingCents: 4_000_000,
        nominalReturnBps: 700,
        inflationBps: 250,
        safeToSpendCents: 500_000,
      },
    },
  ];

  for (const c of cases) {
    it(`${c.name}: required sustains and required-1 does not`, () => {
      const input = base(c.over);
      const r = solveRetireAtAge(input);
      expect(r.outcome).toBe('reachable');
      const required = r.requiredMonthlyContributionCents as number;
      expect(required).not.toBeNull();
      expect(sustainsIndependently(input, required)).toBe(true);
      expect(sustainsIndependently(input, required - 1)).toBe(false);
    });
  }
});

describe('solveRetireAtAge — monotonicity (the property the bisection rests on)', () => {
  it('the sustained predicate flips false→true once as the contribution rises (real growth)', () => {
    const input = base({
      targetRetirementAge: 65,
      endAge: 95,
      currentPortfolioCents: 10_000_000,
      annualRetirementSpendingCents: 4_000_000,
      nominalReturnBps: 700,
      inflationBps: 250,
    });
    let seenSustained = false;
    for (let monthly = 0; monthly <= 5_000_000; monthly += 50_000) {
      const ok = sustainsIndependently(input, monthly);
      if (seenSustained) {
        // once sustained, more money must never un-sustain it
        expect(ok, `@ ${monthly}`).toBe(true);
      }
      if (ok) seenSustained = true;
    }
    expect(seenSustained).toBe(true);
  });
});
