/**
 * Goals ↔ FI wiring (Phase 4): every goal shows its effect on the FI date.
 * A monthly goal contribution is cash diverted from FI savings while the goal
 * is funding, so the FI simulation runs with the reduced savings until the
 * goal completes, then at full savings — deterministic and unit-tested.
 */
import { type Cents, floorAtZero, roundHalfAwayFromZero, subCents } from '@/lib/money';
import { geometricMonthlyRate } from '@/lib/engine/fi/fi';

export interface GoalFIImpact {
  /** Months until the goal is fully funded at its monthly contribution (null = never). */
  monthsToGoal: number | null;
  /** Months to FI without the goal. */
  monthsToFIBaseline: number | null;
  /** Months to FI while funding the goal first. */
  monthsToFIWithGoal: number | null;
  /** The delay the goal adds to the FI date, in months (0 if none). */
  fiDelayMonths: number | null;
}

const MAX_MONTHS = 1200;

function simulate(
  portfolio: number,
  fiTarget: number,
  monthlyRate: number,
  savingsAt: (month: number) => number,
): number | null {
  if (portfolio >= fiTarget) return 0;
  let p = portfolio;
  for (let m = 1; m <= MAX_MONTHS; m++) {
    p = roundHalfAwayFromZero(p * (1 + monthlyRate)) + savingsAt(m);
    if (p >= fiTarget) return m;
  }
  return null;
}

export function goalFIImpact(params: {
  portfolioCents: Cents;
  monthlySavingsCents: Cents;
  annualReturnBps: number;
  fiTargetCents: Cents;
  goalRemainingCents: Cents; // target − saved
  goalMonthlyContributionCents: Cents;
}): GoalFIImpact {
  const {
    portfolioCents,
    monthlySavingsCents,
    annualReturnBps,
    fiTargetCents,
    goalRemainingCents,
    goalMonthlyContributionCents,
  } = params;

  const remaining = floorAtZero(goalRemainingCents);
  const monthsToGoal =
    remaining === 0
      ? 0
      : goalMonthlyContributionCents > 0
        ? Math.ceil(remaining / goalMonthlyContributionCents)
        : null;

  const i = geometricMonthlyRate(annualReturnBps);
  const baseline = simulate(portfolioCents, fiTargetCents, i, () => monthlySavingsCents);

  let withGoal: number | null = null;
  if (monthsToGoal !== null) {
    const reduced = floorAtZero(subCents(monthlySavingsCents, goalMonthlyContributionCents));
    withGoal = simulate(portfolioCents, fiTargetCents, i, (m) =>
      m <= monthsToGoal ? reduced : monthlySavingsCents,
    );
  }

  return {
    monthsToGoal,
    monthsToFIBaseline: baseline,
    monthsToFIWithGoal: withGoal,
    fiDelayMonths:
      baseline !== null && withGoal !== null ? Math.max(0, withGoal - baseline) : null,
  };
}
