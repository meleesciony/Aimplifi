/**
 * Recurring / subscription detection (Phase 2):
 *  - groups transactions by canonical merchant
 *  - infers cadence from the median gap between occurrences (the two long
 *    cadences added in L.24, QUARTERLY and SEMIANNUAL, additionally require
 *    EVERY gap to fall in the band — see `cadenceFromGaps`)
 *  - tracks price changes (stable old amount → stable new amount)
 *  - flags possibly-unused subscriptions (fitness memberships with no other
 *    activity ≥90 days — a heuristic, surfaced as a question, never a scold)
 *  - detects biweekly payroll as an income cadence, which feeds
 *    ScheduledTransactions for the cash-needed projection.
 */
import { type ISODate, addDays, addMonthsClamped, compareDates, daysBetween, isoDate } from '@/lib/dates';
import { median } from '@/lib/stats';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import {
  type RecurringOverrideInput,
  buildOverrideMap,
  overrideKey,
} from '@/lib/engine/recurring/override';
import {
  type RecurringPaidThroughInput,
  NO_RECURRING_PAID_THROUGH,
  buildPaidThroughMap,
} from '@/lib/engine/recurring/paid-through';

export interface RecurringTxn {
  id: string;
  accountId: string;
  date: string;
  amountCents: number; // signed
  rawDescriptor: string;
  isTransfer?: boolean;
  /**
   * TRUE marks a structurally-identified loan payment (C.24 —
   * `loanPaymentMerchantCanonicals`: the pair counterpart sits on a linked
   * LOAN/MORTGAGE account). The same class of recurring obligation as the
   * auto-loan ACH below: kept despite the transfer flag.
   */
  loanPayment?: boolean;
}

export type Cadence =
  | 'WEEKLY'
  | 'BIWEEKLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'SEMIANNUAL'
  | 'ANNUAL'
  | 'IRREGULAR';

/**
 * One charge a series was detected from — the evidence behind the row's
 * typical-amount claim (O.18c). Carried out of the detector so a surface can
 * list exactly what it saw, rather than re-deriving a different array.
 */
export interface RecurringOccurrence {
  /** YYYY-MM-DD, the day the charge posted. */
  date: ISODate;
  /** Signed integer cents — negative for a charge, positive for income. */
  amountCents: number;
  /** The bank's own text for this charge, if it had any. */
  descriptor: string;
}

export interface RecurringSeriesResult {
  merchantCanonical: string;
  categoryId: string;
  cadence: Cadence;
  typicalAmountCents: number; // most recent stable amount (signed)
  lastAmountCents: number;
  previousAmountCents: number | null; // set when a price change was detected
  priceChangedAt: ISODate | null;
  lastSeenAt: ISODate;
  nextExpectedAt: ISODate;
  occurrences: number;
  /**
   * The charges this series was detected from, oldest first — the same rows
   * that decided cadence, amount and count (O.18c). `occurrences` is its
   * length by construction. A panel lists these and says the amount above is
   * the typical one, not their total; the rows are the answer to "what is the
   * system classifying as a bill".
   */
  occurrenceRows: readonly RecurringOccurrence[];
  isSubscription: boolean;
  isIncome: boolean;
  possiblyUnused: boolean;
  accountId: string;
  /**
   * TRUE when this series exists because the READER said so (O.13f) and the
   * evidence did not: the rhythm is his, not inferred. Required, not optional —
   * a surface that renders a declared bill as a detected one is claiming the app
   * observed a pattern it never saw, and the compiler is what makes every
   * constructor state which kind it is building.
   */
  declaredByUser: boolean;
  /**
   * TRUE when `nextExpectedAt` was advanced because the household marked this
   * cycle paid, not because a charge landed. Surfaces must not say the app
   * observed a payment it never saw.
   */
  paidThisCycle?: boolean;
}


/** The day-gap window each recognized cadence is inferred from. Ordered short →
 *  long; the windows do not overlap, so at most one can match. */
const CADENCE_BANDS: readonly { cadence: Exclude<Cadence, 'IRREGULAR'>; min: number; max: number }[] = [
  { cadence: 'WEEKLY', min: 5, max: 9 },
  { cadence: 'BIWEEKLY', min: 12, max: 16 },
  { cadence: 'MONTHLY', min: 26, max: 35 },
  { cadence: 'QUARTERLY', min: 84, max: 98 },
  { cadence: 'SEMIANNUAL', min: 175, max: 190 },
  { cadence: 'ANNUAL', min: 350, max: 380 },
];

/**
 * The cadences that must be earned by every gap AND by the gaps' agreement with
 * each other, not merely by their median (L.24). A median is an average once
 * there are only two gaps, so a merchant visited 30 then 150 days apart has a
 * median of 90 and would read as a quarterly bill on the median alone. The
 * existing four cadences keep the median-only rule deliberately: raising their
 * evidence bar would change what is detected for every existing user, which is
 * a different slice from adding two cadences that are detected for nobody today.
 */
