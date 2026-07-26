/**
 * Spending Plan engine (DECISIONS #66; #295/L.11(C) reframe; L.22 re-spec, owner
 * instruction 2026-07-26) — the "guilt-free spending" answer in the I Will Teach
 * You to Be Rich sense, computed as the owner stated it:
 *
 *   guilt-free = income (ALL sources, from the trailing pattern)
 *              − savings % of that income (set in Settings)
 *              − fixed and recurring expenses (the pattern, never discretionary)
 *              − card payment obligations already dated
 *
 * WHY THE CASH-MONTH MODEL WAS REPLACED (owner, verbatim: "your logic on guilt
 * free spending is broken, for one i don't have 22k or so income coming in...
 * that number should be taken from patterns you've detected over months of
 * income"). The old income term was this month's RECEIVED income plus detected
 * series × REMAINING OCCURRENCES — so a single large inflow the transfer-pairing
 * missed (a brokerage→checking movement with no category: `isIncomeFlowRow`
 * counts every uncategorized positive as income) landed whole in the month it
 * arrived, and a phantom series detected off repeated one-time inflows was
 * counted again per remaining occurrence. His July read $22,254.09 of "expected
 * income" against a household that does not have $22k coming, and the per-day
 * framing divided it by six remaining days into a $3,709.01/day invitation to
 * spend — beneath the app's own "$18,814.14 needed by Aug 5" (L.11(D)).
 *
 * THE PATTERN RULES:
 *  - Income is the MEDIAN of the last three COMPLETE months' income (all
 *    sources that actually arrived in a non-credit account). With three months
 *    behind it, a median ignores a one-time spike entirely — a $18k rollover
 *    touches no month but its own — where a mean would carry a third of it for
 *    three months. WITH FEWER THAN THREE the immunity does not hold (a median
 *    of one IS that month), so every surface qualifies the claim by
 *    `incomeMonths`, and two bounded lag directions are recorded rather than
 *    silently accepted: a brand-new job under-reads for a month or two (the
 *    SAFE direction), and a job LOSS over-reads until the zero months dominate
 *    — the income-pause radar flags that state on the same dashboard, and
 *    wiring the pause predicate into this basis is recorded as follow-up work
 *    in docs/STATUS.md §L.22. It includes every source the data shows (salary,
 *    dividends, side income). Rounding is Math.round (half-up), named here per
 *    the lib/stats contract (the shared median never re-rounds).
 *  - With no complete month of history yet, income falls back to the detected
 *    recurring income series at a monthly rate; with neither, 0 and the
 *    `incomeBasis: 'none'` fact — a surface may not invent an income.
 *  - Fixed/recurring expenses are the recurring outflows at a monthly
 *    rate (`monthlyRateCents`): weekly ×52/12, biweekly ×26/12, annual /12 — so
 *    an annual bill costs every month instead of none for eleven. The detected
 *    ANNUAL series reach this term since L.23 (`toScheduledTransactions` now
 *    projects annual EXPENSES; annual INCOME stays out, and the reason is
 *    written at that function). REMAINING GAP, recorded in docs/STATUS.md: a
 *    QUARTERLY or SEMIANNUAL bill contributes ZERO, because a ~91/182-day gap
 *    classifies as IRREGULAR in `cadenceFromGap` and `detectRecurring` drops
 *    it — the dangerous direction, and a new detection class rather than a
 *    passthrough. A purchase that is not a detected recurring series is NEVER
 *    fixed — discretionary spending subtracts nowhere in this plan (the owner's
 *    formula: "not discretionary or budgeted for").
 *  - Card payments stay REAL: the cash-needed engine's own obligation rows due
 *    this month, plus the L.11(D) beyond-month reservation for payments already
 *    dated past its edge. These are fixed commitments too, but they are actual
 *    dated statements/estimates, not a pattern — mixing them would be the
 *    borrowed-window error, so they ride as their own terms with their own
 *    estimate flags, exactly as L.11(C)/(D) left them.
 *  - Savings is the LARGER of named-goal contributions and the Settings
 *    savings-% target applied to the pattern income. The owner's formula names
 *    only the %; the max() is its safe superset — identical whenever goals ≤
 *    target, and never overstating guilt-free when goals exceed it.
 *
 * What died here, deliberately: `spentSoFarCents` (discretionary subtraction),
 * the received+remaining-occurrence income term, and the per-day framing
 * (`daysLeftInMonth`/`perDayCents`) that turned a monthly allocation into a
 * daily spending invitation. `leftToSpendCents` is now genuinely a MONTHLY
 * capacity — which is what the three inverse solvers always read it as
 * (L.11(D) residual 4 dissolves: the reading is no longer an approximation).
 *
 * Pure: integer cents in, integer cents out, no I/O, no `new Date()`.
 */
