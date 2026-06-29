/**
 * Inverse retirement planner (AI Differentiation Plan §1.1 "Plan in Words", DECISIONS #131).
 *
 * The third sibling of the inverse-planner family — after debt-free-by-date (#125) and
 * savings-goal-by-date (#126). Every other planner is FORWARD; this is INVERSE: state a
 * target retirement AGE ("can I retire at 60?") and SOLVE for the minimal monthly
 * contribution that makes the portfolio LAST through the plan-through age — then say
 * honestly whether that fits your real safe-to-spend, and refuse to invent a figure when
 * the age can't be reached.
 *
 * Pure & deterministic: integer cents in, integer cents out, no I/O, no `new Date()`. It
 * originates NO new money math. The "will it last" projection is the SAME tested
 * decumulation engine (#122 `projectRetirement`), assembled through the SAME
 * `buildRetirementInputs` builder the /investments outlook uses — so a plan solved here
 * is byte-identical to what the outlook card renders at the same dials (the #125/#126
 * card-vs-solver consistency lesson). The solver's ONLY origination is choosing the
 * contribution by bisection over that engine. Pinned to docs/EDGE_CASES.md §Retire-at-age.
 *
 * Why bisection (like the debt twin, unlike savings): the portfolio compounds, so
 * "minimal contribution that sustains" has no closed form and must be bisected over the
 * tested engine. We bisect the BOOLEAN `outcome === 'sustained'` predicate, NOT a cent
 * value: the engine's per-month half-away-from-zero rounding makes the balance only
 * WEAKLY monotone in the contribution, but the depleted→sustained flip is still strictly
 * one-directional (more money never turns a sustained plan into a depleted one), so the
 * predicate flips at most once and the bisection is exact. A minimality oracle
 * (`sustains(required)` true / `sustains(required−1)` false) pins this in the test suite.
 */
import {
  type RetirementProjection,
  buildRetirementInputs,
  projectRetirement,
} from '@/lib/engine/investments/retirement';

export type RetireAtAgeOutcome =
  /** Your current contribution rate already makes the portfolio last to the plan-through age. */
  | 'already-on-track'
  /** A finite monthly contribution makes it last by the target age. Affordability is reported separately. */
  | 'reachable'
  /** No contribution can make it work (see `unreachableReason`). */
  | 'unreachable';

export type RetireAtAgeUnreachableReason =
  /** The target age is before your current age — you can't retire in the past. */
  | 'age-in-past'
  /** The target age is after your plan-through (end) age — nothing to plan. */
  | 'age-after-end'
  /** Retiring now (target age == current age) and even an unbounded contribution can't land
   *  in time, so the seed portfolio alone can't cover the spend to the end age. */
  | 'cannot-sustain'
  | null;

export interface RetireAtAgeInput {
  /** The ONLY user-stated target — parsed from the question by parseTargetAge. */
  targetRetirementAge: number;
  // ---- grounded financial figures (server passes these from getCoachData(userId).fi) ----
  /** Investment-portfolio value today, integer cents (coach.fi.portfolioCents). */
  currentPortfolioCents: number;
  /** Current monthly savings rate, integer cents (coach.fi.monthlySavingsCents; may be ≤ 0). */
  monthlyContributionCents: number;
  /** Estimated annual retirement spending, integer cents (coach.fi.annualExpensesCents). */
  annualRetirementSpendingCents: number;
  /** The user's NOMINAL expected-return dial, bps (coach.fi.expectedReturnBps). */
  nominalReturnBps: number;
  /** Safe-withdrawal-rate dial, bps (coach.fi.swrBps), for the sustainable-withdrawal reference. */
  swrBps: number;
  // ---- grounded planning assumptions (server passes from User columns, ?? RETIREMENT_ASSUMPTIONS) ----
  currentAge: number;
  endAge: number;
  inflationBps: number;
  // ---- affordability ----
  /** Monthly safe-to-spend, integer cents. May be ≤ 0 (overspent); share/affordability then null. */
  safeToSpendCents: number;
}

