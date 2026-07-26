/**
 * Spending Plan engine (DECISIONS #66, reframed by #295/L.11(C)) — the
 * "guilt-free spending" answer in the I Will Teach You to Be Rich sense: of
 * this month's expected income, after what you've already spent from cash
 * accounts, the bills still coming, the card payments due this cycle, and your
 * planned savings, here's what's genuinely free to spend — and what that is
 * per remaining day.
 *
 * THE CASH-MONTH MODEL (why `spentSoFarCents` excludes credit cards): card
 * PAYMENTS are transfers and never count as spend (`monthlyFlows` excludes
 * `isTransfer` rows), so before #295 card PURCHASES counted at post time and
 * the payment obligation was ignored — which is exactly the contradiction the
 * owner reported (a "safe to spend" beside a cash-needed shortfall). Counting
 * purchases AND subtracting the obligation would charge every card dollar
 * twice (once when posted, once when its statement is paid), so the reframe
 * moves whole-hog to cash: spending outside your credit cards counts when it
 * posts, and card spending counts in the CALENDAR MONTH its statement's
 * payment comes due — `cardObligationsCents` is the sum of the cash-needed
 * engine's obligation rows whose effective due date falls in this month
 * (critic F1: subtracting the WHOLE open cycle reserved the same statement
 * against two months' income whenever it was due early in a month; a monthly
 * plan may reserve a bill only against its due month). The rows are the
 * engine's own — a subset of the exact set the cash-needed headline sums —
 * so the two figures cannot disagree about what a card demands, only about
 * the window they describe, and each states its window.
 *
 * THE MONTH'S EDGE (L.11(D)): a window has an edge, and money does not reset
 * when it is crossed. The rule above — reserve a statement only against its own
 * due month — leaves a payment dated on the 5th of next month inside NO plan the
 * reader can ever see: this month calls it next month's business, and next
 * month's plan arrives after the money is spent. So every obligation the engine
 * has DATED is reserved from the moment it is known, in two lines rather than
 * one: `cardObligationsCents` for those due inside this month, and
 * `obligationsBeyondMonthCents` for those dated past its edge. Same rows, same
 * units, both flows — which is what keeps these six lines an allocation the
 * Glass-Box panel can genuinely falsify.
 *
 * A first attempt CAPPED the answer at the funding account's projected low
 * point instead, and two fresh-context critics broke it independently: that
 * caps a flow (a month's income) with a stock (one account's worst balance),
 * and since the walk records its minimum on day one, the cap collapsed to
 * "never more than what is in checking right now" for everyone whose balance
 * dips before payday. The residual it subtracted also absorbed savings sweeps,
 * unarrived income and money in other accounts while being printed as "held for
 * card payments". Recorded because the shape recurs: when a figure is a flow,
 * bound it with flows.
 *
 * Loan/mortgage payments are deliberately NOT a term here: where a recurring
 * loan ACH is DETECTED it already arrives via `upcomingBillsCents`
 * (detectRecurring keeps the auto-loan exception), and adding
 * `loanObligations` on top would double-count those. A loan paid with no
 * detected series — including the seeded demo user's, whose recurring
 * detection never runs — is counted ZERO times: a known, recorded gap
 * (docs/STATUS.md §L.11(C)), not a silent term.
 *
 * Pure: integer cents in, integer cents out, no I/O, no `new Date()`.
 */
import { addDays, type ISODate } from '@/lib/dates';

