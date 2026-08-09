/**
 * Wealth-target planner — the FOURTH inverse planner, after debt-free-by-date (#125),
 * savings-goal-by-date (#126) and retire-at-age (#131).
 *
 * The question none of the three could answer: **"I want $10M. What do I need to do?"**
 *
 * Why a fourth solver rather than a reuse. The app's existing wealth math is
 * EXPENSE-DRIVEN: the FI number is `annualExpenses × (10000 / swrBps)`, so the target is
 * always derived from how much you spend and can never be a figure the reader names.
 * The one solver that DOES take a stated amount — `solveSavingsGoalByDate` — is
 * deliberately LINEAR (`ceil(remaining / months)`, no growth) because it mirrors the
 * /goals card's flat model for near-term envelopes. Pointing that solver at $10,000,000
 * would answer a 30-year investing question with a model that earns nothing: it would
 * demand $27,777/month where compounding needs a fraction of it. A stated wealth target
 * is an INVESTING question and must be answered with the investing model.
 *
 * It originates NO new money math. Both directions are the tested FI primitives:
 *   - "when do I get there at my current rate?"  →  `monthsToFI` (#3)
 *   - "what must I contribute to get there by N?" →  `coastFI`'s bisection (#3)
 * so a target that equals the reader's FI number answers identically to the FI card at
 * the same dials — the #125/#126/#131 card-vs-solver consistency rule, applied again.
 *
 * THE BASIS, STATED ONCE (and rendered inline wherever a figure from here is shown):
 * every figure is in TODAY'S DOLLARS. The growth rate is the REAL return
 * `realReturnBps(nominal, inflation)` — the same derivation, from the same shared helper,
 * that the /investments outlook uses. A reader who says "$10 million" means $10 million
 * they can spend, not a nominal number that 2.5% inflation has quietly halved over
 * thirty years, and answering a multi-decade target at a nominal rate against a
 * present-value goal is the one error that would make every number here optimistic.
 * (The two /coach cards SHARE this basis: W.2 — DECISIONS #361 — moved the FI card off
 * the nominal dial onto the same `realReturnBps`, so it too grows a portfolio toward a
 * present-value target in today's dollars. What differs between the cards is the
 * DESTINATION, not the rate — the FI card aims at a number built from what the reader
 * already spends, this one at the number they typed. `COACH_COPY.wealthTargetVsFiCard`
 * renders exactly that claim, and the audit's P2 note is now retired: the earlier
 * version of this NOTE documented a divergence that no longer exists, and a future
 * change that moves either card off the shared basis must rewrite that sentence and
 * this note together.)
 *
 * Pure & deterministic: integer cents in, integer cents out, no I/O, no `new Date()`.
 */
import { coastFI, monthsToFI } from '@/lib/engine/fi/fi';
import { isRealReturnFloored, realReturnBps } from '@/lib/engine/investments/retirement';
import { cents } from '@/lib/money';

export type WealthTargetOutcome =
  /** The portfolio is already at or past the target — nothing to solve. */
  | 'already-there'
  /** The stated goal can be met. Affordability is reported separately, never folded in here. */
  | 'reachable'
  /** The stated goal cannot be met at all (see `unreachableReason`). */
  | 'unreachable';

export type WealthTargetUnreachableReason =
  /**
   * No deadline was given and the current contribution never reaches the target within
   * the FI engine's 100-year cap — the honest "not on this trajectory", never a date.
   * The copy must name the CAP (100 years), not a softer paraphrase: the app computed a
   * strong fact and a vaguer sentence lets a reader infer a gentler one.
   */
  | 'beyond-horizon'
  /** A deadline was given that is under one whole contribution cycle away. */
  | 'deadline-too-soon'
  /**
   * The stated target is zero, negative, or beyond `MAX_TARGET_CENTS`. A boundary that
   * takes a typed number must BOUND it: `parseDollarInput` happily returns a valid safe
   * integer for a 14-digit paste, and the growth simulation then overflows `cents()` and
   * throws — inside a `useMemo` during render, which unwinds the whole page to the error
   * boundary. Refusing in the engine closes that by construction for every caller, rather
   * than asking each surface to remember a range check (#166's lesson, one level deeper).
   */
  | 'target-out-of-range'
  | null;