const EVERY_GAP_CADENCES: ReadonlySet<Cadence> = new Set<Cadence>(['QUARTERLY', 'SEMIANNUAL']);

/**
 * How far the longest gap may exceed the shortest before a long-cadence series
 * is refused. Band membership ALONE is not evidence of a rhythm, which the L.24
 * money critic proved with the smallest possible counterexample: the quarterly
 * band is 15 days wide, so three haircuts 84 and 98 days apart put BOTH gaps
 * inside it and the every-gap rule passed them — a discretionary purchase
 * became a projected bill with a date on the calendar. The gaps must also agree
 * with EACH OTHER. Executed against real anchors, genuine bills cluster far
 * tighter than this: calendar-quarter billing runs 89–92 days (spread 3),
 * first-business-day-of-quarter 90–92 (spread 2), a real Jan 31 / Apr 30 /
 * Jul 31 / Oct 31 water bill 89–92 (spread 3), semiannual 181–184 (spread 3).
 */
const LONG_CADENCE_MAX_SPREAD_DAYS = 7;

/**
 * Infer a cadence from the gaps between a series' occurrences.
 *
 * Takes the whole gap list rather than a pre-computed median so the
 * every-gap licence above cannot be skipped by a caller that only has the
 * median — the classification and the evidence bar it requires live together.
 */
export function cadenceFromGaps(gaps: readonly number[]): Cadence {
  if (gaps.length === 0) return 'IRREGULAR';
  const med = Math.round(median(gaps));
  const band = CADENCE_BANDS.find((b) => med >= b.min && med <= b.max);
  if (!band) return 'IRREGULAR';
  if (EVERY_GAP_CADENCES.has(band.cadence)) {
    // Two independent conditions, and the second is the one that matters at the
    // three-sighting floor: every gap inside the band, AND the gaps within a
    // week of one another. Band membership alone admits the whole 15-day window
    // as if it were a rhythm.
    if (!gaps.every((g) => g >= band.min && g <= band.max)) return 'IRREGULAR';
    if (Math.max(...gaps) - Math.min(...gaps) > LONG_CADENCE_MAX_SPREAD_DAYS) return 'IRREGULAR';
  }
  return band.cadence;
}

/**
 * The next expected occurrence after `last` for a cadence. Exported so the
 * forward renewal schedule (renewals.ts, #246) steps by the SAME rule this
 * detector used to compute `nextExpectedAt` — one source of cadence arithmetic.
 */
export function nextDate(last: ISODate, cadence: Cadence): ISODate {
  switch (cadence) {
    case 'WEEKLY':
      return addDays(last, 7);
    case 'BIWEEKLY':
      return addDays(last, 14);
    case 'MONTHLY':
      return addMonthsClamped(last, 1);
    case 'QUARTERLY':
      return addMonthsClamped(last, 3);
    case 'SEMIANNUAL':
      return addMonthsClamped(last, 6);
    case 'ANNUAL':
      return addMonthsClamped(last, 12);
    default:
      return addMonthsClamped(last, 1);
  }
}

/**
 * Advance a projected next date until it is AFTER a household mark that this
 * cycle paid. IRREGULAR has no rhythm. Capped so a garbage date cannot hang.
 */
function nextExpectedAfterPaidThrough(
  nextExpectedAt: ISODate,
  cadence: Cadence,
  paidThrough: ISODate | null,
): ISODate {
  if (!paidThrough || cadence === 'IRREGULAR') return nextExpectedAt;
  let n = nextExpectedAt;
  for (let i = 0; i < 36 && compareDates(n, paidThrough) <= 0; i++) {
    n = nextDate(n, cadence);
  }
  return n;
}

/**
 * Whole calendar months between two occurrences of a cadence, or 0 for the
 * cadences that do not step by months at all (WEEKLY/BIWEEKLY step by days;
 * IRREGULAR and a null DB cadence are one-offs).
 *
 * ONE table, because FOUR expanders — cash-needed/assemble, forecast, calendar
 * and the spending plan's `scheduledOccurrencesBetween` — each carried their
 * own copy of the same ternary chain, and L.24 had to add the same two branches
 * to all four. A missed branch there is silent by construction: the value falls
 * through to the one-occurrence `else`, so a quarterly bill would render once
 * and never again, with nothing failing.
 *
 * Takes `string | null` because the ScheduledTransaction rows these expanders
 * read carry the DB column's type, not the `Cadence` union.
 */
export function monthsPerCadence(cadence: string | null | undefined): number {
  switch (cadence) {
    case 'MONTHLY':
      return 1;
    case 'QUARTERLY':
      return 3;
    case 'SEMIANNUAL':
      return 6;
    case 'ANNUAL':
      return 12;
    default:
      return 0;
  }
}

