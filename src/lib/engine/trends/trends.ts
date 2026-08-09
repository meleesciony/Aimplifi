/**
 * Spending Trends engine (DECISIONS #74, surpass feature #7) — the
 * "what changed and what should I look at" surface that the category /
 * recurring / forecast views don't expose. Pure, deterministic, integer cents,
 * no I/O and NO model calls (every threshold is a constant here, LOOP rule 5).
 *
 * It is a thin, exact layer ON TOP of the already-tested reports engine
 * (`spendingByCategory`), so "what counts as spend" has ONE definition
 * (expenses only; transfers / split parents / income excluded; refunds net
 * down their own category, a net-refund category drops to 0). Every figure is
 * hand-verifiable to the cent.
 *
 * Four insights, each honest about its own basis:
 *  - pace      : the IN-PROGRESS month projected to month-end — money already
 *                counted, plus the bills the app can see still due this month,
 *                plus the rest of the month at the discretionary daily rate
 *                (a stated assumption) — vs last month's actual.
 *  - movers    : the LAST COMPLETED month vs the average of up to 3 completed
 *                months before it — exact, no partial-month distortion.
 *  - largest   : the biggest single purchases so far this month.
 *  - newMerchants: merchants you spent at this month but not in the prior 6.
 */
import {
  addMonthsToMonthKey,
  daysBetween,
  daysInMonth,
  isoDate,
  monthKey,
  monthWindow,
} from '@/lib/dates';
import { roundHalfAwayFromZero } from '@/lib/money';
import { CATEGORY_BY_ID, type CategoryMeta } from '@/lib/engine/categorize/categories';
import { monthsPerCadence } from '@/lib/engine/recurring/detect';
import { isExcludedFromTotals } from '@/lib/engine/transactions/exclude';
import {
  spendingByCategory,
  // Aliased because this module has its own narrower `isSpendRow` (purchases
  // only — inflows rejected). The register basis is the one an AGGREGATE reads
  // (O.7); the local one is what a row-NAMING insight reads. Two predicates, two
  // questions, and the alias is what stops a future edit from confusing them.
  isSpendRow as isRegisterSpendRow,
  spendContributionCents,
  spendRowCategoryId,
  type ReportTxn,
  type SpendWindow,
} from '@/lib/engine/reports/reports';

// ── Tunable thresholds (deterministic, in code) ─────────────────────────────
/** A mover must move at least this many cents to be worth surfacing. */
export const MOVER_MIN_ABS_CENTS = 2000; // $20
/** …and (for up/down) at least this fraction vs its baseline. */
export const MOVER_MIN_PCT = 0.2; // 20%
export const MAX_MOVERS = 6;
export const MAX_LARGEST = 5;
export const MAX_NEW_MERCHANTS = 5;
/** Completed months averaged into a mover's baseline. */
export const BASELINE_MONTHS = 3;
/** A merchant absent from this many prior months counts as "new". */
export const NEW_MERCHANT_LOOKBACK_MONTHS = 6;
/**
 * The catch-all group (transfer, credit-card-payment, cash/ATM, uncategorized).
 * Its members are money movement, not actionable spending, so they are kept out
 * of the category movers and out of WHICH rows may NAME something: "largest
 * purchases", and which merchants qualify as new.
 * (They still count toward the pace total, which mirrors the /reports and
 * /spending-plan definition of "money out this month" — one spend definition.)
 *
 * O.8a narrowed this claim rather than widening the guard. The new-merchant
 * AMOUNT is a register-basis aggregate, and the register counts these rows — so
 * once a merchant has been named by an actionable settled purchase, a
 * `cash`/`credit-card-payment`/unfiled row at that SAME canonical merchant does
 * reach its total, exactly as it reaches Ask's. Adding the guard to the money
 * pass would re-open the divergence this slice closed, and would re-break O.6's
 * P0 (unfiled rows vanishing). Reachability is bounded by the aggregate gate:
 * ATM/card-payment/Zelle descriptors normalize to aggregate pseudo-merchants,
 * which both passes skip. Locked in trends.test.ts.
 */
const NON_ACTIONABLE_GROUP = 'Transfers & Other';