export interface RetireAtAgeResult {
  outcome: RetireAtAgeOutcome;
  /** Echo of the user-stated target age. */
  retirementAge: number;
  /** max(0, targetRetirementAge − currentAge). */
  yearsToRetirement: number;
  /** The current monthly contribution the plan starts from, floored at 0. */
  currentMonthlyContributionCents: number;
  /**
   * Minimal TOTAL monthly contribution that sustains to the end age. Equals the current
   * rate for already-on-track; null only when unreachable.
   */
  requiredMonthlyContributionCents: number | null;
  /**
   * The NEW money on top of the current rate: max(0, required − current). 0 for
   * already-on-track; null when unreachable.
   */
  requiredAdditionalMonthlyCents: number | null;
  /**
   * requiredAdditional as a share of monthly safe-to-spend, in bps. NOT clamped — a value
   * over 10000 (>100%) is the honest "more than your whole safe-to-spend" signal. null when
   * safeToSpend ≤ 0 or there is no required figure.
   */
  shareOfSafeToSpendBps: number | null;
  /** Does the required additional fit inside monthly safe-to-spend? null when not applicable. */
  withinSafeToSpend: boolean | null;
  /** Projected portfolio value at retirement at the solved contribution (0 when unreachable). */
  balanceAtRetirementCents: number;
  /** swrBps applied to the balance at retirement — a sustainable reference (0 when unreachable). */
  sustainableAnnualWithdrawalCents: number;
  /** Echo of the planned annual spend (floored at 0). */
  plannedAnnualWithdrawalCents: number;
  /** Projected portfolio value at the end age at the solved contribution (0 when unreachable). */
  endBalanceCents: number;
  unreachableReason: RetireAtAgeUnreachableReason;
}

/** $10B/mo — beyond any real budget; bounds the bisection's upper search so a pathological
 *  input can never run away or overflow the engine's safe-integer guard. */
const HI_CAP_CENTS = 1_000_000_000_000;

/**
 * Identical rule to the inverse-planner twins' `shareAndAffordability` (DECISIONS #125/#126):
 * a display ratio in bps (not a materialized cent value, so no Cents rounding rule applies),
 * and an honest affordability flag. Replicated rather than imported to keep this solver
 * self-contained; the exact bps values are pinned in the test suite so the three can't drift.
 */
function shareAndAffordability(
  requiredCents: number | null,
  safeToSpendCents: number,
): { shareOfSafeToSpendBps: number | null; withinSafeToSpend: boolean | null } {
  if (requiredCents === null || safeToSpendCents <= 0) {
    return { shareOfSafeToSpendBps: null, withinSafeToSpend: null };
  }
  return {
    shareOfSafeToSpendBps: Math.round((requiredCents / safeToSpendCents) * 10000),
    withinSafeToSpend: requiredCents <= safeToSpendCents,
  };
}