export interface WealthTargetInput {
  /** The target the reader STATED, integer cents, today's dollars (e.g. $10M → 1_000_000_000). */
  targetAmountCents: number;
  /**
   * The balance every projection here starts from, integer cents.
   *
   * The sole caller passes `coach.fi.portfolioCents`, which `getCoachData` builds from
   * `type === 'INVESTMENT'` accounts ONLY — checking and savings are a separate `liquid` sum and
   * are not in it. This doc previously read "investment portfolio + savings", which was never
   * true of any caller, and the difference is not cosmetic: it is the largest single input to
   * both answers, so a surface that renders a figure from here must say which accounts it counts
   * rather than inherit this comment's word for it.
   */
  currentPortfolioCents: number;
  /** What the reader is actually putting away each month today, integer cents. May be ≤ 0. */
  currentMonthlyContributionCents: number;
  /** The reader's NOMINAL expected-return dial, bps (User.expectedReturnBps, default 700). */
  nominalReturnBps: number;
  /** The reader's inflation dial, bps (User.inflationBps ?? RETIREMENT_ASSUMPTIONS.inflationBps). */
  inflationBps: number;
  /**
   * Monthly income, integer cents, for the required-SAVINGS-RATE answer. The same pattern
   * income the spending plan divides by, so a rate shown here means what /coach's savings
   * rate means. ≤ 0 → every rate field is null (never a fabricated percentage).
   */
  monthlyIncomeCents: number;
  /** Monthly safe-to-spend, integer cents. May be ≤ 0 (overspent); share/affordability then null. */
  safeToSpendCents: number;
  /**
   * Whole months until the reader's stated deadline, or null for the open-ended question
   * ("when do I get there?"). The caller converts an age or a date; this engine takes no
   * clock and no calendar.
   */
  deadlineMonths: number | null;
}

/** One row of the "how much does the return assumption decide this?" table. */
export interface WealthTargetSensitivityPoint {
  /** The NOMINAL dial this row assumes, bps — what the reader would type in settings. */
  nominalReturnBps: number;
  /** The real rate it deflates to at the reader's own inflation dial, bps. */
  realReturnBps: number;
  /** Months to the target at the CURRENT contribution under this rate; null = beyond the cap. */
  monthsAtCurrentRate: number | null;
  /** True when `realReturnBps` is the FLOOR rather than the subtraction (see `realReturnFloored`). */
  realReturnFloored: boolean;
}

/**
 * The largest target this engine will answer, $1 trillion. Chosen to sit far above any
 * real goal and far below the point where the growth simulation can leave safe-integer
 * range: `monthsToFI` stops the first month the balance reaches the target, so the largest
 * value it ever materializes is bounded by roughly `target × (1 + monthly rate) + monthly`,
 * which at this cap is ~2e14 — two orders of magnitude inside `Number.MAX_SAFE_INTEGER`.
 */
export const MAX_TARGET_CENTS = 100_000_000_000_000;