export interface TrendTxn extends ReportTxn {
  /**
   * 'POSTED' | 'PENDING'. REQUIRED (O.6) rather than defaulted, because a silent
   * default here is a wrong answer that looks like no answer: this page asks two
   * different questions of the same rows, and only one of them wants pending.
   * The category figures (movers, pace) count pending — a pending charge has
   * genuinely reduced what you can spend, and every other spending surface counts
   * it. What does NOT count pending is a claim NAMING something as a settled
   * fact, because a pending amount is provisional: a fuel pre-authorisation posts
   * at $1 and settles at $60, so "your biggest purchase" would be a sentence
   * about a figure that has not happened yet.
   *
   * That line runs through `newMerchants` rather than around it (O.8a). WHICH
   * merchants are new is a naming claim and stays settled-only; the AMOUNT
   * printed beside each one is an aggregate at merchant scope, the same question
   * Ask's `merchantSpend` answers, so it counts pending and nets refunds like
   * every other aggregate. `computeSpendingTrends` passes every row and each
   * insight applies its own narrowing, so a basis lives next to the claim it
   * describes instead of being decided one call up.
   */
  status: string;
  /**
   * The merchant table's category for this row, used ONLY by the two row-naming
   * insights (largest purchases, new merchants) and only as a fallback when
   * `categoryId` is null.
   *
   * Why a second field rather than folding it into `categoryId` (O.6): the two
   * are different claims. `categoryId` is the bucket a category FIGURE sums into,
   * and a mover figure is now a clickable claim that the register shows the same
   * rows — so it must be the stored column the register filters on, never a
   * derived value the destination cannot reproduce. The label beside a NAMED
   * merchant makes no such claim, and suppressing it does real harm: everything
   * in the `Transfers & Other` group is rejected as non-actionable, `uncategorized`
   * is in that group, so a null-category row with no fallback is dropped from the
   * insight entirely rather than labelled honestly. Ask's `toAskTxnRows` applies
   * the identical `stored ?? merchant` rule, which is what makes `computeLargest`'s
   * documented byte-parity with it true.
   */
  merchantCategoryId?: string | null;
  /** Display/canonical merchant — used for largest + new-merchant insights. */
  merchant?: string | null;
  /**
   * True for AGGREGATE pseudo-merchants — those `normalizeMerchant` marks
   * aggregate (Zelle, checks, ATM withdrawals, card payments, account transfers,
   * Unknown Merchant): one canonical name covers many unrelated payees, so "new
   * merchant" is meaningless for them and they are excluded from that list.
   * (A "Store Card Purchase" is intentionally NOT aggregate in this codebase —
   * it is a rule-eligible real merchant, see assign.ts `isRuleEligibleMerchant`
   * + the triage flow — so it can legitimately appear here, like on /reports.)
   */
  aggregateMerchant?: boolean;
  /**
   * DISPLAY ONLY — never read by any insight in this engine (O.18).
   *
   * These three exist so the /trends breakdown panel can be built from THIS
   * array, the one the mover figures were summed from, instead of from the
   * snapshot rows a second time. The first cut did build from the snapshot and
   * justified it with a paragraph arguing the two selections must be identical
   * because `toTrendTxns` copies every field `isSpendRow` reads; a hostile critic
   * mutated one of those fields (`excludeFromTotals`) and the ENTIRE suite stayed
   * green, because the demo seed holds zero reader-excluded rows and so cannot
   * express the failure. An argument no fixture can falsify is not a guarantee —
   * so the second derivation is gone and there is nothing left to argue about.
   *
   * `merchantName` is deliberately NOT `merchant`. That one is the normalizer's
   * canonical key, which the merchant insights GROUP and MATCH on; this one is
   * the name the register prints for the row (`Merchant.canonical`, which a
   * keyword rule's `renameTo` writes — O.13a). Folding them together would make
   * a reader's rename change which rows count as the same merchant.
   */
  id?: string;
  /** The bank's own text, carried for display beside the resolved name. */
  rawDescriptor?: string;
  /** The register's display name for this row — see the note above. */
  merchantName?: string;
}

/**
 * One stored `ScheduledTransaction` row, as the pace projection reads it.
 *
 * Structurally the snapshot's `ScheduledLike` minus `accountId`, which this
 * engine has no use for: an expense series is projected from every cash account
 * (L.25) and a purchase counts as spending whichever account it left, so there
 * is nothing to filter on. `description` is the canonical merchant name —
 * `toScheduledRow` writes `series.merchantCanonical`, the same value
 * `normalizeMerchant` puts on `TrendTxn.merchant`, which is what lets a bill be
 * matched to its own charges by an exact key rather than by a money heuristic
 * (the kind #134 rejected).
 */
export interface PaceBillInput {
  description: string;
  amountCents: number; // signed: outflow negative, inflow positive
  nextDate: string; // YYYY-MM-DD
  cadence: string | null; // the DB column's type, not the Cadence union
}

/** A known bill this month that the counted spend has not covered yet. */
export interface PaceBillDue {
  merchant: string;
  /** Positive magnitude still expected before month end. */
  amountCents: number;
}

export interface SpendingPace {
  ym: string; // the in-progress month, YYYY-MM
  daysElapsed: number; // 1..daysInMonth (inclusive of today)
  daysInMonth: number;
  /** Counted spend so far this month — measured, never modelled. */
  spentSoFarCents: number;
  /** Known bills still expected this month (Σ `billsStillDue`). */
  billsStillDueCents: number;
  /** Those bills by merchant, largest first — the projection's visible inputs. */
  billsStillDue: PaceBillDue[];
  /** Spent so far MINUS the bill money already counted; the rate's numerator. */
  discretionarySoFarCents: number;
  /** discretionarySoFar / elapsed days × the days left, rounded (audit P2:
   *  the divisor is the FRACTIONAL elapsed time, not the integer `daysElapsed`). */
  projectedRemainderCents: number;
  /** spentSoFar + billsStillDue + projectedRemainder. Never < spentSoFar. */
  projectedCents: number;
  priorMonthCents: number; // last full month's total spend
  deltaVsPriorCents: number; // projected − prior (positive = trending higher)
}

export interface CategoryMover {
  categoryId: string;
  name: string;
  group: string;
  currentCents: number; // last completed month
  /**
   * `currentCents` is a NET-REFUND CLAMP, not a measured zero: rows WERE filed
   * into this category in the compared month, but refunds netted them to zero
   * (or below), so `spendingByCategory` dropped the category and the figure is
   * held at $0.00. The collapsed row must name the clamp ("net $0.00 after
   * refunds") or the reader reads a measured nothing that the register
   * contradicts — the same $0.00 the expander already explains via
   * `clampedByNetRefund` (audit P2).
   */
  currentNetted: boolean;
  baselineCents: number; // averaged prior months (0 ⇒ new)
  deltaCents: number; // current − baseline (positive = up)
  pctChange: number | null; // deltaCents / baselineCents (null when baseline 0)
  direction: 'up' | 'down' | 'new';
}

export interface LargestTxn {
  date: string;
  merchant: string;
  categoryName: string;
  amountCents: number; // positive magnitude of the spend
}