import { addDays, addMonthsClamped, type ISODate } from '@/lib/dates';
import { median } from '@/lib/stats';

/** Where the plan's income figure came from — every surface states it inline. */
export type IncomeBasis = 'trailing-median' | 'detected-series' | 'none';

/** A detected recurring series, as the plan consumes it (sign carries direction:
 *  negative = a bill/outflow, positive = income). */
export interface PlanScheduledItem {
  amountCents: number;
  cadence: string | null;
}

export interface SpendingPlanInput {
  today: ISODate;
  /** Complete prior calendar months' income, oldest → newest (up to 3 used),
   *  summed over non-credit accounts by the caller (monthlyFlows). Empty for a
   *  user with no complete month yet. */
  trailingMonthlyIncomeCents: number[];
  /** Detected recurring INCOME series — the fallback basis when no complete
   *  month exists. */
  scheduledIncome: PlanScheduledItem[];
  /** Detected recurring EXPENSE series (amountCents negative). */
  scheduledFixed: PlanScheduledItem[];
  /**
   * Card payment obligations whose effective due date falls in THIS calendar
   * month — the sum of the cash-needed engine's own `perDueDate` rows with
   * `date <= end of month`, so each statement is reserved against exactly one
   * month's income (its due month) and the rows can never disagree with the
   * cash-needed answer about what a card demands.
   */
  cardObligationsCents: number;
  /** True when any obligation summed into `cardObligationsCents` is the
   *  engine's ESTIMATE (no generated statement — the all-estimate state). */
  cardObligationsEstimated: boolean;
  /** Sum of active goals' monthly contributions. */
  goalContributionsCents: number;
  /** Pay-yourself-first target as basis points of pattern income (set in
   *  Settings). null = unset. */
  savingsTargetBps: number | null;
  /** Card payment obligations the engine HAS dated past this month's edge,
   *  reserved from the moment they are known (L.11(D) — a window has an edge,
   *  and money does not reset when it is crossed). */
  obligationsBeyondMonthCents: number;
  /** The payment day the beyond-month reservation is FOR, already formatted
   *  ("Wed, Aug 5"); null when the term is 0. */
  obligationsBeyondMonthThroughDate: string | null;
  /** True when any card inside `obligationsBeyondMonthCents` is an ESTIMATE. */
  obligationsBeyondMonthEstimated: boolean;
}

/** Which input decided `plannedSavingsCents` — for honest labeling only. */
export type SavingsSource = 'goals' | 'target';

/**
 * The facts a surface printing this plan's figure must be able to qualify it
 * with (the L.18 discipline: the fact rides the money, so no surface can lose
 * it). DATA, never copy — each surface builds its own sentence (the L.15
 * lesson). All three are resolved by the SERVER against the set the
 * card-payments term actually sums; the engine only carries the shape.
 */
export interface SpendingPlanDisclosures {
  /** Cards OWING a balance the engine could not date — EXCLUDED from the card
   *  term, so guilt-free may be OVERSTATED (the dangerous direction). */
  undatedCards: { cardName: string; frozenSince: string | null }[];
  /** Cards whose ESTIMATED obligation falls due this month but is excluded
   *  because another card has a real statement. Same direction; different
   *  mechanism (the statement has not been generated yet). */
  statementPendingCards: { cardName: string; dueDate: string }[];
  /** Suspected same-card-twice pairs where BOTH sides are inside the card
   *  term — if real, the term is inflated and guilt-free is UNDERSTATED.
   *  Advisory: no figure is adjusted (#192/#299 stance). */
  duplicatePairs: { aName: string; bName: string; confidence: 'high' | 'medium' }[];
  /** Cards inside the card term whose bank stopped sharing them — the
   *  subtracted amount rests on a statement/balance that stopped updating. */
  frozenCards: { label: string; frozenSince: string }[];
}