/** Categories whose recurring charges count as subscriptions. */
const SUBSCRIPTION_CATEGORIES = new Set([
  'entertainment', 'software', 'fitness', 'utilities',
  // Household utility leaves (#154) — a monthly electric/gas/water/trash bill is a
  // recurring obligation just like the `utilities` catch-all it was split from.
  'electricity', 'natural-gas', 'water', 'trash',
  'insurance', 'groceries',
  // #163 leaf-precision follow-through: merchants that used to file into the
  // coarse parents above now land on precise leaves (Xfinity → internet,
  // GEICO *AUTO → auto-insurance, consoles → games). A recurring bill on any
  // of them is the same subscription it always was.
  'internet', 'phone', 'subscriptions', 'games', 'music',
  'auto-insurance', 'health-insurance', 'dental-insurance', 'vision-insurance', 'life-insurance',
]);

/** One merchant's rows, as grouped below. */
interface MerchantGroup {
  txns: RecurringTxn[];
  categoryId: string;
}

/**
 * The same-signed subset a series is read from. A stray opposite-sign txn — a
 * refund inside an expense subscription, say — is a one-off, NOT part of the
 * cadence, so only the dominant sign is analyzed and a refund+rebill doesn't drop
 * the whole series (STATUS #7 fragility / ROADMAP #4). Pure-signed groups (every
 * seed series) are unchanged: the minority list is empty, so this is the full set.
 *
 * Shared by detection and by a reader's declaration, so a declared bill's amount
 * and date come off exactly the rows detection would have read.
 */
function dominantSignTxns(txns: readonly RecurringTxn[]): RecurringTxn[] {
  const negatives = txns.filter((t) => t.amountCents < 0);
  const positives = txns.filter((t) => t.amountCents > 0);
  return negatives.length >= positives.length ? negatives : positives;
}

/**
 * Shape one series from its most recent charge. ONE copy of this arithmetic, used
 * by both detection and declaration: the anchor, the amount, the income/
 * subscription classification and the step-past-today loop decide what reaches
 * /calendar and the spending plan, and a declared bill that computed its own
 * `nextExpectedAt` would be a second money basis for the same question.
 */
function buildSeries(args: {
  canonical: string;
  categoryId: string;
  sorted: readonly RecurringTxn[];
  cadence: Cadence;
  previousAmountCents: number | null;
  priceChangedAt: ISODate | null;
  today: ISODate;
  declaredByUser: boolean;
}): RecurringSeriesResult {
  const { canonical, categoryId, sorted, cadence, today } = args;
  const last = sorted[sorted.length - 1];
  const lastSeenAt = isoDate(last.date);
  const isIncome = last.amountCents > 0;
  const isSubscription = !isIncome && SUBSCRIPTION_CATEGORIES.has(categoryId);
  let nextExpectedAt = nextDate(lastSeenAt, cadence);
  while (compareDates(nextExpectedAt, today) < 0) nextExpectedAt = nextDate(nextExpectedAt, cadence);
  return {
    merchantCanonical: canonical,
    categoryId,
    cadence,
    typicalAmountCents: last.amountCents,
    lastAmountCents: last.amountCents,
    previousAmountCents: args.previousAmountCents,
    priceChangedAt: args.priceChangedAt,
    lastSeenAt,
    nextExpectedAt,
    occurrences: sorted.length,
    occurrenceRows: sorted.map((t) => ({
      date: isoDate(t.date),
      amountCents: t.amountCents,
      descriptor: t.rawDescriptor,
    })),
    isSubscription,
    isIncome,
    // "Possibly unused": a fitness membership with no usage signal for 90+ days.
    // Usage can't be observed in transaction data, so this is a question for
    // the user, not an accusation (see coach guardrails).
    possiblyUnused: isSubscription && categoryId === 'fitness',
    accountId: last.accountId,
    declaredByUser: args.declaredByUser,
    paidThisCycle: false,
  };
}

/** Detection for ONE merchant group: the evidence bar, unchanged. Null when the
 *  rows do not earn a series — which is the case a reader's BILL declaration
 *  answers, and the ONLY case it answers. */