export interface NewMerchant {
  merchant: string;
  categoryName: string;
  /**
   * Spending at this merchant this month, on the REGISTER basis (O.8a): posted
   * AND pending, refunds netted against it, bucketed by the stored category —
   * the same per-row predicate `spendingByCategory` and Ask's `merchantSpend`
   * both count on.
   *
   * WHAT THAT DOES **NOT** PROMISE, corrected by the O.8a critic after an
   * earlier draft of this comment claimed the two surfaces "cannot drift":
   * sharing a row BASIS is not sharing a merchant SCOPE. This list keys on the
   * exact canonical name; `merchantMatches` (answer.ts:733) matches a
   * bidirectional whole-word PREFIX, so a question about "Costco Gas" also
   * sweeps in "Costco". On the demo seed that is $37.38 here against $195.82
   * there — a gap this module cannot close, because it is Ask's name resolution,
   * not the money rule. It predates O.8a (the old settled-gross figure was the
   * same $37.38) and is recorded as TASKS O.10. `o8-merchant-basis-parity.test.ts`
   * pins BOTH halves: the basis agreeing, and the scope not.
   *
   * It used to be settled purchases only, gross. That is a true sentence and it
   * was disclosed on the card, but it made this surface answer "how much did I
   * spend at M this month" with different dollars than Ask did (measured: $65.00
   * here vs $80.00 there, off four rows) — the same one-question-two-bases sin
   * O.6/O.7 unified everywhere else, and pending is understated worst at exactly
   * these merchants, since a merchant you just started using is the one most
   * likely to have a charge that has not settled.
   *
   * The naming half did NOT move: a merchant still only qualifies as new on a
   * settled purchase, because "you shopped somewhere new" is a claim about an
   * event and a pending authorisation has not finished being one.
   *
   * Always > 0. #74 accepted the gross simplification to avoid "a confusing
   * negative new-merchant line"; netting answers that by DROPPING a merchant
   * whose net is ≤ 0, which is the rule `spendingByCategory` already applies to
   * a net-refunded category (reports.ts:78) rather than a new one.
   */
  amountCents: number;
  firstDate: string; // earliest this-month date
}

export interface SpendingTrends {
  asOfYm: string; // the in-progress month
  comparedYm: string | null; // the last completed month the movers describe
  baselineMonths: string[]; // the completed months averaged into the baseline
  pace: SpendingPace | null;
  movers: CategoryMover[];
  largest: LargestTxn[];
  newMerchants: NewMerchant[];
  /**
   * O.19c: how many movers QUALIFIED before the `MAX_MOVERS` display cap. The
   * "What changed" header reads as complete, so when `moverTotal >
   * movers.length` a 7th mover is silently absent from a card titled as if
   * exhaustive — the UI states the cap ("top 6 of N") from these counts, and
   * stays byte-identical when the cap did not bind (the O.19b abstention rule).
   */
  moverTotal: number;
  /** O.19c: qualifying new merchants before the `MAX_NEW_MERCHANTS` cap. */
  newMerchantTotal: number;
}

export interface TrendsInput {
  txns: readonly TrendTxn[];
  today: string; // YYYY-MM-DD anchor
  /**
   * The bill calendar the app already owns (`snap.scheduled`). REQUIRED rather
   * than defaulted (C.2): a silent `[]` is the difference between "this reader
   * has no known bills" and "the caller forgot the bill calendar", and the
   * second one reads on screen as the first — a projection that ignores a
   * mortgage while claiming to describe the month. Every caller has to answer;
   * a fixture answering `[]` is stating that its month has no bills.
   */
  scheduled: readonly PaceBillInput[];
  /**
   * C.25 (#403): row ids of loan payments carried elsewhere — handed in by
   * the server from the snapshot assembler so movers and pace stop reading a
   * mortgage in the months settlement timing left it unflagged. Optional =
   * pre-C.25 behaviour when absent (demo golden unchanged).
   */
  excludedFlowIds?: ReadonlySet<string>;
  /**
   * C.25 (#403, critic P1-1): the merchant canonicals behind
   * `excludedFlowIds`. Pace's bill basis needs them at MERCHANT scope: a
   * carried-elsewhere payment's scheduled expectation must leave both the
   * still-due figure and the posted credit, or the projection counts it
   * twice / not at all.
   */
  excludedLoanCanonicals?: ReadonlySet<string>;
  /**
   * Audit P2: the fraction of business "today" already elapsed, in [0, 1) —
   * read from the sanctioned wall clock (`businessDayFraction`). The pace
   * rate divides by `(day − 1) + fraction` instead of counting the
   * in-progress day as whole, so the headline tracks real elapsed time
   * rather than sitting flat all day and stepping at midnight. Default 1 =
   * the pre-fix behaviour exactly (every existing known-answer test).
   */
  elapsedDayFraction?: number;
}

const groupOf = (id: string | null | undefined, meta: ReadonlyMap<string, CategoryMeta>) =>
  meta.get(id ?? 'uncategorized')?.group;
const catName = (id: string | null | undefined, meta: ReadonlyMap<string, CategoryMeta>) =>
  (id ? meta.get(id)?.name : undefined) ?? 'Uncategorized';

/**
 * The category a row-NAMING insight labels this row with: the stored column when
 * the reader has filed it, otherwise the merchant table's mapping (O.6). Never
 * used by a category FIGURE — see `TrendTxn.merchantCategoryId` for why the two
 * must not share a field, and `answer.ts` `namedCategoryId` for the identical rule
 * that keeps the two surfaces byte-identical.
 */
const namedCategoryId = (t: TrendTxn): string | null | undefined => t.categoryId ?? t.merchantCategoryId;

/**
 * One spend row = a real outflow that the reports engine would count.
 *
 * Reads the NAMED category (stored, else the merchant table) because its only
 * caller is `isPurchaseRow`, and Ask resolves the identical rule in its own
 * `namedCategoryId`. O.7 moved that merge OUT of Ask's row builder —
 * `toAskTxnRows` now carries the stored and merchant categories side by side,
 * exactly as `TrendTxn` does, and merges them at the predicate — so both
 * surfaces still evaluate the transfer/Income exclusions on the SAME value.
 * Evaluating them on different values is exactly how the documented byte-parity
 * between the two surfaces would rot (O.6).
 */
