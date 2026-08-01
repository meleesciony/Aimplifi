/**
 * Spending Plan engine (DECISIONS #66; #295/L.11(C) reframe; L.22 re-spec;
 * owner 2026-08-01: card pay is NOT a fixed expense) — the "guilt-free
 * spending" answer in the I Will Teach You to Be Rich sense:
 *
 *   guilt-free = income (ALL sources, from the trailing pattern)
 *              − savings % of that income (set in Settings)
 *              − fixed and recurring expenses (the pattern, never discretionary)
 *
 * Card statement payments are the SETTLEMENT of spend already done (fixed or
 * guilt-free charged to a card). Subtracting them here double-counts. Liquidity
 * — "how much cash do I need for cards, and when?" — lives on the cash-needed
 * engine / dashboard hero, which still receives the same obligation rows.
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
 *    rate (`monthlyRateCents`): weekly ×52/12, biweekly ×26/12, quarterly /3,
 *    twice-a-year /6, annual /12 — so a bill that arrives once a year costs
 *    something every month instead of nothing for eleven. ANNUAL series reach
 *    this term since L.23 and QUARTERLY/SEMIANNUAL since L.24; all three are
 *    projected as EXPENSES only and only while still charging, and INCOME on
 *    those rhythms stays out — the reasons are written at
 *    `toScheduledTransactions`. REMAINING GAP, recorded in docs/STATUS.md: every
 *    rhythm still classified IRREGULAR — bi-monthly (~61 days), six-weekly,
 *    three-weekly, ten-day, and any gap in 36–83, 99–174, 191–349 or 381+ days —
 *    contributes ZERO, which is the dangerous direction. Each would be a new
 *    detection class of its own, not a passthrough. A purchase that is not a
 *    detected recurring series is NEVER
 *    fixed — discretionary spending subtracts nowhere in this plan (the owner's
 *    formula: "not discretionary or budgeted for").
 *  - Card payment fields (`cardObligationsCents`, `obligationsBeyondMonthCents`)
 *    still ride the plan so disclosures and cash-needed cross-checks share one
 *    payload, but they are NOT subtracted from guilt-free (owner 2026-08-01).
 *    Paying the card is not a third cost class — it settles spend already
 *    categorized. The L.11(D) "beyond month" reservation likewise belongs to
 *    cash-needed timing, not this allocation.
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
import { monthsPerCadence } from '@/lib/engine/recurring/detect';

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
  /**
   * How many credit cards the reader has LINKED — counted from the account table,
   * every currency, so the claim "no credit cards linked" is about linkage rather
   * than about what this month's snapshot happened to contain (L.29 critic P1-3:
   * the snapshot withholds non-USD accounts entirely, so counting there told a
   * reader with a CAD card, in words, that he had no card).
   *
   * NOT a qualification of a figure like the four lists above — it is what separates
   * the meanings of a $0 card-payments line, which rendered as $0.00 are the same
   * pixel (docs/lessons/three-sessions-of-hypothesis-one-query-of-evidence.md).
   *
   * KNOWN and harmless: a reconciled predecessor row survives the boundary, so one
   * physical card can count twice. It only ever moves the count away from 0, and
   * every branch except `=== 0` speaks about payments rather than about how many
   * cards exist.
   */
  creditCardCount: number;
  /**
   * Linked credit cards this month's figure could not see AT ALL (currency-withheld
   * — DECISIONS #135). Not "excluded from the total": those have their own lists
   * above. A card here is invisible to every term, so no zero may be called "none
   * due" while one exists.
   */
  creditCardsOutsideFigure: number;
  /**
   * Distinct cards carrying a payment the engine HAS DATED past this month's edge.
   * Deliberately a count of dated points, not `obligationsBeyondMonthCents > 0`:
   * that figure is the worst running gap NET of scheduled income, so in the
   * commonest issuer pattern (paid the 1st, cards due the 3rd) it nets to zero
   * while a real statement is dated days away — and a label branching on it called
   * that state "none due this month" (L.29 critic P1-1, executed).
   */
  cardsDatedAfterThisMonth: number;
  /**
   * What became of every repeating EXPENSE the detector found (L.30). Like
   * `creditCardCount` above, this qualifies no figure — it is what separates the
   * meanings of a $0.00 "Fixed & recurring expenses" line, which rendered are one
   * identical pixel whether the reader has no bills, has bills that all charge to
   * a card, has bills that stopped charging, or has bills the projection lost
   * (the L.26 signature, which read $0.00 through four sessions of the owner
   * looking straight at it).
   *
   * Counted from the stored `RecurringSeries.projectionStatus`, written by the
   * same pass that decides the projected rows, so this census and the figure it
   * explains cannot disagree.
   */
  fixedSeries: FixedSeriesCensus;
}

/**
 * A census of repeating EXPENSE series by what the projection did with each one.
 * Expenses only: the fixed-expense line never speaks about income, and folding
 * income in would let a deposit landing in savings — a deliberate, correct
 * absence (L.25) — read as a missing bill.
 *
 * Every field is branched on by `fixedLabel`. There is deliberately no field for
 * the statuses that cannot reach a stored expense row ('unrecognized-rhythm',
 * which `detectRecurring` drops before storing, and the two income statuses):
 * a census field nothing can populate is a claim that a case is handled when it
 * is not (the L.22 dead-branch lesson).
 */