export interface SpendingPlanInput {
  today: ISODate;
  /** Expected income for the whole month = received so far + still-scheduled. */
  expectedIncomeCents: number;
  /**
   * Expenses already posted this month FROM CASH (non-credit) ACCOUNTS, as
   * positive cents. Card purchases are excluded on purpose — they enter
   * through `cardObligationsCents` when their statement's payment comes due
   * (see the cash-month model above).
   */
  spentSoFarCents: number;
  /** Recurring bills scheduled to post later this month (not yet spent). */
  upcomingBillsCents: number;
  /**
   * Card payment obligations whose effective due date falls in THIS calendar
   * month — the sum of the cash-needed engine's own `perDueDate` rows with
   * `date <= end of month`, so each statement is reserved against exactly one
   * month's income (its due month) and the rows can never disagree with the
   * cash-needed answer about what a card demands.
   */
  cardObligationsCents: number;
  /**
   * True when any obligation summed into `cardObligationsCents` is the
   * engine's ESTIMATE (no generated statement — the all-estimate state).
   * Required so no surface can claim the term came from statements when it
   * did not (critic P1-3: the fact must ride the money).
   */
  cardObligationsEstimated: boolean;
  /** Sum of active goals' monthly contributions. */
  goalContributionsCents: number;
  /**
   * Pay-yourself-first target as basis points of expected income (a Conscious
   * Spending Plan allocation, set in Settings). null = unset.
   */
  savingsTargetBps: number | null;
  /**
   * Card payment obligations the cash-needed engine HAS dated, falling AFTER
   * this month's window — the same `perDueDate` rows as the term above, taken
   * from the other side of the same filter (L.11(D)).
   *
   * WHY THIS EXISTS (owner-reported 2026-07-25, "It's worse now"): the term
   * above is windowed to the CALENDAR MONTH, so a statement due on the 5th of
   * next month was in no plan the reader could see — this month excluded it as
   * next month's business, and next month arrived after the money was gone.
   * All seven of his cards were dated Aug 5 while the plan told him $22,254.09
   * was guilt-free at $3,709.01 a day, on the same screen saying $18,814.14
   * had to be in the account by Aug 5. Each figure was right about its own
   * window, and the PAIR was an instruction to overdraft.
   *
   * A window has an edge and money does not reset when it is crossed, so a
   * payment already DATED is reserved from the moment it is known rather than
   * from the first of the month it falls in. Same units as every other term
   * here — a flow, from the engine's own rows — which is what keeps the six
   * lines an allocation the Glass-Box panel can actually falsify.
   *
   * ACCEPTED COST, recorded rather than hidden: between the 1st of next month
   * and that due date the same statement is reserved twice, here and in next
   * month's own term. That is the mirror of the L.11(C) error and it is the
   * SAFE direction — it under-states what is free to spend for a few days,
   * where the alternative over-stated it by a whole statement — and it clears
   * itself the moment the payment posts and the obligation leaves `due`.
   */
  obligationsBeyondMonthCents: number;
  /**
   * The last day those beyond-month payments are dated, ALREADY FORMATTED for
   * a reader ("Wed, Aug 5") — the one field here that is display text, because
   * every date this product shows goes through `formatISODate` and a raw
   * `2026-08-05` mid-sentence is a tell that a value escaped its surface.
   * null when `obligationsBeyondMonthCents` is 0.
   */
  obligationsBeyondMonthThroughDate: string | null;
  /**
   * True when any card inside `obligationsBeyondMonthCents` is the engine's
   * ESTIMATE rather than a generated statement. Separate from
   * `cardObligationsEstimated` because the two terms can differ — and when
   * every card is dated past the edge, that flag is false by construction, so
   * without this one a figure that is entirely guesswork off current balances
   * would print with the authority of a statement (cycle-2 P0).
   */
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
  /**
   * Cards OWING a balance (stored positive — critic F8: a credit-balance /
   * overpaid card owes nothing and must not drive an "overstated" claim) that
   * the cash-needed engine could not date — EXCLUDED from the card-payments
   * term, so guilt-free may be OVERSTATED (the dangerous direction: the
   * reader spends money a real card will demand).
   */
  undatedCards: { cardName: string; frozenSince: string | null }[];
  /**
   * Cards whose ESTIMATED obligation falls due this month but is excluded
   * from the term because another card has a real statement (the engine's
   * `upcoming` set — critic F2: excluded from the term AND from every other
   * disclosure, the exact overstated-and-silent state the disclosures exist
   * for). Same direction as `undatedCards`; different mechanism (the
   * statement has not been generated yet), so a different sentence.
   */
  statementPendingCards: { cardName: string; dueDate: string }[];
  /**
   * Suspected same-card-twice pairs where BOTH sides are inside the
   * card-payments term — if real, the term is inflated and guilt-free is
   * UNDERSTATED. Advisory: no figure is adjusted (#192/#299 stance).
   */
  duplicatePairs: { aName: string; bName: string; confidence: 'high' | 'medium' }[];
  /**
   * Cards inside the card-payments term whose bank stopped sharing them —
   * the subtracted amount rests on a statement/balance that stopped updating.
   */
  frozenCards: { label: string; frozenSince: string }[];
}

export interface SpendingPlan extends SpendingPlanInput {
  /**
   * Resolved planned savings: the LARGER of goal contributions and the
   * savings-% target applied to expected income. A floor, never a sum — the
   * target and the goals both express "pay yourself first", so adding them
   * would count the same intent twice.
   */
  plannedSavingsCents: number;
  /** Which side won the max(). Ties (and a null target) read as 'goals'. */
  savingsSource: SavingsSource;
  /**
   * The slice of `plannedSavingsCents` the savings-% target reserves BEYOND
   * what named goals already claim (0 unless the target won). Critic F3: the
   * inverse planners compare a required monthly against `leftToSpendCents`,
   * which is net of this reserve — but a new savings/investing/debt plan is
   * exactly what this reserve exists to fund, so the answers must be able to
   * name it instead of declaring the plan "beyond budget".
   */
  unallocatedSavingsCents: number;
  /** True when a payment dated after this month is inside the figure — the one
   *  fact a surface needs to explain a line the month's own window cannot show. */
  reservesBeyondMonth: boolean;
  /** Income − (spent + bills + card payments due this month + card payments
   *  already dated after it + savings). Negative = overspent. */
  leftToSpendCents: number;
  /** Calendar days remaining this month, including today (≥ 1). */
  daysLeftInMonth: number;
  /** leftToSpend spread over the days remaining, floored at 0. */
  perDayCents: number;
  overspent: boolean;
}