function isSpendRow(t: TrendTxn, meta: ReadonlyMap<string, CategoryMeta>): boolean {
  if (t.isSplitParent || t.isTransfer || isExcludedFromTotals(t)) return false;
  if (t.amountCents >= 0) return false; // refunds/inflows are not "purchases"
  const id = namedCategoryId(t) ?? 'uncategorized';
  if (id === 'transfer') return false;
  if (meta.get(id)?.group === 'Income') return false;
  return true;
}

/** A spend row in an actionable category (excludes cash/transfer/cc-payment/uncategorized). */
function isPurchaseRow(t: TrendTxn, meta: ReadonlyMap<string, CategoryMeta>): boolean {
  return isSpendRow(t, meta) && groupOf(namedCategoryId(t), meta) !== NON_ACTIONABLE_GROUP;
}

/** Per-leaf-category spend for a single month, via the shared reports engine. */
function categorySpendMap(
  txns: readonly TrendTxn[],
  ym: string,
  meta: ReadonlyMap<string, CategoryMeta>,
  excludedFlowIds?: ReadonlySet<string>, // C.25 (#403)
): Map<string, number> {
  const { byCategory } = spendingByCategory(txns, { fromYm: ym, toYm: ym }, meta, excludedFlowIds);
  return new Map(byCategory.map((c) => [c.categoryId, c.amountCents]));
}

/**
 * Raw per-category net for one month — INCLUDING the categories
 * `spendingByCategory` drops (`<= 0`). The mover figure for those is a clamped
 * $0.00, and this is the only pass that still knows whether that zero is a
 * MEASUREMENT (nothing was filed) or a CLAMP (rows were filed and refunds
 * netted them away) — the difference between "spent nothing" and "spent and
 * got it back" (audit P2: the collapsed row printed the clamped $0.00 as a
 * fact). It selects rows with the reports engine's OWN exported predicate and
 * buckets them with its OWN id rule — never a copy, the glass-box rule — so a
 * key here is exactly a category `categorySpendMap` would have held had its
 * net been positive.
 */
function rawCategoryNetMap(
  txns: readonly TrendTxn[],
  ym: string,
  meta: ReadonlyMap<string, CategoryMeta>,
  excludedFlowIds?: ReadonlySet<string>, // C.25 (#403)
): Map<string, number> {
  const range: SpendWindow = { fromYm: ym, toYm: ym };
  const totals = new Map<string, number>();
  for (const t of txns) {
    if (!isRegisterSpendRow(t, range, meta, excludedFlowIds)) continue;
    const id = spendRowCategoryId(t);
    totals.set(id, (totals.get(id) ?? 0) + spendContributionCents(t));
  }
  return totals;
}

/**
 * How many times a scheduled row falls inside the calendar month `ym` — the
 * WHOLE month, including occurrences already past.
 *
 * The repo has five forward expanders (cash-needed/assemble, forecast, calendar,
 * the plan's `scheduledOccurrencesBetween`, and radar's cycle synthesis) and
 * none of them fits: every one is anchored at `today` and walks forward, because
 * every one of them is answering "what is still coming". This asks a different
 * question — how much of THIS month is bill money at all, including the mortgage
 * that landed on the 1st — so the window opens before `today` and a row whose
 * `nextDate` is next month still has an occurrence here.
 *
 * It shares the one cadence table (`monthsPerCadence`) rather than carrying a
 * sixth copy of the ternary chain, which is the failure that table exists to
 * prevent: a missed branch falls through to "one occurrence" in silence.
 *
 * Month-family cadences need no walking at all — an occurrence lands in `ym`
 * exactly when the month distance from `nextDate` is a whole number of steps,
 * which is also why stepping backwards through `addMonthsClamped` is avoided
 * (that function is not invertible: Jan 31 → Feb 28 → Mar 28).
 */
export function billOccurrencesInMonth(bill: PaceBillInput, ym: string): number {
  const monthStep = monthsPerCadence(bill.cadence);
  if (monthStep > 0) {
    const billYm = monthKey(bill.nextDate);
    const diff =
      (Number(ym.slice(0, 4)) - Number(billYm.slice(0, 4))) * 12 +
      (Number(ym.slice(5, 7)) - Number(billYm.slice(5, 7)));
    // Symmetric modulo — `diff` is negative for every month before `nextDate`,
    // and JS's `%` keeps the sign.
    return ((diff % monthStep) + monthStep) % monthStep === 0 ? 1 : 0;
  }
  if (bill.cadence === 'WEEKLY' || bill.cadence === 'BIWEEKLY') {
    const step = bill.cadence === 'WEEKLY' ? 7 : 14;
    const anchor = isoDate(bill.nextDate);
    const { from, to } = monthWindow(ym);
    // Occurrences are anchor + k·step for any INTEGER k, so count the k's that
    // land in [from, to] instead of walking (a stale anchor could be years off).
    const first = Math.ceil(daysBetween(anchor, from) / step);
    const last = Math.floor(daysBetween(anchor, to) / step);
    return Math.max(0, last - first + 1);
  }
  // One-off (null cadence): the DB column allows it and the seeder writes it,
  // though `toScheduledRow` never emits one.
  return monthKey(bill.nextDate) === ym ? 1 : 0;
}