export interface WealthTargetResult {
  outcome: WealthTargetOutcome;
  /** Echo of the stated target, floored at 0. */
  targetAmountCents: number;
  /**
   * The portfolio the projection starts from, floored at 0. Carried because the
   * already-there sentence is ABOUT the portfolio: printing the target there names a figure
   * the reader typed and calls it what they have.
   */
  currentPortfolioCents: number;
  /** max(0, target − portfolio) — what is still to be accumulated. */
  remainingCents: number;
  /** The real rate every figure here was computed at, bps. Rendered inline, never hidden. */
  realReturnBps: number;
  /**
   * True when the reader's return assumption is at or BELOW their inflation assumption, so
   * `realReturnBps` is `realReturnBps()`'s floor of 0 rather than the subtraction.
   *
   * This has to reach the surface, for two separate reasons. The copy prints both operands
   * beside the result, and "assuming 0.00% growth after inflation — your 7.00% return
   * assumption less 10.00% inflation" is arithmetic the reader can do in their head and get
   * a different answer. And a floored 0 is OPTIMISTIC: the truth is a negative real return,
   * so every date computed at 0 arrives sooner than it would — at 7%/10% a $2M target reads
   * 29 years against a real 87. A projection built on a floor must say so rather than
   * quietly present the floor as the assumption.
   */
  realReturnFloored: boolean;
  /** The contribution the plan starts from, floored at 0. */
  currentMonthlyContributionCents: number;
  /**
   * True when the reader's actual monthly saving was ≤ 0 (they are spending more than they
   * earn) and the simulation therefore ran on a floored $0. The FI card one component up
   * REFUSES to project in this state ("a projection date wouldn't be honest"); a surface
   * here that printed "saving $0.00/month you'd get there in 31 years" would convert that
   * refusal into a date, so the flag exists to let the copy refuse the same way.
   */
  contributionFloored: boolean;
  /**
   * Months to the target at the CURRENT contribution. 0 when already there; null when it
   * does not arrive within the FI engine's cap — the honest gap, never an invented date.
   */
  monthsAtCurrentRate: number | null;
  /** Echo of the stated deadline in whole months (null when none was given). */
  deadlineMonths: number | null;
  /**
   * Minimal level monthly contribution that lands the target by `deadlineMonths`.
   * 0 when already there; null when no deadline was stated or the deadline is too soon.
   */
  requiredMonthlyCents: number | null;
  /** The NEW money on top of today's rate: max(0, required − current). Null whenever required is. */
  requiredAdditionalMonthlyCents: number | null;
  /**
   * The required TOTAL contribution as a share of monthly income, bps — "you would need to
   * save 34% of what you earn". NOT clamped: over 10000 is the honest "more than you earn".
   * Null when income ≤ 0 or there is no required figure.
   */
  requiredSavingsRateBps: number | null;
  /** Today's contribution as a share of monthly income, bps, for the same comparison. Null when income ≤ 0. */
  currentSavingsRateBps: number | null;
  /**
   * The ADDITIONAL money as a share of monthly safe-to-spend, bps. NOT clamped — over 10000
   * is the honest "more than your whole safe-to-spend". Null when safe-to-spend ≤ 0.
   */
  shareOfSafeToSpendBps: number | null;
  /** Does the additional money fit inside monthly safe-to-spend? Null when not applicable. */
  withinSafeToSpend: boolean | null;
  /**
   * The same "when at the current rate" question at the reader's dial ±2 percentage points.
   * Always three rows, ordered low → base → high, and ALWAYS present (including when the
   * base case is unreachable, which is exactly when the spread is most worth seeing).
   * This is the assumptions guardrail made quantitative: a target three decades out is
   * decided as much by the rate you assumed as by the money you save, and a single
   * confident date hides that.
   */
  sensitivity: readonly WealthTargetSensitivityPoint[];
  unreachableReason: WealthTargetUnreachableReason;
}

/** The ±spread, in bps of NOMINAL return, used for the sensitivity rows. 200 bps = 2 pp. */
const SENSITIVITY_SPREAD_BPS = 200;

/**
 * Identical rule to the three inverse-planner siblings' `shareAndAffordability`
 * (DECISIONS #125/#126/#131): a display ratio in bps (not a materialized cent value, so no
 * Cents rounding rule applies), and an honest affordability flag. Replicated rather than
 * imported to keep this solver self-contained; the exact bps values are pinned in the test
 * suite so the four can't silently drift apart.
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

/** Share of income in bps, or null when there is no income to divide by. Never clamped. */
function rateOfIncomeBps(amountCents: number | null, monthlyIncomeCents: number): number | null {
  if (amountCents === null || monthlyIncomeCents <= 0) return null;
  return Math.round((amountCents / monthlyIncomeCents) * 10000);
}

/**
 * The narrowest and widest horizons a surface may offer, in whole years. Declared here rather
 * than in the card because `seededHorizon` refuses outside them and a caller whose slider spanned
 * a different range would get a seed its own control could not display.
 */
export const MIN_HORIZON_YEARS = 1;
export const MAX_HORIZON_YEARS = 40;