function detectSeries(canonical: string, group: MerchantGroup, today: ISODate): RecurringSeriesResult | null {
  const { categoryId } = group;
  const txns = dominantSignTxns(group.txns);
  if (txns.length < 3) return null;
  const sorted = [...txns].sort((a, b) => compareDates(isoDate(a.date), isoDate(b.date)));
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(daysBetween(isoDate(sorted[i - 1].date), isoDate(sorted[i].date)));
  }
  const cadence = cadenceFromGaps(gaps);
  if (cadence === 'IRREGULAR') return null;

  // Amount stability: a series is recurring when amounts cluster tightly.
  // Allow exactly two stable plateaus (price change).
  const amounts = sorted.map((t) => t.amountCents);
  const distinct = [...new Set(amounts)];
  if (distinct.length > 2) {
    // payroll-style: identical amounts required for income; variable spend is
    // not a subscription (e.g. groceries at Kroger).
    return null;
  }

  let previousAmountCents: number | null = null;
  let priceChangedAt: ISODate | null = null;
  if (distinct.length === 2) {
    // must be two contiguous plateaus old→new, else it's just variable spend
    const firstNewIdx = amounts.findIndex((a) => a === amounts[amounts.length - 1]);
    const plateaued =
      amounts.slice(0, firstNewIdx).every((a) => a === amounts[0]) &&
      amounts.slice(firstNewIdx).every((a) => a === amounts[amounts.length - 1]);
    if (!plateaued || firstNewIdx === 0) return null;
    previousAmountCents = amounts[0];
    priceChangedAt = isoDate(sorted[firstNewIdx].date);
  }

  return buildSeries({
    canonical,
    categoryId,
    sorted,
    cadence,
    previousAmountCents,
    priceChangedAt,
    today,
    declaredByUser: false,
  });
}

/**
 * The series a reader's "this IS a bill" declaration produces, from a merchant
 * whose rows did not earn one on their own.
 *
 * It makes exactly ONE claim the evidence does not: the rhythm, which he supplied.
 * Everything else is read off his real charges — the amount and the anchor date
 * come from the most recent one, the same as a detected series — so a declared
 * bill can never carry a figure that appears nowhere in his history.
 *
 * NO price-change claim is ever attached (`previousAmountCents`/`priceChangedAt`
 * stay null): the two-plateau rule needs three sightings to mean anything, and a
 * declaration exists precisely where there are fewer. Announcing "the price went
 * up" from two rows would be the app originating a fact.
 */
function declaredSeries(
  canonical: string,
  group: MerchantGroup,
  cadence: Exclude<Cadence, 'IRREGULAR'>,
  declaredSign: 'OUT' | 'IN' | null,
  today: ISODate,
): RecurringSeriesResult | null {
  // THE DIRECTION IS HIS, NOT THE MAJORITY'S. Detection may take the dominant sign
  // because three sightings at a stable amount have already made the direction
  // obvious; a declaration has neither bar. A $49.99 purchase carrying two refunds
  // has a positive majority, so the majority rule turned "this charge repeats" into
  // projected INCOME of $25.00 on the payment account — a sign and an amount the
  // reader never stated, in the direction that silences warnings (money critic,
  // executed). He declared while standing on a charge; that charge's direction is
  // part of what he said. Falls back to the majority only for a row stored before
  // the direction was recorded.
  const signed =
    declaredSign === 'OUT'
      ? group.txns.filter((t) => t.amountCents < 0)
      : declaredSign === 'IN'
        ? group.txns.filter((t) => t.amountCents > 0)
        : dominantSignTxns(group.txns);
  const txns = signed;
  if (txns.length === 0) return null;
  const sorted = [...txns].sort((a, b) => compareDates(isoDate(a.date), isoDate(b.date)));
  return buildSeries({
    canonical,
    categoryId: group.categoryId,
    sorted,
    cadence,
    previousAmountCents: null,
    priceChangedAt: null,
    today,
    declaredByUser: true,
  });
}

/**
 * @param overrides the reader's own verdicts (O.13f). REQUIRED, with no default,
 * on purpose: five production surfaces detect independently, and a caller that
 * forgot this argument would keep projecting a bill its reader had deleted while
 * every other surface honoured him. `NO_RECURRING_OVERRIDES` is the explicit
 * "nobody has said anything" the seed, the benchmark and the pure tests pass.
 */
export function detectRecurring(
  transactions: readonly RecurringTxn[],
  today: ISODate,
  overrides: readonly RecurringOverrideInput[],
  paidThrough: readonly RecurringPaidThroughInput[] = NO_RECURRING_PAID_THROUGH,
): RecurringSeriesResult[] {
  const byMerchant = new Map<string, MerchantGroup>();
  for (const t of transactions) {
    const m = normalizeMerchant(t.rawDescriptor);
    // Own-account transfers (incl. card payments) are not subscriptions;
    // the auto-loan ACH is a recurring OBLIGATION and is kept — and so is a
    // structurally-identified loan payment (C.24: the pair counterpart sits
    // on a linked LOAN/MORTGAGE account), which is the same class.
    if (t.isTransfer && m.categoryId !== 'auto-loan' && t.loanPayment !== true) continue;
    const entry = byMerchant.get(m.canonical) ?? { txns: [], categoryId: m.categoryId };
    entry.txns.push(t);
    byMerchant.set(m.canonical, entry);
  }

  const instructions = buildOverrideMap(overrides);
  const results: RecurringSeriesResult[] = [];
  for (const [canonical, group] of byMerchant) {
    const instruction = instructions.get(overrideKey(canonical)) ?? null;
    // "Not a bill" wins over everything, including evidence: it is the only lever
    // against a false detection, and a detector that could out-vote it would make
    // the lever advisory. Every consumer of this function loses the series at
    // once, which is the point.
    if (instruction?.decision === 'NOT_BILL') continue;

    const detected = detectSeries(canonical, group, today);
    if (detected !== null) {
      // Detection AGREES, so it wins the details: it read the real gaps, where a
      // declaration is one remembered rhythm. The declaration is then redundant
      // rather than wrong, and /recurring says so beside it rather than leaving
      // the reader to wonder which cadence is being projected.
      results.push(detected);
      continue;
    }
    if (instruction?.decision === 'BILL' && instruction.cadence !== null) {
      const declared = declaredSeries(canonical, group, instruction.cadence, instruction.declaredSign, today);
      if (declared !== null) results.push(declared);
    }
  }

  const paidMap = buildPaidThroughMap(paidThrough);
  return results
    .map((s) => {
      const paid = paidMap.get(overrideKey(s.merchantCanonical)) ?? null;
      const advanced = nextExpectedAfterPaidThrough(s.nextExpectedAt, s.cadence, paid);
      return {
        ...s,
        nextExpectedAt: advanced,
        paidThisCycle: advanced !== s.nextExpectedAt,
      };
    })
    .sort((a, b) => a.merchantCanonical.localeCompare(b.merchantCanonical));
}