/**
 * The bills this month, keyed by canonical merchant, with the money already
 * counted against each one.
 *
 * ADMISSION RULE — a bill enters the projection only if the app has EVER counted
 * a purchase at that merchant, on the very basis the projection is compared
 * against. "Ever", not "this month": the whole case this fix exists for is a
 * mortgage that has not been charged yet, so requiring a charge in the month
 * being projected would refuse exactly the bill the owner asked about. The two
 * windows below are therefore different on purpose — admission looks at all the
 * history the engine holds, and the credit that says "this bill already landed"
 * looks only at this month.
 *
 * Everything else follows from that one rule:
 *
 *  - It keeps out the auto-loan ACH, the one `isTransfer` class `detectRecurring`
 *    deliberately keeps (detect.ts:380). That payment is real money, and it is in
 *    NEITHER side of this comparison — not in `spentSoFarCents`, not in
 *    `priorMonthCents` — so adding its bill to the projection would import a
 *    figure from another basis and report the month as heavier than the month it
 *    is being compared with (`a-borrowed-total-imports-its-window`).
 *  - It keeps out the demo seed's `Auto-transfer to savings`, and any other
 *    scheduled row that moves money rather than spending it, without this engine
 *    needing to know what a transfer is.
 *  - It keeps out a hand-authored row whose `description` is a label rather than
 *    a merchant ("Rent — Peachtree Properties"), where the key cannot match and a
 *    guess would be exactly the money heuristic #134 rejected.
 *
 * AGGREGATE merchants are excluded for the same reason `computeNewMerchants`
 * excludes them: "Zelle Payment" is one canonical name over many unrelated
 * payees, so matching a bill to it would credit one gardener's charge with
 * another payee's money (`a-typed-key-is-a-pattern-not-an-identity`).
 */
function billsThisMonth(
  scheduled: readonly PaceBillInput[],
  txns: readonly TrendTxn[],
  today: string,
  ym: string,
  meta: ReadonlyMap<string, CategoryMeta>,
  // C.25 (#403, critic P1-1): the canonicals of loan payments carried
  // elsewhere. Their charges left `spentSoFar` via the flow exclusion, so
  // their scheduled expectations must leave BOTH halves of the bill basis —
  // the still-due figure and the posted credit. Leaving either half in
  // counts the payment twice (subtracting it again as a credit) or not at
  // all (demanding it as still due), and the credit half re-introduces the
  // stored-flag settlement flip this module exists to kill.
  excludedLoanCanonicals?: ReadonlySet<string>,
): { stillDue: PaceBillDue[]; stillDueCents: number; creditedCents: number } {
  const key = (m: string) => m.trim().toLowerCase();
  const excludedKeys =
    excludedLoanCanonicals === undefined
      ? undefined
      : new Set([...excludedLoanCanonicals].map((c) => key(c)));

  // Expected: one entry per merchant, so two series on one name cannot be
  // compared against the same charges twice.
  const expected = new Map<string, { merchant: string; cents: number }>();
  for (const bill of scheduled) {
    if (bill.amountCents >= 0) continue; // income and $0 rows are not bills
    const occurrences = billOccurrencesInMonth(bill, ym);
    if (occurrences === 0) continue;
    const k = key(bill.description);
    if (!k) continue;
    if (excludedKeys?.has(k)) continue; // carried elsewhere — not this basis
    const prev = expected.get(k);
    const cents = Math.abs(bill.amountCents) * occurrences;
    if (prev) prev.cents += cents;
    else expected.set(k, { merchant: bill.description.trim(), cents });
  }
  if (expected.size === 0) return { stillDue: [], stillDueCents: 0, creditedCents: 0 };

  // ONE walk, two questions. `counted` answers the admission rule over all the
  // history the engine holds — a purchase at this merchant has landed in a spend
  // total at some point, so its money is inside the basis being projected.
  // `posted` answers "has this month's occurrence already been charged", and is
  // therefore scoped to this month, `<= today`, and summed on the register basis
  // (refunds net down) exactly as the month total the credit is taken out of.
  const counted = new Set<string>();
  const posted = new Map<string, number>();
  const aggregate = new Set<string>();
  for (const t of txns) {
    if (!t.merchant) continue;
    const k = key(t.merchant);
    if (!expected.has(k)) continue;
    // Aggregate-ness is learned from EVERY row, future ones included: it is a
    // fact about the merchant string rather than about money, and it only ever
    // REFUSES a bill. Learning it from more rows can only make the engine more
    // cautious, so it is deliberately outside the date guard below.
    if (t.aggregateMerchant) aggregate.add(k);
    // Admission is not (C.2 critic P1-1). A future-dated row is in NEITHER side
    // of the comparison — not in `spentSoFarCents` (`soFar` filters it out), not
    // in `priorMonthCents` — so letting one admit a bill imports a merchant
    // whose money has never been in the basis, which is the exact import this
    // rule exists to prevent (`a-borrowed-total-imports-its-window`). Every
    // sibling in this file already draws the line here: `computeLargest` and
    // `computeNewMerchants` both refuse to treat a future row as fact.
    if (t.date > today) continue;
    if (isSpendRow(t, meta)) counted.add(k);
    if (!isRegisterSpendRow(t, { fromYm: ym, toYm: ym }, meta)) continue;
    posted.set(k, (posted.get(k) ?? 0) + spendContributionCents(t));
  }

  const stillDue: PaceBillDue[] = [];
  let stillDueCents = 0;
  let creditedCents = 0;
  for (const [k, exp] of expected) {
    // Never counted anywhere ⇒ this merchant's money is not in the basis at all
    // (see the admission rule above). Aggregate keys are not identities.
    if (!counted.has(k) || aggregate.has(k)) continue;
    const seen = Math.max(0, posted.get(k) ?? 0);
    // Credit at most what the bill itself is worth. A merchant can be both a
    // bill and a shop — $15 of Prime inside $415 of Amazon — and crediting the
    // whole $415 would delete $400 of real discretionary spending from the rate.
    const credited = Math.min(seen, exp.cents);
    creditedCents += credited;
    const due = exp.cents - credited;
    if (due > 0) {
      stillDueCents += due;
      stillDue.push({ merchant: exp.merchant, amountCents: due });
    }
  }
  stillDue.sort((a, b) => b.amountCents - a.amountCents || (a.merchant < b.merchant ? -1 : 1));
  return { stillDue, stillDueCents, creditedCents };
}

