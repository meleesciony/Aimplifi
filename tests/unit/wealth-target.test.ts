/**
 * Wealth-target planner — the fourth inverse planner (docs/EDGE_CASES.md §Wealth-target).
 *
 * Two kinds of assertion, deliberately separated:
 *  - HAND-VERIFIED anchors at a zero real return, where the arithmetic is exact and can be
 *    checked on paper ($1,000/month with no growth reaches $120,000 in exactly 120 months).
 *  - An INDEPENDENT CLOSED-FORM ORACLE for the compounding cases. The engine simulates
 *    month by month and rounds each month; the oracle is the ordinary-annuity formula
 *    FV(n) = P(1+i)^n + C((1+i)^n − 1)/i written out here from scratch, importing nothing
 *    from the engine. Pinning the engine against its own output would assert nothing, so
 *    the growth answers are checked against maths the engine does not share.
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_TARGET_CENTS,
  solveWealthTarget,
  type WealthTargetInput,
} from '@/lib/engine/solve/wealth-target';

const TEN_MILLION = 10_000_000_00;

/** A complete input; each test overrides only the fields it is about. */
function input(over: Partial<WealthTargetInput> = {}): WealthTargetInput {
  return {
    targetAmountCents: TEN_MILLION,
    currentPortfolioCents: 250_000_00,
    currentMonthlyContributionCents: 5_000_00,
    nominalReturnBps: 700,
    inflationBps: 250,
    monthlyIncomeCents: 15_000_00,
    safeToSpendCents: 3_000_00,
    deadlineMonths: null,
    ...over,
  };
}

/**
 * The oracle: months for P plus C/month at annual rate `annualBps` to first reach `target`,
 * by the ordinary-annuity closed form. Independent of the engine (no repo imports); returns
 * null for a zero rate, where the formula divides by zero and the hand anchors apply instead.
 */
function monthsByClosedForm(P: number, C: number, annualBps: number, target: number): number | null {
  if (annualBps <= 0) return null;
  const i = Math.pow(1 + annualBps / 10000, 1 / 12) - 1;
  for (let n = 1; n <= 1200; n++) {
    const growth = Math.pow(1 + i, n);
    if (P * growth + (C * (growth - 1)) / i >= target) return n;
  }
  return null;
}

describe('solveWealthTarget — hand-verified anchors at zero real growth', () => {
  it('$1,000/month with no real growth reaches $120,000 in exactly 120 months', () => {
    const r = solveWealthTarget(
      input({
        targetAmountCents: 120_000_00,
        currentPortfolioCents: 0,
        currentMonthlyContributionCents: 1_000_00,
        nominalReturnBps: 250,
        inflationBps: 250, // real return floors to 0
        deadlineMonths: null,
      }),
    );
    expect(r.realReturnBps).toBe(0);
    expect(r.outcome).toBe('reachable');
    expect(r.monthsAtCurrentRate).toBe(120);
  });

  it('the same target by month 120 requires exactly $1,000/month — and $1 less misses', () => {
    const r = solveWealthTarget(
      input({
        targetAmountCents: 120_000_00,
        currentPortfolioCents: 0,
        currentMonthlyContributionCents: 0,
        nominalReturnBps: 250,
        inflationBps: 250,
        monthlyIncomeCents: 5_000_00,
        deadlineMonths: 120,
      }),
    );
    expect(r.requiredMonthlyCents).toBe(1_000_00);
    expect(r.requiredAdditionalMonthlyCents).toBe(1_000_00);
    // Minimality oracle (the sibling solvers' convention): one cent less must not arrive.
    const oneCentLess = solveWealthTarget(
      input({
        targetAmountCents: 120_000_00,
        currentPortfolioCents: 0,
        currentMonthlyContributionCents: 1_000_00 - 1,
        nominalReturnBps: 250,
        inflationBps: 250,
        deadlineMonths: null,
      }),
    );
    expect(oneCentLess.monthsAtCurrentRate).toBeGreaterThan(120);
    // $1,000 of a $5,000 income is 20% saved.
    expect(r.requiredSavingsRateBps).toBe(2000);
  });
});