/** The cadences a detected series is projected under. IRREGULAR never reaches
 *  here (detectRecurring drops it); QUARTERLY, SEMIANNUAL and ANNUAL reach it
 *  for EXPENSES only, and only while still charging — see
 *  `toScheduledTransactions`. */
export type ProjectedCadence = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'ANNUAL';

/**
 * Whether a series may be projected from EVERY cash account (L.25), or must stay
 * on the payment account as it always has. The widening admits only series that
 * NO other term already counts — otherwise it would spread an existing double
 * count onto accounts that never had one:
 *
 *  - INCOME is not merely a figure; the L.11(D) reservation nets scheduled income
 *    against card payments that must leave the PAYMENT account, so a deposit
 *    landing in savings would shrink it on the assumption the reader moves the
 *    money (L.25 claims critic P1-1, measured by the money critic at $4,000.00 of
 *    guilt-free spending on a single fixture).
 *  - An AUTO-LOAN ACH is the one `isTransfer` class detection deliberately keeps
 *    (see `detectRecurring`), and the same payment is ALSO painted from the linked
 *    LOAN account's obligation. That double count is the accepted #134 residual —
 *    disclosed on the radar, and only for the payment account. Widening it would
 *    have put the same $385.00 on /calendar twice on the same day for a second
 *    checking, with no surface disclosing it (L.25 money critic P1-2, executed).
 *
 * CREDIT-account series need no clause here: they are excluded by the caller's
 * cash set, for the same "already inside another term" reason.
 */
function widensToEveryCashAccount(s: RecurringSeriesResult): boolean {
  return !s.isIncome && s.categoryId !== 'auto-loan';
}

/** Cadences longer than a month: projected for expenses only, and only while
 *  the series is still charging. One list, so the rule L.23 established for
 *  ANNUAL and L.24 extended to the two new cadences cannot be applied to one
 *  and forgotten on another. */
const LONG_CADENCES: ReadonlySet<Cadence> = new Set<Cadence>(['QUARTERLY', 'SEMIANNUAL', 'ANNUAL']);

/** Nominal cadence length in days — the basis of the active/lapsed cutoff.
 *  Lives here, with the detector that assigns the cadence, so the projection
 *  filter and the /recurring summary share ONE rule instead of two copies that
 *  can drift (`summarizeRecurring` imports it). */
export const CADENCE_DAYS: Record<Cadence, number> = {
  WEEKLY: 7,
  BIWEEKLY: 14,
  MONTHLY: 30,
  QUARTERLY: 91,
  SEMIANNUAL: 182,
  ANNUAL: 365,
  IRREGULAR: 0,
};

/**
 * Is this series still charging? False once it is overdue by more than half a
 * cadence again — the exact rule /recurring uses to file a series under "no
 * longer charging" and to drop it out of the monthly-spend headline.
 *
 * Shared, not copied, because the two callers must agree by construction: when
 * they disagreed, a lapsed series read $0/month on /recurring and a full
 * monthly rate inside the spending plan (found independently by both L.23
 * critics). Cadence-scaled on purpose — the cutoff is ~45 days on a monthly
 * bill and ~548 on an annual one, because that is how long silence takes to
 * become evidence at each rhythm.
 */