/**
 * The in-progress month projected to month end (C.2, CALC_AUDIT P1-1).
 *
 * It used to be `spentSoFar / daysElapsed × daysInMonth` — a household month
 * modelled as a uniform stream, when a household month is a few large bills plus
 * noise. The bias is not random, it has a shape: low before the bills land, then
 * wildly high overnight when they do. On the owner's own report, $578.79 over two
 * days projected $8,971.25 for a month whose mortgage alone is ~$6,200, and a
 * critic executed the other side of the same defect — the same account reading
 * "$6,200.18 LESS than last month" for four days, then "$32,239.82 MORE" the
 * morning the mortgage posted.
 *
 * So the month is projected in three named parts instead of one:
 *
 *     projected = spent so far  +  bills still due  +  discretionary × days left
 *
 * `spent so far` is measured. `bills still due` comes from the stored bill
 * calendar, matched to its own charges by merchant so a bill that has already
 * landed is not demanded twice — and never DATED against `today`, because a
 * mortgage dated the 1st that has not posted yet is still to come (the edge
 * L.11(D) is about). `discretionary` is what is left of spent-so-far once the
 * bill money is taken out, which is the only part a daily rate can honestly
 * describe.
 *
 * What it still does not know, and what the copy beside it may therefore never
 * claim to have counted: bills charged to a credit card (those series are
 * 'on-card' and produce no scheduled row), and bills the detector has not spotted
 * yet. Both keep being extrapolated by the daily rate, exactly as before.
 */
function computePace(
  txns: readonly TrendTxn[],
  today: string,
  scheduled: readonly PaceBillInput[],
  meta: ReadonlyMap<string, CategoryMeta>,
  excludedFlowIds?: ReadonlySet<string>, // C.25 (#403)
  excludedLoanCanonicals?: ReadonlySet<string>, // C.25 (#403, critic P1-1)
  elapsedDayFraction = 1, // audit P2: [0, 1) — 1 = the pre-fix whole-day divisor
): SpendingPace | null {
  const ym = monthKey(today);
  // Only money already spent counts toward "so far": ignore any future-dated rows.
  const soFar = txns.filter((t) => t.date <= today);
  const spentSoFarCents = spendingByCategory(soFar, { fromYm: ym, toYm: ym }, meta, excludedFlowIds)
    .totalCents;
  const prior = addMonthsToMonthKey(ym, -(1));
  const priorMonthCents = spendingByCategory(txns, { fromYm: prior, toYm: prior }, meta, excludedFlowIds)
    .totalCents;
  // C.1 (CALC_AUDIT 2026-08-02, P0-7): abstain on ZERO observations, whatever
  // last month did. The old guard was an AND, so a reader whose feed had not
  // yet delivered an August row was shown "$0.00 projected by month end" and a
  // green "on pace for $28,685.10 less than last month" — a claim about a month
  // nothing has been counted in. `spentSoFar / daysElapsed` is not a rate when
  // the numerator is zero; it is the absence of a measurement, and a true zero
  // (spent nothing) is indistinguishable here from a broken one (nothing synced,
  // or a charge and its refund netting out). The surfaces say so in words —
  // `PACE_NO_SPEND_YET` is written against exactly this, the only condition on
  // which this function returns null.
  if (spentSoFarCents === 0) return null;

  const [y, m] = [Number(ym.slice(0, 4)), Number(ym.slice(5, 7))];
  const dim = daysInMonth(y, m);
  const daysElapsed = Math.min(Number(today.slice(8, 10)), dim); // ≥1 for a real date
  // Audit P2: the in-progress day is NOT whole. The rate divides by how much
  // of the month has really elapsed — `day − 1` full days plus today's
  // fraction from the sanctioned clock — so the headline moves with real
  // time instead of sitting flat all day and jumping at midnight. The integer
  // `daysElapsed` above stays the DISPLAY figure ("first N days": N calendar
  // days whose rows are counted); THIS is the math figure. Floored at 1: a
  // rate over a fraction of day 1 is the audit's own "worthless" regime and
  // the day-1 lock already defines that figure; the floor also keeps the
  // divisor from vanishing at 00:00:00.
  const elapsed = Math.min(dim, Math.max(1, daysElapsed - 1 + elapsedDayFraction));
  const { stillDue, stillDueCents, creditedCents } = billsThisMonth(
    scheduled,
    txns,
    today,
    ym,
    meta,
    excludedLoanCanonicals,
  );
  // The month total nets refunds by CATEGORY and drops a net-refunded category
  // to zero, while the credit above is summed per MERCHANT — so in a
  // refund-heavy month the two bases can cross and the credit can exceed the
  // bill money actually sitting inside `spentSoFarCents`.
  //
  // This used to be `Math.max(0, spentSoFar - credited)`, and the clamp had the
  // wrong FAILURE DIRECTION (C.2 critic P1-2). It absorbed the crossing by
  // deleting real, unrelated spending from the rate: one net-refunded category
  // could take a genuine $30/day of dining to $0/day and collapse the rest of
  // the month to nothing. Under-projecting is this surface's dangerous
  // direction — "on pace to spend LESS than last month" is the reading that
  // makes someone relax.
  //
  // A crossing is DETECTABLE rather than silent, so it is handled: when the
  // credit cannot be trusted against this basis, take no credit at all. That
  // leaves bill money inside the daily rate — over-projecting, which a reader
  // can only act on by tightening — instead of deleting money that is genuinely
  // there. The branches are identical whenever the two bases agree, which is
  // every month without a net-refunded category.
  const basesCrossed = creditedCents > spentSoFarCents;
  const discretionarySoFarCents = basesCrossed
    ? spentSoFarCents
    : spentSoFarCents - creditedCents;
  // Multiply before dividing (audit P2): `(a / b) * c` rounds twice and violated
  // the repo's stated half-away-from-zero rule 140 times on the demo seed. The
  // divisor is `elapsed` — the fractional elapsed days (audit P2, above) — not
  // the integer `daysElapsed` the display phrases.
  const projectedRemainderCents = roundHalfAwayFromZero(
    (discretionarySoFarCents * (dim - elapsed)) / elapsed,
  );
  const projectedCents = spentSoFarCents + stillDueCents + projectedRemainderCents;
  return {
    ym,
    daysElapsed,
    daysInMonth: dim,
    spentSoFarCents,
    billsStillDueCents: stillDueCents,
    billsStillDue: stillDue,
    discretionarySoFarCents,
    projectedRemainderCents,
    projectedCents,
    priorMonthCents,
    deltaVsPriorCents: projectedCents - priorMonthCents,
  };
}