export interface FixedSeriesCensus {
  /** Repeating expense series stored for this reader, whatever became of them. */
  detected: number;
  /** In the figure. */
  counted: number;
  /** Absent CORRECTLY: charged to a credit card, so the card-payments line holds it. */
  onCard: number;
  /** Absent CORRECTLY: the series has stopped charging. */
  lapsed: number;
  /**
   * Absent INCORRECTLY: the account the bill charges is not one this projection
   * reads. The alarm.
   *
   * The unrecorded remainder is
   * `detected - counted - onCard - lapsed - uncounted - noCashAccount` — the
   * earlier version of this sentence omitted the last term and so reported four
   * RECORDED `no-cash-account` rows as unrecorded (critic P3-3, executed). A row in
   * that remainder was stored before L.30 or by the seeder, and may never be read
   * as either a true or a broken zero.
   */
  uncounted: number;
  /** Absent because no CHECKING or SAVINGS account is linked to project from. */
  noCashAccount: number;
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
 *    WEEKLY 7 days, BIWEEKLY 14, and MONTHLY / QUARTERLY / SEMIANNUAL / ANNUAL
 *    by clamped calendar months (`monthsPerCadence`, the shared table)
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
  const months = monthsPerCadence(cadence);
  const step = (d: ISODate): ISODate | null =>
    cadence === 'WEEKLY'
      ? addDays(d, 7)
      : cadence === 'BIWEEKLY'
        ? addDays(d, 14)
        : months > 0
          ? addMonthsClamped(d, months)
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
 * ×26/12, MONTHLY ×1, QUARTERLY /3, SEMIANNUAL /6, ANNUAL /12 — the "pattern"
 * the owner asked expenses to be read from, so an annual premium and a
 * quarterly water bill each cost something every month. IRREGULAR/null counts
 * at face ×1: an unstable-gap series is the least predictable shape the
 * detector emits, and charging it whole is the SAFE direction (it can only
 * understate guilt-free; excluding it could tell someone to spend money a real
 * bill will demand). Math.round (half-up) — the same named rounding as the
 * savings target below; integer cents in, integer cents out.
 *
 * The SAME per-month factors live in `summary.ts`'s PER_MONTH, which feeds
 * /recurring's headline. The two are NOT shared, on purpose: they disagree
 * about IRREGULAR (0 there, ×1 here) and this one keeps its exact integer form
 * (`amountCents × 52 / 12`, not `× 4.333…`) so no existing figure moves by a
 * rounding ulp. They are held together by a test instead — a lock, not an
 * abstraction — because L.23's defect was exactly two surfaces disagreeing
 * about one recurring fact.
 */
export function monthlyRateCents(amountCents: number, cadence: string | null): number {
  switch (cadence) {
    case 'WEEKLY':
      return Math.round((amountCents * 52) / 12);
    case 'BIWEEKLY':
      return Math.round((amountCents * 26) / 12);
    case 'QUARTERLY':
      return Math.round(amountCents / 3);
    case 'SEMIANNUAL':
      return Math.round(amountCents / 6);
    case 'ANNUAL':
      return Math.round(amountCents / 12);
    default:
      return amountCents;
  }
}

/**
 * The cadences this plan SMOOTHS — each counted at a fraction of itself every
 * month — with the reader-facing words for that fraction.
 *
 * ONE table because two surfaces disclose the smoothing (the glass-box basis
 * and the dashboard's safe-to-spend card) and a third names the preconditions
 * (/spending-plan). If they named different fractions for the same bill, that
 * is the L.23 defect returning as copy instead of arithmetic. The `share` words
 * must match what `monthlyRateCents` actually divides by — locked by a test,
 * because a wrong fraction here is a false claim about the reader's money.
 *
 * `landing` / `cardLanding` / `planLine` exist because the L.24 copy critic
 * caught the generalization lifting ANNUAL's wording wholesale: "in THE MONTH
 * the bill leaves your account" is exactly right once a year and wrong four
 * times a year, and a reader budgeting for one lump would under-plan for three
 * more. The ANNUAL entries reproduce the L.23 sentences byte-for-byte.
 */
export const LONG_CADENCE_WORDS = {
  QUARTERLY: {
    adjective: 'quarterly',
    period: 'quarter',
    share: 'a third',
    landing: 'in each of the four months a year the bill actually lands',
    cardLanding: 'each of the four months a year it actually leaves your account',
    planLine: 'those four months need their own plan',
  },
  SEMIANNUAL: {
    adjective: 'twice-a-year',
    period: 'half-year',
    share: 'a sixth',
    landing: 'in each of the two months a year the bill actually lands',
    cardLanding: 'each of the two months a year it actually leaves your account',
    planLine: 'those two months need their own plan',
  },
  ANNUAL: {
    adjective: 'yearly',
    period: 'year',
    share: 'a twelfth',
    landing: 'in the month the bill leaves your account',
    cardLanding: 'the month it actually leaves your account',
    planLine: 'that month needs its own plan',
  },
} as const;

export type LongCadence = keyof typeof LONG_CADENCE_WORDS;

/**
 * The smoothed rhythms actually present in a plan's fixed term, shortest first.
 * Empty is the gate both disclosure surfaces use: a clause about a bill that is
 * not in the figure would name a mechanism that did not act — this engine's own
 * rule, applied to a cadence rather than a card (L.23 copy critic P1-2).
 */
export function longCadencesInTerm(rows: readonly { cadence: string | null }[]): LongCadence[] {
  return (['QUARTERLY', 'SEMIANNUAL', 'ANNUAL'] as const).filter((c) =>
    rows.some((r) => r.cadence === c),
  );
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

  // Owner 2026-08-01: card obligations are NOT committed spend in this plan —
  // they settle prior spend. Cash-needed answers the liquidity question.
  const committed = fixedExpensesCents + plannedSavingsCents;
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