export function isSeriesActive(
  series: Pick<RecurringSeriesResult, 'cadence' | 'lastSeenAt' | 'declaredByUser'>,
  today: ISODate,
): boolean {
  // A DECLARED series is never lapsed, and this is the rule that keeps the two
  // surfaces agreeing (money critic P1-2, executed): silence is evidence of death
  // only where the app INFERRED the rhythm from charges. Where the reader has just
  // said "this repeats monthly" while looking at a charge from two months ago, the
  // declaration is the fresher evidence — and without this, /recurring filed his
  // brand-new instruction under "no longer charging" at $0/month while the spending
  // plan and the calendar carried the full rate, which is exactly the split both
  // L.23 critics rated P1. It stays projected until he removes the instruction,
  // which is one click on the page that lists it.
  if (series.declaredByUser) return true;
  return daysBetween(series.lastSeenAt, today) <= Math.round(CADENCE_DAYS[series.cadence] * 1.5);
}

/**
 * Map detected recurring series to ScheduledTransaction rows — this is how
 * Phase 2 feeds the Phase 1 cash-needed projection. EXPENSES come from any of
 * the user's cash accounts; INCOME only from the payment account (see the
 * account-scope section below, which is the asymmetry, not an oversight).
 *
 * WHY ANNUAL EXPENSES ARE PROJECTED (L.23, the L.22 money-critic P1-2 residual).
 * While this filter was W/B/M only, a detected annual bill reached NO surface
 * that projects money: `src/server/recurring.ts` is the only writer of the
 * ScheduledTransaction table in the app, so the spending plan's `/12` rule —
 * written for exactly that bill — was dead for every row in production, and a
 * $1,200/yr premium overstated guilt-free spending by $100 every month. The
 * /recurring page's own headline already normalized the same series at 1/12
 * (summary.ts PER_MONTH), so two surfaces disagreed about one fact.
 *
 * WHY ANNUAL INCOME IS NOT — the failure direction differs by ROLE, not by
 * class of value (the L.14 lesson). An annual BILL can only ask the reader to
 * hold more cash: in the plan it raises fixed expenses, and in the ≤90-day
 * projections it lands as one dated outflow. An annual BONUS does the opposite
 * — projected on a date inferred from a 365-day gap, it offsets a dip and can
 * silence a warning the reader would otherwise act on, and an annual event's
 * date moves by weeks where a paycheck's moves by days. The plan does not need
 * it either: the trailing median already saw the month a bonus arrived in, and
 * dividing it into the no-history fallback would manufacture monthly income
 * that never arrives monthly — the phantom-income class the L.22 re-spec
 * exists to kill. So it stays out until a slice can date it from better
 * evidence than one gap.
 *
 * AND ONLY WHILE IT IS STILL CHARGING. `detectRecurring` reads all of history
 * with no staleness gate, and `nextExpectedAt` steps a dormant anchor forward
 * until it is in the future — so a policy last charged in 2021 detects today
 * with `nextExpectedAt` next August. Both L.23 critics found this independently
 * and executed it: /recurring files that series under "no longer charging" and
 * counts it $0, while the plan counted a full $100/month forever and the
 * calendar printed a dated −$1,200 for a cancelled policy. The lapse gate is
 * `isSeriesActive` — the SAME predicate /recurring files by, so the two surfaces
 * agree by construction. It is applied to the LONG cadences only: at 365 days
 * the silence needed to prove death is ~18 months, at 182 ~9, at 91 ~4.5, where
 * a monthly bill's is ~45 days — and widening the gate to WEEKLY/BIWEEKLY/
 * MONTHLY would change what is projected for every existing user, in the
 * direction of dropping bills (recorded in docs/STATUS.md instead).
 *
 * QUARTERLY AND SEMIANNUAL JOINED ANNUAL IN L.24, under exactly the same two
 * conditions (expenses only, still charging) — which is why the three share one
 * `LONG_CADENCES` list rather than three copies of the same pair of clauses.
 * Until then a ~91/182-day gap classified as IRREGULAR and `detectRecurring`
 * dropped it before this function saw it, so a quarterly water bill was counted
 * ZERO times: absent from the plan, from the projections and from /recurring
 * alike, which is the same direction as the annual gap L.23 closed (guilt-free
 * spending overstated by the bill's whole monthly share). Adding them is a
 * detection-CLASS change, not a passthrough — see `cadenceFromGaps`, whose
 * every-gap licence exists because a false quarterly does not merely mis-state
 * a figure: it prints a dated outflow on /calendar and can raise a radar
 * "move $X by <date>" instruction for a bill that does not exist.
 *
 * STILL NOT PROJECTED, recorded in docs/STATUS.md: every rhythm between and
 * around those bands — 10-day, three-weekly, six-weekly, bi-monthly (~61 days),
 * and anything from 99 to 174 or 191 to 349 days — all still IRREGULAR.
 *
 * EVERY CASH ACCOUNT FOR EXPENSES, THE PAYMENT ACCOUNT FOR INCOME (L.25).
 * This filtered EVERYTHING to the single resolved PAYMENT account, so a bill
 * autopaid from a second checking or from savings was projected NOWHERE:
 * $100/month on /recurring and $0 in the plan, the same uncounted-bill
 * direction as the L.23/L.24 gaps. That filter was also in the wrong place —
 * the three consumers that walk ONE account's running balance (`assemble.ts`
 * cash-needed, `forecast.ts`, `radar.ts`) each re-filter to the payment account
 * at their own read site, so narrowing here protected nothing they did not
 * already protect, and starved the two consumers that legitimately span
 * accounts: the spending plan's fixed term and the calendar.
 *
 * The two directions are NOT symmetric, and the first L.25 draft got this wrong
 * by widening both (caught by the claims critic, P1-1). An EXPENSE anywhere is
 * money that leaves: wherever it is charged, it reduces what the reader may
 * spend, so widening it can only make the plan more complete. INCOME is an
 * INSTRUCTION's input, not just a figure — the L.11(D) beyond-month reservation
 * nets scheduled income against card payments that must leave the PAYMENT
 * account, so counting a deposit that lands in savings would shrink the
 * reservation on the assumption the reader will move it, which is the
 * figure-vs-instruction error L.14 records. Income therefore keeps exactly the
 * scope it has always had, and this slice changes nothing about it. (The LONG
 * cadences exclude income outright, above; this asymmetry is what governs the
 * WEEKLY/BIWEEKLY/MONTHLY branch, where detected payroll lives.)
 *
 * The general rule both exceptions instance — see `widensToEveryCashAccount` —
 * is that only a series NO OTHER TERM already counts may widen. Income is one
 * case; the auto-loan ACH, which the linked LOAN account also paints, is the
 * other.
 *
 * The caller passes the user's CASH accounts (CHECKING/SAVINGS, minus any
 * superseded predecessor). CREDIT is deliberately excluded and must stay so: a
 * subscription charged to a card is already inside the plan's card-obligation
 * term whenever that card's payment is itself in the term, so counting it here
 * too would double-count it, and the calendar would paint it twice — once as
 * its own row and once inside the card's due amount. (When the card is UNDATED
 * its obligation is excluded entirely, so its subscriptions are uncounted as
 * well — recorded in docs/STATUS.md, not fixed by widening into a double count.)
 * The set is the caller's to resolve because "which accounts are cash" is a fact
 * about the user's accounts, which this pure module never sees.
 *
 * A series' `accountId` is `last.accountId` — the account of its most recent
 * charge, not a scope. A bill that MIGRATED from checking to a card is therefore
 * counted here only until its first card charge lands, and from then on only via
 * the card obligation; the handover is one cycle, in the safe direction (it is
 * never counted in both places at once).
 */