/** Days in a Gregorian month (1-indexed), leap-year aware — no Date object. */
export function daysInMonth(year: number, month: number): number {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/**
 * How many times a scheduled item lands inside (today, endOfMonth], given its
 * next occurrence and cadence (critic F4: reading only `nextDate` half-counts
 * a BIWEEKLY paycheck — and a biweekly bill — whenever two occurrences remain
 * in the month). Rules:
 *  - a `nextDate` outside the window (past-dated stale anchor, or beyond the
 *    month) contributes 0 — a stale anchor is never extrapolated forward.
 *    KNOWN CONSEQUENCES, accepted and recorded (cycle-2 critic F2-4/5/6): an
 *    item dated TODAY is in no term for the rest of the day (`> today`
 *    matches the posted/spent split — including it would double-count once
 *    it posts); and until the recurring refresh advances a stale anchor, a
 *    stale-anchored BILL leaves every term (overstates guilt-free) while a
 *    stale-anchored PAYCHECK that posted early can count once as received
 *    and again from its anchor — both bounded by the refresh that runs on
 *    every sync;
 *  - WEEKLY / BIWEEKLY step by 7 / 14 days while inside the window;
 *  - every other cadence (MONTHLY, ANNUAL, IRREGULAR, null) contributes at
 *    most the one dated occurrence — a monthly item cannot recur within one
 *    month, and an irregular one has no interval to extrapolate.
 */
export function scheduledOccurrencesInWindow(
  nextDate: string,
  cadence: string | null,
  today: ISODate,
  endOfMonth: string,
): number {
  if (!(nextDate > today && nextDate <= endOfMonth)) return 0;
  const stepDays = cadence === 'WEEKLY' ? 7 : cadence === 'BIWEEKLY' ? 14 : null;
  if (stepDays === null) return 1;
  let count = 0;
  let d = nextDate as ISODate;
  while (d > today && d <= endOfMonth) {
    count += 1;
    d = addDays(d, stepDays);
  }
  return count;
}

/**
 * The savings-% target in cents. Math.round (half-up) — the rounding decision
 * is named here on purpose (dedup lesson): a one-cent bias either way is
 * immaterial, but every caller must share the SAME one.
 */
export function savingsTargetCents(expectedIncomeCents: number, savingsTargetBps: number | null): number {
  if (savingsTargetBps == null || savingsTargetBps <= 0 || expectedIncomeCents <= 0) return 0;
  return Math.round((expectedIncomeCents * savingsTargetBps) / 10000);
}

export function computeSpendingPlan(input: SpendingPlanInput): SpendingPlan {
  const targetCents = savingsTargetCents(input.expectedIncomeCents, input.savingsTargetBps);
  const plannedSavingsCents = Math.max(input.goalContributionsCents, targetCents);
  const savingsSource: SavingsSource = targetCents > input.goalContributionsCents ? 'target' : 'goals';
  const unallocatedSavingsCents =
    savingsSource === 'target' ? plannedSavingsCents - input.goalContributionsCents : 0;

  const committed =
    input.spentSoFarCents +
    input.upcomingBillsCents +
    input.cardObligationsCents +
    input.obligationsBeyondMonthCents +
    plannedSavingsCents;
  const leftToSpendCents = input.expectedIncomeCents - committed;

  const year = Number(input.today.slice(0, 4));
  const month = Number(input.today.slice(5, 7));
  const day = Number(input.today.slice(8, 10));
  const daysLeftInMonth = Math.max(1, daysInMonth(year, month) - day + 1);

  const perDayCents = leftToSpendCents > 0 ? Math.floor(leftToSpendCents / daysLeftInMonth) : 0;

  return {
    ...input,
    plannedSavingsCents,
    savingsSource,
    unallocatedSavingsCents,
    reservesBeyondMonth: input.obligationsBeyondMonthCents > 0,
    leftToSpendCents,
    daysLeftInMonth,
    perDayCents,
    overspent: leftToSpendCents < 0,
  };
}