describe('solveWealthTarget — the $10M question, against an independent closed form', () => {
  it('agrees with the annuity formula at the reader real rate (4.5%)', () => {
    const r = solveWealthTarget(input());
    expect(r.realReturnBps).toBe(450); // 700 nominal − 250 inflation
    const oracle = monthsByClosedForm(250_000_00, 5_000_00, 450, TEN_MILLION);
    expect(oracle).toBe(533);
    // The engine rounds every month, the oracle does not, so they may differ by a month —
    // never more. A wider gap means the simulation and the formula have really diverged.
    expect(r.monthsAtCurrentRate).not.toBeNull();
    expect(Math.abs((r.monthsAtCurrentRate as number) - (oracle as number))).toBeLessThanOrEqual(1);
  });

  it('answers the deadline form: what it takes to land $10M in 25 years', () => {
    const r = solveWealthTarget(input({ deadlineMonths: 300 }));
    expect(r.outcome).toBe('reachable');
    const required = r.requiredMonthlyCents as number;
    expect(required).toBeGreaterThan(0);
    // Minimality, proven through the OPEN-ENDED path (a different branch of the engine):
    // the solved contribution arrives by the deadline and one cent less does not.
    const at = solveWealthTarget(
      input({ currentMonthlyContributionCents: required, deadlineMonths: null }),
    );
    const below = solveWealthTarget(
      input({ currentMonthlyContributionCents: required - 1, deadlineMonths: null }),
    );
    expect(at.monthsAtCurrentRate).not.toBeNull();
    expect(at.monthsAtCurrentRate as number).toBeLessThanOrEqual(300);
    expect(below.monthsAtCurrentRate === null || (below.monthsAtCurrentRate as number) > 300).toBe(true);
    // It needs more than today's $5,000, and the extra is reported against safe-to-spend.
    expect(r.requiredAdditionalMonthlyCents).toBe(Math.max(0, required - 5_000_00));
    expect(r.requiredSavingsRateBps).toBe(Math.round((required / 15_000_00) * 10000));
  });

  it('does not clamp a required rate that exceeds income, and says it does not fit', () => {
    // $10M in five years is far beyond a $15,000 income — the honest signal is a rate over
    // 100%, not a capped one that reads as merely ambitious.
    const r = solveWealthTarget(input({ deadlineMonths: 60 }));
    expect(r.outcome).toBe('reachable'); // the arithmetic has an answer; affordability is separate
    expect(r.requiredSavingsRateBps as number).toBeGreaterThan(10000);
    expect(r.withinSafeToSpend).toBe(false);
    expect(r.shareOfSafeToSpendBps as number).toBeGreaterThan(10000);
  });
});

describe('solveWealthTarget — refusals and the zeros', () => {
  it('already at the target solves nothing and requires nothing', () => {
    const r = solveWealthTarget(input({ currentPortfolioCents: TEN_MILLION }));
    expect(r.outcome).toBe('already-there');
    expect(r.remainingCents).toBe(0);
    expect(r.monthsAtCurrentRate).toBe(0);
    expect(r.requiredMonthlyCents).toBe(0);
    expect(r.requiredAdditionalMonthlyCents).toBe(0);
  });

  it('no growth and nothing saved is "beyond horizon", never a date', () => {
    const r = solveWealthTarget(
      input({
        currentMonthlyContributionCents: 0,
        nominalReturnBps: 250,
        inflationBps: 250,
        deadlineMonths: null,
      }),
    );
    expect(r.outcome).toBe('unreachable');
    expect(r.unreachableReason).toBe('beyond-horizon');
    expect(r.monthsAtCurrentRate).toBeNull();
    // The open-ended question was asked, so nothing is "required" — those fields belong to
    // a deadline that was never stated.
    expect(r.requiredMonthlyCents).toBeNull();
    expect(r.requiredSavingsRateBps).toBeNull();
  });

  it('a deadline under one month is refused rather than answered', () => {
    const r = solveWealthTarget(input({ deadlineMonths: 0 }));
    expect(r.outcome).toBe('unreachable');
    expect(r.unreachableReason).toBe('deadline-too-soon');
    expect(r.requiredMonthlyCents).toBeNull();
  });

  it('no income means no savings-rate claim at all', () => {
    const r = solveWealthTarget(input({ monthlyIncomeCents: 0, deadlineMonths: 300 }));
    expect(r.currentSavingsRateBps).toBeNull();
    expect(r.requiredSavingsRateBps).toBeNull();
    expect(r.requiredMonthlyCents).not.toBeNull(); // the money answer still stands
  });

  it('no safe-to-spend means no affordability claim at all', () => {
    const r = solveWealthTarget(input({ safeToSpendCents: 0, deadlineMonths: 300 }));
    expect(r.shareOfSafeToSpendBps).toBeNull();
    expect(r.withinSafeToSpend).toBeNull();
  });
});