/**
 * Where a "I want it in N years" control should OPEN, given the reader's own arrival.
 *
 * A constant default was the whole of the owner's "arbitrary time" complaint (2026-07-31): the
 * card chose 25 years, printed it in the same weight as the figures, and gave no way to tell a
 * number it had invented from one the reader had set. Seeded from the arrival, the card opens
 * self-consistent — the pace sentence and the required-contribution sentence describe the same
 * landing before anything is touched.
 *
 * `ceil`, never `round`: the opening year must not fall EARLIER than the pace actually lands, or
 * the card greets the reader by demanding money on top of a pace it has just called sufficient.
 *
 * Three inputs REFUSE the seed, and `seeded: false` is the honest third state rather than a
 * clamp — each refusal is a case where the arrival is a number the surface declines to print, and
 * a slider silently parked on it would reintroduce that number as a position:
 *   - `contributionFloored`: nothing is going in, so there is no pace to seed from and the card
 *     refuses a date in the sentence above (`wealthTargetNotSaving`).
 *   - `monthsAtCurrentRate === null`: no arrival inside the FI engine's 100-year cap.
 *   - beyond `MAX_HORIZON_YEARS`: clamping a 70-year arrival down to the control's 40-year
 *     ceiling would present the ceiling as the reader's trajectory — the `a-clamped-output-may-
 *     not-print-its-inputs` shape, one control over.
 */
export function seededHorizon(
  monthsAtCurrentRate: number | null,
  contributionFloored: boolean,
): { years: number; seeded: boolean } {
  if (contributionFloored || monthsAtCurrentRate === null) {
    return { years: FALLBACK_HORIZON_YEARS, seeded: false };
  }
  const years = Math.ceil(monthsAtCurrentRate / 12);
  if (years < MIN_HORIZON_YEARS || years > MAX_HORIZON_YEARS) {
    return { years: FALLBACK_HORIZON_YEARS, seeded: false };
  }
  return { years, seeded: true };
}

/**
 * The horizon used only where the reader's own pace cannot supply one. A fallback, never a
 * recommendation — every surface that opens on it must say so (`wealthTargetHorizonBasis`).
 */
export const FALLBACK_HORIZON_YEARS = 25;