function computeMovers(
  txns: readonly TrendTxn[],
  today: string,
  meta: ReadonlyMap<string, CategoryMeta>,
  excludedFlowIds?: ReadonlySet<string>, // C.25 (#403)
): { comparedYm: string | null; baselineMonths: string[]; movers: CategoryMover[]; moverTotal: number } {
  const current = addMonthsToMonthKey(monthKey(today), -(1)); // last completed month
  const currentMap = categorySpendMap(txns, current, meta, excludedFlowIds);
  // Audit P2: `currentMap` drops net-refunded categories, so a mover whose
  // `currentCents` is 0 cannot tell a measured nothing from a clamp. This raw
  // pass (same predicate, same bucket ids — `rawCategoryNetMap`) records which
  // categories had ANY rows at all, so `currentNetted` is true exactly when
  // the dropped zero is a clamp. One extra linear pass over the rows the maps
  // already scan; it exists only to keep the printed zero honest.
  const rawCurrent = rawCategoryNetMap(txns, current, meta, excludedFlowIds);

  // Baseline = the up-to-3 completed months before `current` that actually have
  // spend (never average in pre-history zero months — it would understate the norm).
  const baselineMaps: { ym: string; map: Map<string, number> }[] = [];
  for (let i = 1; i <= BASELINE_MONTHS; i++) {
    const ym = addMonthsToMonthKey(current, -(i));
    const map = categorySpendMap(txns, ym, meta, excludedFlowIds);
    let total = 0;
    for (const v of map.values()) total += v;
    if (total > 0) baselineMaps.push({ ym, map });
  }

  if (currentMap.size === 0 && baselineMaps.length === 0) {
    return { comparedYm: null, baselineMonths: [], movers: [], moverTotal: 0 };
  }

  const ids = new Set<string>([...currentMap.keys(), ...baselineMaps.flatMap((b) => [...b.map.keys()])]);
  const movers: CategoryMover[] = [];
  for (const id of ids) {
    if (groupOf(id, meta) === NON_ACTIONABLE_GROUP) continue; // cash/transfer/cc-pay/uncategorized aren't insights
    const currentCents = currentMap.get(id) ?? 0;
    // A zero that is a CLAMP (rows filed, refunds netted them away) vs a zero
    // that is a MEASUREMENT (nothing filed) — see `currentNetted` on the type.
    const currentNetted = currentCents === 0 && rawCurrent.has(id);
    const baselineCents =
      baselineMaps.length === 0
        ? 0
        : roundHalfAwayFromZero(
            baselineMaps.reduce((s, b) => s + (b.map.get(id) ?? 0), 0) / baselineMaps.length,
          );
    const deltaCents = currentCents - baselineCents;

    let direction: CategoryMover['direction'];
    let surfaced: boolean;
    if (baselineCents === 0) {
      direction = 'new';
      surfaced = currentCents >= MOVER_MIN_ABS_CENTS;
    } else {
      direction = deltaCents >= 0 ? 'up' : 'down';
      surfaced =
        Math.abs(deltaCents) >= MOVER_MIN_ABS_CENTS &&
        Math.abs(deltaCents / baselineCents) >= MOVER_MIN_PCT;
    }
    if (!surfaced) continue;

    const cat = meta.get(id);
    movers.push({
      categoryId: id,
      name: cat?.name ?? 'Uncategorized',
      group: cat?.group ?? 'Other',
      currentCents,
      currentNetted,
      baselineCents,
      deltaCents,
      pctChange: baselineCents === 0 ? null : deltaCents / baselineCents,
      direction,
    });
  }

  // Biggest absolute swings first; stable tie-break by category id.
  movers.sort(
    (a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents) || (a.categoryId < b.categoryId ? -1 : 1),
  );
  return {
    comparedYm: current,
    baselineMonths: baselineMaps.map((b) => b.ym),
    movers: movers.slice(0, MAX_MOVERS),
    // Pre-cap count (O.19c) — from the SAME array the slice truncates, so
    // `moverTotal > movers.length` is exactly "the cap bound".
    moverTotal: movers.length,
  };
}

