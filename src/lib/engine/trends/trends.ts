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
 *  - pace      : the IN-PROGRESS month projected to month-end at the current
 *                daily rate (a stated assumption), vs last month's actual.
 *  - movers    : the LAST COMPLETED month vs the average of up to 3 completed
 *                months before it — exact, no partial-month distortion.
 *  - largest   : the biggest single purchases so far this month.
 *  - newMerchants: merchants you spent at this month but not in the prior 6.
 */
import { addMonthsToMonthKey, daysInMonth, monthKey } from '@/lib/dates';
import { roundHalfAwayFromZero } from '@/lib/money';
import { CATEGORY_BY_ID, type CategoryMeta } from '@/lib/engine/categorize/categories';
import { isExcludedFromTotals } from '@/lib/engine/transactions/exclude';
import {
  spendingByCategory,
  // Aliased because this module has its own narrower `isSpendRow` (purchases
  // only — inflows rejected). The register basis is the one an AGGREGATE reads
  // (O.7); the local one is what a row-NAMING insight reads. Two predicates, two
  // questions, and the alias is what stops a future edit from confusing them.
  isSpendRow as isRegisterSpendRow,
  spendContributionCents,
  type ReportTxn,
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

export interface SpendingPace {
  ym: string; // the in-progress month, YYYY-MM
  daysElapsed: number; // 1..daysInMonth (inclusive of today)
  daysInMonth: number;
  spentSoFarCents: number;
  projectedCents: number; // spentSoFar / daysElapsed * daysInMonth, rounded
  priorMonthCents: number; // last full month's total spend
  deltaVsPriorCents: number; // projected − prior (positive = trending higher)
}

export interface CategoryMover {
  categoryId: string;
  name: string;
  group: string;
  currentCents: number; // last completed month
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
}

export interface TrendsInput {
  txns: readonly TrendTxn[];
  today: string; // YYYY-MM-DD anchor
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
): Map<string, number> {
  const { byCategory } = spendingByCategory(txns, { fromYm: ym, toYm: ym }, meta);
  return new Map(byCategory.map((c) => [c.categoryId, c.amountCents]));
}

function computePace(
  txns: readonly TrendTxn[],
  today: string,
  meta: ReadonlyMap<string, CategoryMeta>,
): SpendingPace | null {
  const ym = monthKey(today);
  // Only money already spent counts toward "so far": ignore any future-dated rows.
  const soFar = txns.filter((t) => t.date <= today);
  const spentSoFarCents = spendingByCategory(soFar, { fromYm: ym, toYm: ym }, meta).totalCents;
  const prior = addMonthsToMonthKey(ym, -(1));
  const priorMonthCents = spendingByCategory(txns, { fromYm: prior, toYm: prior }, meta).totalCents;
  if (spentSoFarCents === 0 && priorMonthCents === 0) return null; // nothing to say yet

  const [y, m] = [Number(ym.slice(0, 4)), Number(ym.slice(5, 7))];
  const dim = daysInMonth(y, m);
  const daysElapsed = Math.min(Number(today.slice(8, 10)), dim); // ≥1 for a real date
  const projectedCents = roundHalfAwayFromZero((spentSoFarCents / daysElapsed) * dim);
  return {
    ym,
    daysElapsed,
    daysInMonth: dim,
    spentSoFarCents,
    projectedCents,
    priorMonthCents,
    deltaVsPriorCents: projectedCents - priorMonthCents,
  };
}

function computeMovers(
  txns: readonly TrendTxn[],
  today: string,
  meta: ReadonlyMap<string, CategoryMeta>,
): { comparedYm: string | null; baselineMonths: string[]; movers: CategoryMover[] } {
  const current = addMonthsToMonthKey(monthKey(today), -(1)); // last completed month
  const currentMap = categorySpendMap(txns, current, meta);

  // Baseline = the up-to-3 completed months before `current` that actually have
  // spend (never average in pre-history zero months — it would understate the norm).
  const baselineMaps: { ym: string; map: Map<string, number> }[] = [];
  for (let i = 1; i <= BASELINE_MONTHS; i++) {
    const ym = addMonthsToMonthKey(current, -(i));
    const map = categorySpendMap(txns, ym, meta);
    let total = 0;
    for (const v of map.values()) total += v;
    if (total > 0) baselineMaps.push({ ym, map });
  }

  if (currentMap.size === 0 && baselineMaps.length === 0) {
    return { comparedYm: null, baselineMonths: [], movers: [] };
  }

  const ids = new Set<string>([...currentMap.keys(), ...baselineMaps.flatMap((b) => [...b.map.keys()])]);
  const movers: CategoryMover[] = [];
  for (const id of ids) {
    if (groupOf(id, meta) === NON_ACTIONABLE_GROUP) continue; // cash/transfer/cc-pay/uncategorized aren't insights
    const currentCents = currentMap.get(id) ?? 0;
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
  };
}

function computeLargest(
  txns: readonly TrendTxn[],
  today: string,
  meta: ReadonlyMap<string, CategoryMeta>,
): LargestTxn[] {
  const ym = monthKey(today);
  return txns
    .filter((t) => t.date <= today && monthKey(t.date) === ym && isPurchaseRow(t, meta))
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
): NewMerchant[] {
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

  return rows
    .sort((a, b) => b.amountCents - a.amountCents || (a.merchant < b.merchant ? -1 : 1))
    .slice(0, MAX_NEW_MERCHANTS);
}

/** Compute all spending-trend insights from a posted-spend transaction list. */
export function computeSpendingTrends(
  { txns, today }: TrendsInput,
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
): SpendingTrends {
  const { comparedYm, baselineMonths, movers } = computeMovers(txns, today, meta);
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
    pace: computePace(txns, today, meta),
    movers,
    largest: computeLargest(settled, today, meta),
    // ALL rows (O.8a) — `computeNewMerchants` applies the settled narrowing to
    // its naming pass itself, because only half of what that card prints is a
    // claim about a settled event; the money beside it is an aggregate.
    newMerchants: computeNewMerchants(txns, today, meta),
  };
}