export function solveWealthTarget(input: WealthTargetInput): WealthTargetResult {
  const targetAmountCents = Math.max(0, Math.floor(input.targetAmountCents));
  const portfolio = Math.max(0, Math.floor(input.currentPortfolioCents));
  const rawMonthly = Math.floor(input.currentMonthlyContributionCents);
  const currentMonthly = Math.max(0, rawMonthly);
  const contributionFloored = rawMonthly <= 0;
  const remainingCents = Math.max(0, targetAmountCents - portfolio);
  const realBps = realReturnBps(input.nominalReturnBps, input.inflationBps);
  const realReturnFloored = isRealReturnFloored(input.nominalReturnBps, input.inflationBps);
  const currentSavingsRateBps = rateOfIncomeBps(currentMonthly, input.monthlyIncomeCents);

  // The ±2pp table is built for EVERY outcome, including the unreachable ones: "you don't
  // get there at 4.5% but you do in 31 years at 6.5%" is the most decision-useful thing
  // this engine can say, and it is exactly the case a single answer would suppress.
  // Out of range, it is built empty rather than wrong — a table of dates for a target the
  // engine refused to answer would be three claims about a question it declined.
  const outOfRange = targetAmountCents <= 0 || targetAmountCents > MAX_TARGET_CENTS;
  const sensitivity: WealthTargetSensitivityPoint[] = outOfRange
    ? []
    : [-SENSITIVITY_SPREAD_BPS, 0, SENSITIVITY_SPREAD_BPS].map((delta) => {
        const nominal = Math.max(0, input.nominalReturnBps + delta);
        const real = realReturnBps(nominal, input.inflationBps);
        return {
          nominalReturnBps: nominal,
          realReturnBps: real,
          realReturnFloored: isRealReturnFloored(nominal, input.inflationBps),
          monthsAtCurrentRate:
            portfolio >= targetAmountCents
              ? 0
              : monthsToFI(cents(portfolio), cents(currentMonthly), real, cents(targetAmountCents)),
        };
      });

  const base = {
    targetAmountCents,
    currentPortfolioCents: portfolio,
    remainingCents,
    realReturnBps: realBps,
    realReturnFloored,
    currentMonthlyContributionCents: currentMonthly,
    contributionFloored,
    deadlineMonths: input.deadlineMonths,
    currentSavingsRateBps,
    sensitivity,
  };

  // Bound the typed number BEFORE any simulation touches it. Zero and negative are refused
  // for a different reason than the ceiling: flooring them to 0 made the engine answer
  // "you're already there" — a claim about the reader's portfolio built from a figure they
  // typed, printed to someone with a six-figure balance.
  if (outOfRange) {
    return {
      ...base,
      outcome: 'unreachable',
      monthsAtCurrentRate: null,
      requiredMonthlyCents: null,
      requiredAdditionalMonthlyCents: null,
      requiredSavingsRateBps: null,
      shareOfSafeToSpendBps: null,
      withinSafeToSpend: null,
      unreachableReason: 'target-out-of-range',
    };
  }

  // Already at the target: a $0 contribution is trivially affordable, and the answer is the
  // same whether or not a deadline was stated.
  if (remainingCents <= 0) {
    const { shareOfSafeToSpendBps, withinSafeToSpend } = shareAndAffordability(0, input.safeToSpendCents);
    return {
      ...base,
      outcome: 'already-there',
      monthsAtCurrentRate: 0,
      requiredMonthlyCents: 0,
      requiredAdditionalMonthlyCents: 0,
      requiredSavingsRateBps: rateOfIncomeBps(0, input.monthlyIncomeCents),
      shareOfSafeToSpendBps,
      withinSafeToSpend,
      unreachableReason: null,
    };
  }

  const monthsAtCurrentRate = monthsToFI(
    cents(portfolio),
    cents(currentMonthly),
    realBps,
    cents(targetAmountCents),
  );

  // ---- Open-ended: "when do I get there?" ----------------------------------------------
  // The stated goal is arrival at the current rate, so the cap being hit IS the answer
  // being no. Nothing is required and nothing is affordable — those fields belong to a
  // deadline that was never given, and inventing them would answer a question nobody asked.
  if (input.deadlineMonths === null) {
    return {
      ...base,
      outcome: monthsAtCurrentRate === null ? 'unreachable' : 'reachable',
      monthsAtCurrentRate,
      requiredMonthlyCents: null,
      requiredAdditionalMonthlyCents: null,
      requiredSavingsRateBps: null,
      shareOfSafeToSpendBps: null,
      withinSafeToSpend: null,
      unreachableReason: monthsAtCurrentRate === null ? 'beyond-horizon' : null,
    };
  }

  // ---- Deadline stated: "what must I put away to land it by then?" ---------------------
  // Refuse under one whole contribution cycle rather than invent a figure — the same
  // refusal, for the same reason, as the savings-goal twin's `targetMonths < 1`.
  if (input.deadlineMonths < 1) {
    return {
      ...base,
      outcome: 'unreachable',
      monthsAtCurrentRate,
      requiredMonthlyCents: null,
      requiredAdditionalMonthlyCents: null,
      requiredSavingsRateBps: null,
      shareOfSafeToSpendBps: null,
      withinSafeToSpend: null,
      unreachableReason: 'deadline-too-soon',
    };
  }

  // `coastFI` already bisects exactly this: the minimal level monthly contribution that
  // reaches a target within N months, simulated through the SAME `monthsToFI` used above,
  // so the two halves of this answer cannot disagree. It returns null for the required
  // figure when the portfolio coasts there alone — which is a required contribution of 0,
  // not an absent one.
  const coast = coastFI(
    cents(portfolio),
    cents(targetAmountCents),
    realBps,
    input.deadlineMonths,
  );
  const requiredMonthlyCents = coast.isCoastFI ? 0 : (coast.requiredMonthlyContributionCents ?? 0);
  const requiredAdditionalMonthlyCents = Math.max(0, requiredMonthlyCents - currentMonthly);
  const { shareOfSafeToSpendBps, withinSafeToSpend } = shareAndAffordability(
    requiredAdditionalMonthlyCents,
    input.safeToSpendCents,
  );

  return {
    ...base,
    outcome: 'reachable',
    monthsAtCurrentRate,
    requiredMonthlyCents,
    requiredAdditionalMonthlyCents,
    requiredSavingsRateBps: rateOfIncomeBps(requiredMonthlyCents, input.monthlyIncomeCents),
    shareOfSafeToSpendBps,
    withinSafeToSpend,
    unreachableReason: null,
  };
}