/** Where a projection may read money from. The two scopes are deliberately
 *  different and NOT symmetric — see this function's docblock (L.25). */
export interface ProjectionScope {
  /** Where INCOME may be projected from. Null when the user has no cash account. */
  paymentAccountId: string | null;
  /** Where EXPENSES may be projected from: every CHECKING/SAVINGS, minus superseded. */
  cashAccountIds: ReadonlySet<string>;
}

/**
 * WHY A SERIES IS OR IS NOT PROJECTED — the closed set of reasons (L.30).
 *
 * The two filters below used to throw this away: a series was dropped and the
 * reason died with the predicate that dropped it. That is how "Fixed & recurring
 * expenses — $0.00" came to mean four different things and print one pixel, and
 * it is why the L.26 defect — every bill re-keyed onto a superseded predecessor
 * this scope excludes — survived four sessions of the owner looking straight at
 * that line. A true zero and a broken zero were indistinguishable downstream
 * because nothing downstream was ever told them apart.
 *
 * This is not a second opinion about the filters: `toScheduledTransactions` is
 * implemented IN TERMS of this function, so a projected row and its recorded
 * reason cannot disagree. Same fence-by-construction rule L.23 applied to the
 * lapse predicate — share the predicate, never re-derive the arithmetic.
 */
export type SeriesProjectionStatus =
  /** Projected: this series became a ScheduledTransaction row. */
  | 'counted'
  /** Not projected as a cash ScheduledTransaction: the charge lands on a CREDIT
   *  account. Correct for cash-needed (the payment settles later). Plan Fixed
   *  still counts those purchases via Fixed categories — the card bill does not. */
  | 'on-card'
  /** Not projected: a long-rhythm series that has stopped charging
   *  (`isSeriesActive`). A CORRECT absence. */
  | 'lapsed'
  /** Not projected: income at a rhythm longer than monthly — deliberate, and
   *  asymmetric with expenses for the reason the docblock above gives. */
  | 'long-cadence-income'
  /** Not projected: the account this series charges is not one the projection
   *  reads, and it is not a credit card either. For an EXPENSE this is the
   *  ALARM — the L.26 signature — and it also catches the auto-loan ACH that
   *  must stay on the payment account. For INCOME it is the deliberate L.25
   *  asymmetry (a deposit landing in savings). */
  | 'off-scope'
  /** Not projected: no CHECKING or SAVINGS account exists to project from. */
  | 'no-cash-account'
  /** Not projected: the reader has CONFIRMED that this income has paused (#251).
   *  Decided by consent in `src/server/recurring.ts`, not by this pure function,
   *  which never sees a confirmation row — it is in this union because the stored
   *  column has to be able to say so. */
  | 'income-paused'
  /** Not projected: a rhythm none of the six projected cadences covers.
   *  `detectRecurring` drops IRREGULAR before this function ever sees it, so no
   *  STORED row can carry this and nothing downstream branches on it. It exists
   *  because a total function may not pretend a case away. */
  | 'unrecognized-rhythm';