export interface SpendingPlan extends SpendingPlanInput {
  /** The income figure this plan runs on, derived from the pattern inputs. */
  patternIncomeCents: number;
  /** Which basis produced it. */
  incomeBasis: IncomeBasis;
  /** How many complete months a 'trailing-median' basis used (1–3). */
  incomeMonths: number;
  /** Fixed + recurring expenses at a monthly rate, derived from `scheduledFixed`. */
  fixedExpensesCents: number;
  /** Resolved planned savings: the LARGER of goal contributions and the
   *  savings-% target applied to pattern income. A floor, never a sum — both
   *  express "pay yourself first", so adding them would count the intent twice. */
  plannedSavingsCents: number;
  /** Which side won the max(). Ties (and a null target) read as 'goals'. */
  savingsSource: SavingsSource;
  /** The slice of `plannedSavingsCents` the savings-% target reserves BEYOND
   *  what named goals already claim (0 unless the target won). */
  unallocatedSavingsCents: number;
  /** True when a payment dated after this month is inside the figure. */
  reservesBeyondMonth: boolean;
  /** THE GUILT-FREE FIGURE: pattern income − (fixed expenses + card payments
   *  due this month + card payments already dated after it + savings). A
   *  MONTHLY allocation — there is deliberately no per-day view of it (owner
   *  2026-07-26). Negative = over plan. */
  leftToSpendCents: number;
  overspent: boolean;
}