describe('solveWealthTarget — the return assumption is shown, not hidden', () => {
  it('always returns three rows, low → base → high, monotone in the rate', () => {
    const r = solveWealthTarget(input());
    expect(r.sensitivity).toHaveLength(3);
    expect(r.sensitivity.map((s) => s.nominalReturnBps)).toEqual([500, 700, 900]);
    expect(r.sensitivity.map((s) => s.realReturnBps)).toEqual([250, 450, 650]);
    const months = r.sensitivity.map((s) => s.monthsAtCurrentRate as number);
    // A higher return can only reach a target sooner.
    expect(months[0]).toBeGreaterThan(months[1]);
    expect(months[1]).toBeGreaterThan(months[2]);
    // Each row checked against the independent closed form (62y3m / 44y5m / 35y2m).
    expect(monthsByClosedForm(250_000_00, 5_000_00, 250, TEN_MILLION)).toBe(747);
    expect(monthsByClosedForm(250_000_00, 5_000_00, 650, TEN_MILLION)).toBe(422);
    months.forEach((m, idx) => {
      const oracle = monthsByClosedForm(250_000_00, 5_000_00, [250, 450, 650][idx], TEN_MILLION);
      expect(Math.abs(m - (oracle as number))).toBeLessThanOrEqual(1);
    });
  });

  it('is present even when the base case is unreachable — that is when it matters most', () => {
    // $250,000 sitting still, no contribution, against $1M. At a 0% real return it never
    // arrives; two points of real growth gets there. "Unreachable at your assumption,
    // reachable at a plausible one" is precisely the answer a single date would suppress.
    const r = solveWealthTarget(
      input({
        targetAmountCents: 1_000_000_00,
        currentMonthlyContributionCents: 0,
        nominalReturnBps: 250,
        inflationBps: 250,
      }),
    );
    expect(r.outcome).toBe('unreachable');
    expect(r.unreachableReason).toBe('beyond-horizon');
    expect(r.sensitivity).toHaveLength(3);
    expect(r.sensitivity.map((s) => s.realReturnBps)).toEqual([0, 0, 200]);
    expect(r.sensitivity[0].monthsAtCurrentRate).toBeNull();
    expect(r.sensitivity[1].monthsAtCurrentRate).toBeNull();
    const high = r.sensitivity[2].monthsAtCurrentRate;
    expect(high).not.toBeNull();
    expect(Math.abs((high as number) - (monthsByClosedForm(250_000_00, 0, 200, 1_000_000_00) as number)))
      .toBeLessThanOrEqual(1);
  });

  it('a target beyond every plausible rate stays honestly unreachable on all three rows', () => {
    const r = solveWealthTarget(
      input({ currentMonthlyContributionCents: 0, nominalReturnBps: 250, inflationBps: 250 }),
    );
    expect(r.outcome).toBe('unreachable');
    expect(r.sensitivity.every((s) => s.monthsAtCurrentRate === null)).toBe(true);
  });
});

/**
 * The defects two hostile critics found, locked. Each of these passed the original suite:
 * the arithmetic was right and the BOUNDARY was missing, which is why the locks are about
 * refusal and about flags reaching the surface rather than about numbers.
 */
describe('solveWealthTarget — the boundary refuses instead of throwing', () => {
  it('a 14-digit typed target is refused, not simulated into a safe-integer throw', () => {
    // parseDollarInput("90000000000000") returns a VALID safe integer, so nothing upstream
    // rejects it; the growth simulation then overflowed cents() and threw inside a render.
    const r = solveWealthTarget(input({ targetAmountCents: 9_000_000_000_000_000 }));
    expect(r.outcome).toBe('unreachable');
    expect(r.unreachableReason).toBe('target-out-of-range');
    expect(r.sensitivity).toEqual([]);
  });

  it('refuses every horizon at an out-of-range target (it presented as "the slider broke")', () => {
    for (const years of [1, 5, 25, 40]) {
      const r = solveWealthTarget(
        input({ targetAmountCents: 9_000_000_000_000_000, deadlineMonths: years * 12 }),
      );
      expect(r.unreachableReason, `${years}y`).toBe('target-out-of-range');
    }
  });

  it('accepts the largest in-range target and refuses one cent above it', () => {
    expect(solveWealthTarget(input({ targetAmountCents: MAX_TARGET_CENTS })).unreachableReason).not.toBe(
      'target-out-of-range',
    );
    expect(
      solveWealthTarget(input({ targetAmountCents: MAX_TARGET_CENTS + 1 })).unreachableReason,
    ).toBe('target-out-of-range');
  });

  it('a zero or negative target is refused rather than floored into "already there"', () => {
    // Flooring made the engine answer "you're already at $0.00" to a reader with a
    // six-figure portfolio — a claim about their money built from a typo.
    for (const target of [0, -500, -1]) {
      const r = solveWealthTarget(input({ targetAmountCents: target }));
      expect(r.outcome, String(target)).toBe('unreachable');
      expect(r.unreachableReason, String(target)).toBe('target-out-of-range');
    }
  });
});