export function solveRetireAtAge(input: RetireAtAgeInput): RetireAtAgeResult {
  const { targetRetirementAge, currentAge, endAge } = input;
  const currentMonthly = Math.max(0, Math.floor(input.monthlyContributionCents));
  const plannedAnnualWithdrawalCents = Math.max(0, Math.floor(input.annualRetirementSpendingCents));
  const yearsToRetirement = Math.max(0, targetRetirementAge - currentAge);

  // Run a candidate monthly contribution through the SAME tested engine the /investments
  // outlook uses. The solver never re-implements compounding/withdrawal/depletion math.
  const project = (monthly: number): RetirementProjection =>
    projectRetirement(
      buildRetirementInputs(
        {
          currentPortfolioCents: input.currentPortfolioCents,
          monthlyContributionCents: monthly,
          annualRetirementSpendingCents: input.annualRetirementSpendingCents,
          nominalReturnBps: input.nominalReturnBps,
          swrBps: input.swrBps,
        },
        {
          currentAge,
          retirementAge: targetRetirementAge,
          endAge,
          inflationBps: input.inflationBps,
        },
      ),
    );
  const sustains = (monthly: number): boolean => project(monthly).outcome === 'sustained';

  const unreachable = (reason: RetireAtAgeUnreachableReason): RetireAtAgeResult => ({
    outcome: 'unreachable',
    retirementAge: targetRetirementAge,
    yearsToRetirement,
    currentMonthlyContributionCents: currentMonthly,
    requiredMonthlyContributionCents: null,
    requiredAdditionalMonthlyCents: null,
    shareOfSafeToSpendBps: null,
    withinSafeToSpend: null,
    balanceAtRetirementCents: 0,
    sustainableAnnualWithdrawalCents: 0,
    plannedAnnualWithdrawalCents,
    endBalanceCents: 0,
    unreachableReason: reason,
  });

  // Pre-checks BEFORE touching the engine (which throws on retirementAge < currentAge or
  // retirementAge > endAge). These are the only genuinely "you can't plan this" cases.
  // Note `>=`: retiring AT the plan-through age is 0 retirement years (a vacuous "sustained"),
  // and the save validator rejects it (retirement must be strictly before plan-through), so the
  // answer must not offer a Save the server would reject — treat age == endAge as after-end too.
  if (targetRetirementAge < currentAge) return unreachable('age-in-past');
  if (targetRetirementAge >= endAge) return unreachable('age-after-end');

  // Build the answer at a solved contribution. `monthly` is the minimal TOTAL contribution;
  // the affordability share is computed on the ADDITIONAL money (required − current).
  const settle = (outcome: 'already-on-track' | 'reachable', monthly: number): RetireAtAgeResult => {
    const proj = project(monthly);
    const additional = Math.max(0, monthly - currentMonthly);
    const { shareOfSafeToSpendBps, withinSafeToSpend } = shareAndAffordability(
      additional,
      input.safeToSpendCents,
    );
    return {
      outcome,
      retirementAge: targetRetirementAge,
      yearsToRetirement,
      currentMonthlyContributionCents: currentMonthly,
      requiredMonthlyContributionCents: monthly,
      requiredAdditionalMonthlyCents: additional,
      shareOfSafeToSpendBps,
      withinSafeToSpend,
      balanceAtRetirementCents: proj.balanceAtRetirementCents,
      sustainableAnnualWithdrawalCents: proj.sustainableAnnualWithdrawalCents,
      plannedAnnualWithdrawalCents,
      endBalanceCents: proj.endBalanceCents,
      unreachableReason: null,
    };
  };

  // Already there: the current rate sustains. Mirrors the debt twin's 'on-track' (extra = 0).
  if (sustains(currentMonthly)) return settle('already-on-track', currentMonthly);

  // Retiring exactly now (target age == current age): accumulation has zero months, so no
  // contribution can ever land — the seed portfolio alone decides it, and it didn't sustain
  // above. Bisecting would be futile (and could run the upper bound to overflow), so stop here.
  if (targetRetirementAge === currentAge) return unreachable('cannot-sustain');

  // Find an upper bound that sustains. With ≥ 1 accumulation month an unbounded contribution
  // always sustains, so this converges quickly for any realistic input; the cap + iteration
  // limit are a safety backstop (a never-sustaining bound ⇒ honestly unreachable).
  let hi = Math.max(1, plannedAnnualWithdrawalCents) * 2;
  for (let doublings = 0; !sustains(hi) && hi < HI_CAP_CENTS && doublings < 60; doublings++) {
    hi = Math.min(hi * 2, HI_CAP_CENTS);
  }
  if (!sustains(hi)) return unreachable('cannot-sustain');

  // Lower-bound bisection for the smallest sustaining monthly. sustains(0) is false here
  // (the current rate ≥ 0 already failed), so the minimum lies in (0, hi].
  let lo = 0;
  for (let iter = 0; iter < 60 && lo < hi; iter++) {
    const mid = Math.floor((lo + hi) / 2);
    if (sustains(mid)) hi = mid;
    else lo = mid + 1;
  }
  return settle('reachable', lo);
}