function computeLargest(
  txns: readonly TrendTxn[],
  today: string,
  meta: ReadonlyMap<string, CategoryMeta>,
  excludedFlowIds?: ReadonlySet<string>, // C.25 (#403, critic P2-A)
): LargestTxn[] {
  const ym = monthKey(today);
  return txns
    .filter(
      (t) =>
        t.date <= today &&
        monthKey(t.date) === ym &&
        isPurchaseRow(t, meta) &&
        // A carried-elsewhere loan payment is not a purchase — ranking it
        // "largest" beside totals that dropped it would contradict them.
        !(typeof t.id === 'string' && excludedFlowIds?.has(t.id)),
    )
    .map((t) => ({
      date: t.date,
      merchant: t.merchant?.trim() || 'Unknown merchant',
      categoryName: catName(namedCategoryId(t), meta),
      amountCents: -t.amountCents,
    }))
    // amount desc, then date, then merchant — fully deterministic on ties.
    .sort(
      (a, b) =>
        b.amountCents - a.amountCents ||
        (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
        (a.merchant < b.merchant ? -1 : a.merchant > b.merchant ? 1 : 0),
    )
    .slice(0, MAX_LARGEST);
}

/**
 * Merchants spent at this month but not in the prior `NEW_MERCHANT_LOOKBACK_MONTHS`.
 *
 * TWO passes on purpose (O.8a), because the card makes two different claims and
 * O.6/O.7 settled that they take different bases:
 *
 *  1. WHICH merchants are new — a claim about an EVENT ("you shopped somewhere
 *     new"), so it is licensed by settled purchase rows only. A pending
 *     authorisation can vanish, and a merchant named on one that never posts is
 *     a sentence about something that did not happen. This pass also fixes the
 *     label and the first-seen date, for the same reason.
 *  2. HOW MUCH was spent there — an AGGREGATE over a window at merchant scope,
 *     which is the same question `merchantSpend` answers, so it reads the
 *     register basis (posted AND pending, refunds netted, stored category). The
 *     predicate is literally the reports engine's, not a copy of it, so the two
 *     cannot drift ON THE ROW RULE. They can still differ on WHICH ROWS BELONG
 *     TO THE MERCHANT — see `NewMerchant.amountCents` for the prefix-matching
 *     gap and TASKS O.10.
 *
 * Receives ALL rows; the settled narrowing for pass 1 is applied here rather
 * than by the caller, so the two bases stay visible side by side.
 */
function computeNewMerchants(
  txns: readonly TrendTxn[],
  today: string,
  meta: ReadonlyMap<string, CategoryMeta>,
): { newMerchants: NewMerchant[]; newMerchantTotal: number } {
  const ym = monthKey(today);
  const earliestPrior = addMonthsToMonthKey(ym, -(NEW_MERCHANT_LOOKBACK_MONTHS)); // inclusive lower bound
  const merchantKey = (m: string) => m.trim().toLowerCase();

  // ── Pass 1: naming. Settled purchases only. ──────────────────────────────
  // Aggregate pseudo-merchants are skipped entirely — "new" is meaningless for
  // them, and it is the guard that keeps "ATM Withdrawal" out of the list.
  const isNamingRow = (t: TrendTxn) =>
    t.status === 'POSTED' && isPurchaseRow(t, meta) && !t.aggregateMerchant && !!t.merchant;

  const seenBefore = new Set<string>();
  for (const t of txns) {
    if (!isNamingRow(t)) continue;
    const m = monthKey(t.date);
    if (m >= earliestPrior && m < ym) seenBefore.add(merchantKey(t.merchant!));
  }

  const named = new Map<string, { merchant: string; categoryName: string; firstDate: string }>();
  for (const t of txns) {
    if (t.date > today || monthKey(t.date) !== ym || !isNamingRow(t)) continue;
    const key = merchantKey(t.merchant!);
    if (seenBefore.has(key)) continue;
    const prev = named.get(key);
    if (prev) {
      if (t.date < prev.firstDate) prev.firstDate = t.date;
    } else {
      named.set(key, {
        merchant: t.merchant!.trim(),
        categoryName: catName(namedCategoryId(t), meta),
        firstDate: t.date,
      });
    }
  }

  // ── Pass 2: the money. Register basis over the named merchants. ──────────
  // Same three predicates `merchantSpend` applies, in the same order: the window
  // (carried by `isSpendRow`), `<= today`, and the aggregate gate. A row that is
  // unfiled or pending counts here and is invisible to pass 1 — which is the
  // point: the reader is told a merchant is new by what settled, and told what
  // they spent there by what the register shows.
  const totals = new Map<string, number>();
  for (const t of txns) {
    if (t.date > today || !t.merchant || t.aggregateMerchant) continue;
    if (!isRegisterSpendRow(t, { fromYm: ym, toYm: ym }, meta)) continue;
    const key = merchantKey(t.merchant);
    if (!named.has(key)) continue;
    totals.set(key, (totals.get(key) ?? 0) + spendContributionCents(t));
  }

  const rows: NewMerchant[] = [];
  for (const [key, n] of named) {
    const amountCents = totals.get(key) ?? 0;
    // Net refund / zero → drop, the rule `spendingByCategory` applies to a
    // category (reports.ts:78). A merchant whose returns cancelled the month is
    // not a "new merchant" worth a line, and printing −$10.00 under "New this
    // month" is the confusing negative #74 declined to risk.
    if (amountCents <= 0) continue;
    rows.push({ merchant: n.merchant, categoryName: n.categoryName, amountCents, firstDate: n.firstDate });
  }

  rows.sort((a, b) => b.amountCents - a.amountCents || (a.merchant < b.merchant ? -1 : 1));
  // Pre-cap count beside the sliced list (O.19c) — same array, same rule as movers.
  return { newMerchants: rows.slice(0, MAX_NEW_MERCHANTS), newMerchantTotal: rows.length };
}

/** Compute all spending-trend insights from a posted-spend transaction list. */
export function computeSpendingTrends(
  { txns, today, scheduled, excludedFlowIds, excludedLoanCanonicals, elapsedDayFraction }: TrendsInput,
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
): SpendingTrends {
  const { comparedYm, baselineMonths, movers, moverTotal } = computeMovers(txns, today, meta, excludedFlowIds);
  // O.6 — the one place the two bases part company; see `TrendTxn.status`.
  // Category figures read every row; the row-naming insights read settled rows
  // only, which is also what Ask's `largestPurchases` reads (O.7 moved that filter off
  // the shared builder and into the one consumer that needs it), preserving the
  // documented "matches /trends computeLargest EXACTLY" parity on both axes.
  const settled = txns.filter((t) => t.status === 'POSTED');
  return {
    asOfYm: monthKey(today),
    comparedYm,
    baselineMonths,
    pace: computePace(txns, today, scheduled, meta, excludedFlowIds, excludedLoanCanonicals, elapsedDayFraction),
    movers,
    moverTotal,
    largest: computeLargest(settled, today, meta, excludedFlowIds),
    // ALL rows (O.8a) — `computeNewMerchants` applies the settled narrowing to
    // its naming pass itself, because only half of what that card prints is a
    // claim about a settled event; the money beside it is an aggregate.
    ...computeNewMerchants(txns, today, meta),
  };
}