export function classifySeriesProjection(
  series: RecurringSeriesResult,
  scope: ProjectionScope & {
    /**
     * The user's CREDIT accounts. Needed only to NAME an absence from the cash
     * projection: a bill charged to a card is correctly absent from ScheduledTransaction
     * rows; a bill charged to an account the projection cannot read is not. Plan
     * Fixed still counts card purchases via Fixed categories separately.
     */
    creditAccountIds: ReadonlySet<string>;
  },
  today: ISODate,
): SeriesProjectionStatus {
  // ORDER: cadence gate, then the card, then the cash gap, then scope.
  //
  // CADENCE FIRST. Where both a cadence reason and an account reason apply, the
  // honest one is the cadence: a series that is not due to be counted at all cannot
  // be the victim of a scope defect, so reporting it as one would be a false alarm.
  // Safe because the lapse gate reaches only the LONG cadences — a MONTHLY bill on
  // a ghost account can never be masked by it, and that is the case the alarm
  // exists for. It also keeps a LAPSED card bill reported as lapsed: nothing is
  // charging, so no line "holds" it and 'on-card' would over-claim.
  //
  // THEN THE CARD, ahead of the cash gap (critic P2-1, executed): a reader who has
  // linked only credit cards, with every bill charged to them, was told "no checking
  // or savings account linked" — literally true, not the operative mechanism for
  // cash projection. Plan Fixed does not use this status as "held by the card bill"
  // (owner 2026-08-01): purchases on the card enter Fixed via category rollup.
  if (LONG_CADENCES.has(series.cadence)) {
    if (series.isIncome) return 'long-cadence-income';
    if (!isSeriesActive(series, today)) return 'lapsed';
  } else if (
    series.cadence !== 'WEEKLY' &&
    series.cadence !== 'BIWEEKLY' &&
    series.cadence !== 'MONTHLY'
  ) {
    return 'unrecognized-rhythm';
  }
  if (!series.isIncome && scope.creditAccountIds.has(series.accountId)) return 'on-card';
  if (scope.cashAccountIds.size === 0) return 'no-cash-account';
  const inScope = widensToEveryCashAccount(series)
    ? scope.cashAccountIds.has(series.accountId)
    : series.accountId === scope.paymentAccountId;
  if (inScope) return 'counted';
  return scope.creditAccountIds.has(series.accountId) ? 'on-card' : 'off-scope';
}

/** The ScheduledTransaction shape one admitted series becomes. Split out so the
 *  admission decision (above) and the mapping (here) are separately reusable by
 *  the one writer, which needs both halves in a single pass. */
export function toScheduledRow(series: RecurringSeriesResult): {
  accountId: string;
  description: string;
  amountCents: number;
  nextDate: string;
  cadence: ProjectedCadence;
  source: string;
} {
  return {
    accountId: series.accountId,
    description: series.merchantCanonical,
    amountCents: series.typicalAmountCents,
    nextDate: series.nextExpectedAt,
    // Never null: `classifySeriesProjection` returns 'counted' only for the six
    // projected cadences (W/B/M plus the three LONG ones L.23/L.24 added), so
    // this cannot emit the one-off shape the DB column also allows.
    cadence: series.cadence as ProjectedCadence,
    source: series.isIncome ? 'payroll-detected' : 'recurring',
  };
}

export function toScheduledTransactions(
  series: readonly RecurringSeriesResult[],
  scope: ProjectionScope,
  today: ISODate,
): {
  accountId: string;
  description: string;
  amountCents: number;
  nextDate: string;
  // Never null: the filter above admits exactly the six projected cadences (the
  // three W/B/M plus the three LONG ones L.23/L.24 added), so this function
  // cannot emit the one-off shape the DB column also allows.
  cadence: ProjectedCadence;
  source: string;
}[] {
  // An EMPTY credit set is passed on purpose. It changes only which NAME an
  // absence gets ('on-card' against 'off-scope'), and this function reads no
  // name — it keeps exactly the rows `=== 'counted'` admits, which is the same
  // set both filters admitted before. The one caller that consumes the reason
  // (`src/server/recurring.ts`) passes the real set.
  const scopeWithoutReasons = { ...scope, creditAccountIds: new Set<string>() };
  return series
    .filter((s) => classifySeriesProjection(s, scopeWithoutReasons, today) === 'counted')
    .map(toScheduledRow);
}