describe('solveWealthTarget — the flags a floor must not hide', () => {
  it('reports a floored real return instead of presenting the floor as the assumption', () => {
    const r = solveWealthTarget(input({ nominalReturnBps: 700, inflationBps: 1000 }));
    expect(r.realReturnBps).toBe(0); // the shared helper's floor
    expect(r.realReturnFloored).toBe(true);
    // Every sensitivity row floors too, which is what makes the table degenerate.
    expect(r.sensitivity.every((s) => s.realReturnFloored)).toBe(true);
    expect(new Set(r.sensitivity.map((s) => s.realReturnBps)).size).toBe(1);
  });

  it('does not claim a floor when the subtraction is genuine', () => {
    const r = solveWealthTarget(input());
    expect(r.realReturnFloored).toBe(false);
    expect(r.sensitivity.map((s) => s.realReturnFloored)).toEqual([false, false, false]);
  });

  it('reports a floored contribution so the surface can refuse the way the FI card does', () => {
    const r = solveWealthTarget(input({ currentMonthlyContributionCents: -50_000 }));
    expect(r.currentMonthlyContributionCents).toBe(0);
    expect(r.contributionFloored).toBe(true);
    // The required figure still stands — the gap is the honest answer for an overspender.
    expect(r.requiredMonthlyCents).toBeNull(); // no deadline in the default input
    expect(solveWealthTarget(input({ currentMonthlyContributionCents: -50_000, deadlineMonths: 300 })).requiredMonthlyCents)
      .not.toBeNull();
  });

  it('a contribution of exactly zero is floored-flagged too — it is the same refusal', () => {
    expect(solveWealthTarget(input({ currentMonthlyContributionCents: 0 })).contributionFloored).toBe(true);
    expect(solveWealthTarget(input({ currentMonthlyContributionCents: 1 })).contributionFloored).toBe(false);
  });

  it('carries the portfolio so "already there" can name what the reader HAS', () => {
    const r = solveWealthTarget(input({ currentPortfolioCents: 1_200_000_00, targetAmountCents: 1_000_000_00 }));
    expect(r.outcome).toBe('already-there');
    expect(r.currentPortfolioCents).toBe(1_200_000_00);
    expect(r.targetAmountCents).toBe(1_000_000_00);
    expect(r.currentPortfolioCents).not.toBe(r.targetAmountCents);
  });

  it('leaves affordability NULL when there is no guilt-free figure to judge against', () => {
    // Negative safe-to-spend is a first-class state (`overspent`), not a fluke — and the
    // surface must not turn null into "false" and then format the negative as a pool.
    for (const stz of [-243_233, 0]) {
      const r = solveWealthTarget(input({ safeToSpendCents: stz, deadlineMonths: 300 }));
      expect(r.withinSafeToSpend, String(stz)).toBeNull();
      expect(r.shareOfSafeToSpendBps, String(stz)).toBeNull();
    }
  });
});

describe('solveWealthTarget — the base sensitivity row IS the headline', () => {
  it('the middle row equals the answer printed above it', () => {
    // Two figures for one question on one card is the repo's most-recorded defect class;
    // here they must agree by construction because both route through monthsToFI.
    const r = solveWealthTarget(input());
    expect(r.sensitivity[1].nominalReturnBps).toBe(700);
    expect(r.sensitivity[1].realReturnBps).toBe(r.realReturnBps);
    expect(r.sensitivity[1].monthsAtCurrentRate).toBe(r.monthsAtCurrentRate);
  });
});