/** Days in a Gregorian month (1-indexed), leap-year aware — no Date object. */
export function daysInMonth(year: number, month: number): number {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/**
 * Occurrences of a scheduled item inside (windowStart, windowEnd], given the
 * REAL today for the stale-anchor gate (L.22 money critic P1-1, executed:
 * the L.11(D) beyond-month walk passed `endOfMonth` as the counter's `today`,
 * so a live weekly/biweekly anchor that landed before the window read as
 * "stale" and contributed ZERO income — a $9,000 statement was reserved in
 * full against a biweekly paycheck arriving twice before it, every month,
 * permanently, which is the exact gross reservation the walk exists to kill).
 *
 * Rules:
 *  - `nextDate <= today` contributes 0: the stale-anchor rule is unchanged and
 *    still anchored at the REAL today, never at the window's start;
 *  - a live anchor is then stepped forward by its cadence into the window —
 *    WEEKLY 7 days, BIWEEKLY 14, MONTHLY / ANNUAL by clamped calendar months
 *    (a monthly income has an occurrence in EVERY month, which the in-month
 *    counter never had to know). KNOWN BOUND, recorded: the clamped chain
 *    drifts off 29/30/31-day anchors after a short month (Jan 31 → Feb 28 →
 *    Mar 28, never back to the 31st), so an income can count in the walk up to
 *    ~3 days before its "true" date — bounded at one occurrence of one series
 *    per short-month crossing, and the same chain the detector itself steps.
 *  - IRREGULAR / null cadences contribute the one dated occurrence if it
 *    falls inside, else 0 — an unstable gap has no rhythm to extrapolate.
 */
export function scheduledOccurrencesBetween(
  nextDate: string,
  cadence: string | null,
  today: ISODate,
  windowStart: string,
  windowEnd: string,
): number {
  if (nextDate <= today) return 0;
  const step = (d: ISODate): ISODate | null =>
    cadence === 'WEEKLY'
      ? addDays(d, 7)
      : cadence === 'BIWEEKLY'
        ? addDays(d, 14)
        : cadence === 'MONTHLY'
          ? addMonthsClamped(d, 1)
          : cadence === 'ANNUAL'
            ? addMonthsClamped(d, 12)
            : null;
  let d = nextDate as ISODate;
  if (step(d) === null) {
    return d > windowStart && d <= windowEnd ? 1 : 0;
  }
  while (d <= windowStart) d = step(d)!;
  let count = 0;
  while (d <= windowEnd) {
    count += 1;
    d = step(d)!;
  }
  return count;
}

/**
 * A detected recurring amount at a MONTHLY rate: WEEKLY ×52/12, BIWEEKLY
 * ×26/12, MONTHLY ×1, ANNUAL /12 — the "pattern" the owner asked expenses to
 * be read from, so an annual premium costs every month. IRREGULAR/null counts
 * at face ×1: an unstable-gap series is the least predictable shape the
 * detector emits, and charging it whole is the SAFE direction (it can only
 * understate guilt-free; excluding it could tell someone to spend money a real
 * bill will demand). Math.round (half-up) — the same named rounding as the
 * savings target below; integer cents in, integer cents out.
 */
export function monthlyRateCents(amountCents: number, cadence: string | null): number {
  switch (cadence) {
    case 'WEEKLY':
      return Math.round((amountCents * 52) / 12);
    case 'BIWEEKLY':
      return Math.round((amountCents * 26) / 12);
    case 'ANNUAL':
      return Math.round(amountCents / 12);
    default:
      return amountCents;
  }
}

/**
 * The savings-% target in cents. Math.round (half-up) — the rounding decision
 * is named here on purpose (dedup lesson): a one-cent bias either way is
 * immaterial, but every caller must share the SAME one.
 */
export function savingsTargetCents(patternIncomeCents: number, savingsTargetBps: number | null): number {
  if (savingsTargetBps == null || savingsTargetBps <= 0 || patternIncomeCents <= 0) return 0;
  return Math.round((patternIncomeCents * savingsTargetBps) / 10000);
}

export function computeSpendingPlan(input: SpendingPlanInput): SpendingPlan {
  // Income: the trailing pattern, median of up to the last 3 complete months —
  // a one-time inflow touches no month but its own. Rounding named: Math.round
  // (half-up), per the lib/stats contract (the shared median never re-rounds).
  const trailing = input.trailingMonthlyIncomeCents.slice(-3);
  let patternIncomeCents: number;
  let incomeBasis: IncomeBasis;
  let incomeMonths: number;
  if (trailing.length > 0) {
    patternIncomeCents = Math.round(median(trailing));
    incomeBasis = 'trailing-median';
    incomeMonths = trailing.length;
  } else {
    const series = input.scheduledIncome.reduce((sum, s) => sum + monthlyRateCents(s.amountCents, s.cadence), 0);
    patternIncomeCents = series;
    incomeBasis = series > 0 ? 'detected-series' : 'none';
    incomeMonths = 0;
  }

  // Fixed expenses: the detected recurring outflows at a monthly rate.
  const fixedExpensesCents = input.scheduledFixed.reduce(
    (sum, s) => sum + monthlyRateCents(-s.amountCents, s.cadence),
    0,
  );

  const targetCents = savingsTargetCents(patternIncomeCents, input.savingsTargetBps);
  const plannedSavingsCents = Math.max(input.goalContributionsCents, targetCents);
  const savingsSource: SavingsSource = targetCents > input.goalContributionsCents ? 'target' : 'goals';
  const unallocatedSavingsCents =
    savingsSource === 'target' ? plannedSavingsCents - input.goalContributionsCents : 0;

  const committed =
    fixedExpensesCents +
    input.cardObligationsCents +
    input.obligationsBeyondMonthCents +
    plannedSavingsCents;
  const leftToSpendCents = patternIncomeCents - committed;

  return {
    ...input,
    patternIncomeCents,
    incomeBasis,
    incomeMonths,
    fixedExpensesCents,
    plannedSavingsCents,
    savingsSource,
    unallocatedSavingsCents,
    reservesBeyondMonth: input.obligationsBeyondMonthCents > 0,
    leftToSpendCents,
    overspent: leftToSpendCents < 0,
  };
}
