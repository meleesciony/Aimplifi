/**
 * FI Coach insights (Phase 3): monthly savings rate from real transactions,
 * savings opportunities ranked by compounded impact, lifestyle-creep
 * detection, room-for-error runway, life-energy view, and the monthly
 * Money Review narrative. Pure functions; all user-facing strings live in
 * coach-copy.ts so the guardrail test can scan them exhaustively.
 */

import { type Cents, cents, formatCents } from '@/lib/money';
import { type ISODate, addMonthsClamped, isoDate, monthKey } from '@/lib/dates';
import { median } from '@/lib/stats';
import { handoverKey } from '@/lib/engine/account/reconcile-boundary';
import { categorize } from '@/lib/engine/categorize/pipeline';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { isExcludedFromTotals } from '@/lib/engine/transactions/exclude';
import { CATEGORY_BY_ID, type CategoryMeta, isIncomeCategoryId } from '@/lib/engine/categorize/categories';
import type { RecurringSeriesResult } from '@/lib/engine/recurring/detect';
// U.16: the handover-day sentence has ONE author (`category-breakdown`), so the
// three transaction panels that can show it cannot state it in different words.
import { breakdownHandoverDayCopy } from '@/lib/engine/glass-box/category-breakdown';
import { OPPORTUNITY_HORIZON_MONTHS, opportunityValueTodayCents, savingsRateBps } from './fi';

/** The three horizons the list prints, named once (`fi.ts` owns the order). */
const [H10, H20, H30] = OPPORTUNITY_HORIZON_MONTHS;

export interface TxnLike {
  /** Present on every real row; optional so hand-built fixtures stay terse,
   *  nullable because the breakdown row shapes carry it that way. */
  id?: string | null;
  date: string;
  amountCents: number;
  rawDescriptor: string;
  accountId: string;
  isTransfer: boolean;
  status: string;
  /** Stored category (reflects user corrections). Preferred over re-categorizing. */
  categoryId?: string | null;
  /** Container rows from splits are excluded; their CHILDREN carry the amounts. */
  isSplitParent?: boolean;
  splitParentId?: string | null;
  /** O.15: reader-excluded rows leave every flow via this one basis. */
  excludeFromTotals?: boolean | null;
  /** #397: the reader's per-row Fixed/Discretionary verdict ('fixed' |
   *  'guilt-free'); null/absent = the app's guess. */
  spendClassOverride?: string | null;
  /**
   * The register's own display name for this row (coach.ts carries it on the
   * same array `monthlyFlows` sums — see its `merchantName` comment). Absent =
   * the engine falls back to the normalized bank text, which is the register's
   * own rule, so the two surfaces cannot disagree about a payee's name.
   */
  merchantName?: string | null;
}

/**
 * The single inclusion rule for flow aggregation (one definition, used everywhere).
 *
 * EXPORTED for the same reason `isIncomeFlowRow` below is: the Glass-Box panel
 * behind the /reports income-vs-spending bars must select the rows this function
 * admitted, not a re-statement of its clauses. `month-flow-breakdown.ts` calls
 * it directly, so any change to what counts in a flow moves the bar and the rows
 * under it in the same commit — the drift `a-link-on-a-figure-asserts-two-engines-agree`
 * was written about.
 */
/**
 * `excludedFlowIds` is the C.25 read-side exclusion (DECISIONS #403): row ids
 * of loan payments that are carried elsewhere (a dateable obligation on the
 * linked loan account) and so leave every flow sum in every month — computed
 * once by the snapshot assembler, handed in by surfaces that sum flows.
 * Omitted = the exact pre-C.25 behaviour, so an unwired caller and the demo
 * golden are unchanged by construction.
 */
export function countsInFlows(t: TxnLike, excludedFlowIds?: ReadonlySet<string>): boolean {
  if (typeof t.id === 'string' && excludedFlowIds?.has(t.id)) return false;
  return !t.isTransfer && t.status === 'POSTED' && !t.isSplitParent && !isExcludedFromTotals(t);
}

/**
 * The exact rows `monthlyFlows` counts as INCOME, exported so the Glass-Box
 * trace (GLASSBOX_PLAN) cites the same rows the flows summed — one predicate,
 * two surfaces, no drift. A positive counts as income when it has no category,
 * or an Income-group category other than the 'refund' leaf (a merchandise
 * return nets against spend instead — #166).
 */
export function isIncomeFlowRow(t: TxnLike, excludedFlowIds?: ReadonlySet<string>): boolean {
  if (!countsInFlows(t, excludedFlowIds) || t.amountCents <= 0) return false;
  return !t.categoryId || (t.categoryId !== 'refund' && isIncomeCategoryId(t.categoryId));
}

export interface MonthlyFlow {
  month: string; // YYYY-MM
  incomeCents: Cents;
  expensesCents: Cents;
  savingsRateBps: number | null;
}

/**
 * Monthly income/expenses/savings-rate, transfers and split parents excluded,
 * POSTED only. Savings rate = (after-tax income − expenses) / income.
 *
 * Refunds are NETTED against spend (ROADMAP #4): a positive transaction in a
 * NON-income category (e.g. a return to 'shopping') reduces that month's
 * expenses rather than counting as income — so a $450 purchase with a $100
 * return shows $350 of spend, not $450 of spend + $100 of "income". A positive
 * in an Income-GROUP category ('income' or a #163 leaf like 'paycheck' — the
 * id the categorizer assigns real PAYROLL/DIRECT-DEP descriptors) counts as
 * income — EXCEPT the 'refund' leaf: a manually-filed "Refund" is a
 * merchandise return, and counting it as income would inflate income AND
 * expenses versus the same return filed to its purchase category (#166 critic
 * F1); tax refunds and reimbursements DO count as income (they aren't offsets
 * of a tracked purchase). A positive with no/unknown category stays income
 * (we don't net an ambiguous inflow against spend). A month's expenses never
 * go below 0.
 */
export function monthlyFlows(
  transactions: readonly TxnLike[],
  excludedFlowIds?: ReadonlySet<string>,
): MonthlyFlow[] {
  const byMonth = new Map<string, { income: number; expenses: number }>();
  for (const t of transactions) {
    if (!countsInFlows(t, excludedFlowIds)) continue;
    const slot = byMonth.get(monthKey(t.date)) ?? { income: 0, expenses: 0 };
    if (isIncomeFlowRow(t, excludedFlowIds)) slot.income += t.amountCents;
    else if (t.amountCents > 0) slot.expenses -= t.amountCents; // refund nets spend down
    else slot.expenses += -t.amountCents;
    byMonth.set(monthKey(t.date), slot);
  }
  return [...byMonth.entries()]
    .map(([month, { income, expenses }]) => {
      const exp = Math.max(0, expenses); // refunds can't drive a month's spend below 0
      return {
        month,
        incomeCents: cents(income),
        expensesCents: cents(exp),
        savingsRateBps: savingsRateBps(cents(income), cents(exp)),
      };
    })
    .sort((a, b) => (a.month < b.month ? -1 : 1));
}

// ── Savings opportunities (big wins, never latte-shame) ─────────────────────

export type OpportunityKind = 'unused-subscription' | 'price-increase' | 'insurance-reshop' | 'negotiable-bill';

export interface Opportunity {
  kind: OpportunityKind;
  merchant: string;
  monthlyCents: Cents;
  /**
   * What this monthly amount is worth if invested instead, **in today's money** — 10, 20 and
   * 30 years out.
   *
   * W.10: these were `fv10/20/30Cents`, compounded at the reader's NOMINAL dial, and they
   * printed one scroll under an FI card that W.2 had just moved onto the real (after-inflation)
   * rate. Two dollar figures on one page, one in future dollars and one in today's, with
   * nothing on screen saying which was which — `a-rate-and-its-target-must-share-a-unit`.
   *
   * Renamed rather than re-pointed: re-denominating a money field without changing a character
   * is exactly how the last slice's disclosure went stale, so the rename makes tsc walk every
   * reader of these three numbers.
   *
   * The stream is level in NOMINAL dollars — the reader invests the same amount every month and
   * never raises it — and the whole total is then stated in today's money. See
   * `opportunityValueTodayCents` for why the more flattering level-in-today's-dollars model was
   * rejected: one of the four kinds below is a hard-coded flat estimate, so there is no price
   * to argue would have risen, and no per-row exception survives a reader comparing two rows.
   */
  todayValue10Cents: Cents;
  todayValue20Cents: Cents;
  todayValue30Cents: Cents;
  /** Big-win framing, with the assumption stated. From coach-copy templates. */
  isEstimate: boolean;
  /**
   * For kind 'price-increase' only (absent for every other kind): the series'
   * detected change date plus the absolute before/after prices, copied verbatim.
   * The value-receipt idempotency key (TASKS 1.3) is anchored on the PRICE
   * TRANSITION (from→to), not the date — detectRecurring's change date is a
   * detection artifact that can shift under transaction re-import churn, and a
   * shifted date must not re-mint the same increase (critic #206 P2-2). The date
   * is kept as the receipt's business `occurredOn`.
   */
  priceChangedAt?: string;
  priceFromCents?: Cents;
  priceToCents?: Cents;
}

/**
 * @param nominalReturnBps the reader's own return dial — the rate the money GROWS at.
 * @param inflationBps the reader's inflation dial — what the grown total is then deflated by.
 *
 * Both, not one blended rate: the reader is shown both operands beside the figures, and a
 * single pre-blended argument would let a caller hand over a real rate and get an answer
 * deflated twice, with nothing in the types to notice.
 */
export function findOpportunities(
  series: readonly RecurringSeriesResult[],
  nominalReturnBps: number,
  inflationBps: number,
): Opportunity[] {
  const out: Opportunity[] = [];
  const push = (
    kind: OpportunityKind,
    merchant: string,
    monthly: number,
    isEstimate: boolean,
    price?: { changedAt: string; fromCents: Cents; toCents: Cents },
  ) => {
    const m = cents(Math.abs(monthly));
    if (m === 0) return;
    out.push({
      kind,
      merchant,
      monthlyCents: m,
      todayValue10Cents: opportunityValueTodayCents(m, H10, nominalReturnBps, inflationBps),
      todayValue20Cents: opportunityValueTodayCents(m, H20, nominalReturnBps, inflationBps),
      todayValue30Cents: opportunityValueTodayCents(m, H30, nominalReturnBps, inflationBps),
      isEstimate,
      ...(price !== undefined
        ? {
            priceChangedAt: price.changedAt,
            priceFromCents: price.fromCents,
            priceToCents: price.toCents,
          }
        : {}),
    });
  };

  for (const s of series) {
    if (s.possiblyUnused) push('unused-subscription', s.merchantCanonical, s.lastAmountCents, false);
    // A pay raise (rising recurring INCOME) is not a savings opportunity — only an
    // expense whose price rose is (REC-2).
    if (!s.isIncome && s.priceChangedAt && s.previousAmountCents !== null) {
      const delta = Math.abs(s.lastAmountCents) - Math.abs(s.previousAmountCents);
      if (delta > 0) {
        push('price-increase', s.merchantCanonical, delta, false, {
          changedAt: s.priceChangedAt,
          fromCents: cents(Math.abs(s.previousAmountCents)),
          toCents: cents(Math.abs(s.lastAmountCents)),
        });
      }
    }
    // #163: auto premiums now file to their own leaf — both the generic and the
    // auto leaf are genuinely re-shoppable. Health/dental/vision (employer
    // plans) and life (medical underwriting) stay excluded: a "shop around"
    // nudge there is false hope.
    if ((s.categoryId === 'insurance' || s.categoryId === 'auto-insurance') && s.isSubscription) {
      // re-shopping typically saves ~15% — labeled an estimate
      push('insurance-reshop', s.merchantCanonical, Math.round(Math.abs(s.lastAmountCents) * 0.15), true);
    }
    if ((s.categoryId === 'utilities' || s.categoryId === 'internet') && s.isSubscription) {
      // negotiable bills: ~$20/mo is a common retention-offer outcome — estimate.
      // Keyed on the `utilities` catch-all plus the `internet` leaf cable ISPs
      // file to since #163 — the same internet/cable bills the catch-all used to
      // hold. The #154 split's electricity/natural-gas/water/trash leaves are
      // deliberately excluded: regulated utility monopolies aren't negotiable, so a
      // "call to negotiate" nudge there would be false hope (DECISIONS #154).
      push('negotiable-bill', s.merchantCanonical, 2000, true);
    }
  }

  // Ranking is unchanged by W.10: the annuity is linear in `monthlyCents` and every row shares
  // one rate pair and one horizon, so the order over `todayValue30Cents` is the order over the
  // monthly amounts — the order the nominal figures had. (A critic brute-forced it: 12 amounts
  // x 12 rate pairs including the degenerate ones, 0 order violations.)
  return out.sort((a, b) => b.todayValue30Cents - a.todayValue30Cents);
}

// ── Lifestyle-creep detection (Psychology of Money: growth vs income) ───────

/**
 * One discretionary purchase inside a month's creep bar, as the panel prints it.
 *
 * Structurally the SAME shape as the Glass-Box `BreakdownRow` (same field
 * names, same semantics), so a panel that takes `BreakdownRow[]` accepts these
 * directly; kept here rather than imported so the fi engine does not couple to
 * the glass-box layer. `amountCents` is oriented as SPEND (positive) like every
 * panel row, so the rows sum to the month figure.
 */
export interface CreepRow {
  /** Stable within the month's breakdown; a React key that needs no database id. */
  key: string;
  /** Present iff the source row had one — the row's link to `/transactions/<id>`. */
  transactionId: string | null;
  date: string;
  /** The register's own display name when the caller had one; else the normalized bank text. */
  label: string;
  /** The bank's own descriptor, present ONLY when it differs from `label`. */
  rawDescriptor: string | null;
  amountCents: Cents;
  /** Always false here — `countsInFlows` only admits POSTED rows; carried for shape parity. */
  isPending: boolean;
  /**
   * U.16: this row is dated on a day one of the reader's combined accounts
   * changed connections, which the boundary releases to BOTH sides — so a
   * charge both connections reported is listed twice in this month's panel and
   * counted twice in its bar. A fact about the DATE, not a claim that this row
   * is the duplicate; see the field's note on `BreakdownRow`.
   */
  onHandoverDay: boolean;
}

export interface CreepMonth {
  month: string; // YYYY-MM
  amountCents: Cents;
  /**
   * The discretionary purchases the figure was summed from, carried out of the
   * SAME loop (the O.18c/O.20d carry-out rule): Σ rows === amountCents by
   * construction, and a panel's "matched to the penny" sentence is a real check.
   */
  rows: CreepRow[];
  /**
   * How many of `rows` fall on a released handover day (U.16). Zero for every
   * reader with no combined accounts.
   */
  countedOnHandoverDays: number;
  /** A positive row filed to a discretionary category occurred this month — it
   *  went to income, so the bar is GROSS spend and the panel must say so. */
  hasDiscretionaryRefunds: boolean;
}

export interface CreepResult {
  /**
   * The comparative claim: discretionary spending outgrew income. REQUIRES both
   * series to be measurable (O.20g) — you cannot outpace what the app cannot
   * measure, and `false` alone no longer means "tracking income": read it with
   * `incomeMeasured`/`spendMeasured`, or take the composed verdict from
   * `COACH_COPY.creepCard`, which is the only place the three states are named.
   */
  flagged: boolean;
  /** Growth of MEDIAN discretionary spend, first half → second half of the window (bps). */
  spendGrowthBps: number;
  /** Same measure for income — median is robust to biweekly-payroll months with 3 paydays. */
  incomeGrowthBps: number;
  /**
   * True iff `incomeGrowthBps` is a MEASUREMENT.
   *
   * `halfGrowth` returns 0 both for a genuinely flat income and as a REFUSAL
   * when there is nothing to divide by, and nothing downstream could tell the
   * two apart ("a zero is a claim — name WHICH zero"). This names it.
   *
   * THE RULE: the income baseline must be positive AND at least as large as the
   * discretionary-spending baseline it is being compared against, both taken
   * over the same first half. It is deliberately self-referential — there is no
   * dollar threshold in it — and the argument is that this card compares exactly
   * these two series: if the income the app can see over the baseline months is
   * smaller than the discretionary spending it is being compared with, then the
   * app is not seeing the income that paid for that spending, so one side of the
   * comparison is incomplete and no growth ratio over it means anything.
   *
   * Why a ratio needs this at all: growth is `(last - first) / first`, so a
   * baseline near zero yields an unbounded number that is not a measurement of
   * anything. Measured on the live corpus: one real reader's first-half income
   * median was **$0.08** (one interest credit; the month before it had no income
   * row at all, while carrying 59 other rows), which produced an income growth
   * of **70,470,525%**. That figure never printed — it only renders when flagged
   * — but because `flagged` is a DIFFERENCE it silenced the flag, so the reader
   * was told "no lifestyle drift detected" while their discretionary spending
   * grew ~153%.
   *
   * Rejected: a count of months carrying an income row. Two independent critics
   * broke it from opposite sides — it is too weak (8 cents of monthly interest
   * on a savings account satisfies coverage while the reader's actual payroll
   * account is unlinked, and the card then asserts "income was flat") and too
   * strong (a median of three is unmoved by ONE missing month, so vetoing on a
   * single gap silences a correct figure for anyone paid ten months a year).
   * The median's own robustness is left intact here: a single odd month cannot
   * move the baseline, and the rule only fires when the baseline itself is not
   * a credible income.
   */
  incomeMeasured: boolean;
  /**
   * True iff `spendGrowthBps` is a measurement — the first-half discretionary
   * median is a positive number to grow from. This is the pre-existing
   * `first <= 0` refusal inside `halfGrowth`, surfaced rather than left to be
   * read as a real 0% growth.
   */
  spendMeasured: boolean;
  /**
   * The two first-half medians the growth ratios divide by, rounded to the cent
   * — carried so the copy can print the figures the refusal rests on instead of
   * asserting a conclusion the reader cannot check. (A median over an even-sized
   * half is a mean of two, so it can land on a half cent; it is rounded here
   * because these are rendered as money.)
   */
  incomeBaselineCents: Cents;
  discretionaryBaselineCents: Cents;
  monthlyDiscretionaryCents: CreepMonth[];
  windowMonths: number;
  /**
   * True iff the caller's C.25 exclusion set (DECISIONS #403) was non-empty, so
   * the panel basis can say loan payments were carried elsewhere — the engine
   * knows what it excluded, the caller's snapshot does not need to.
   */
  loanPaymentsExcluded: boolean;
}

/**
 * Compares discretionary-spend growth against income growth over the final
 * `windowMonths` full months. Discretionary = categories marked discretionary
 * in the system category set, resolved via the live categorization pipeline.
 */
export function detectLifestyleCreep(
  transactions: readonly TxnLike[],
  today: ISODate,
  windowMonths = 6,
  // Custom-category aware (DECISIONS #111): a custom discretionary category should
  // count toward lifestyle creep. Defaults to the static map (no-custom = identical).
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
  excludedFlowIds?: ReadonlySet<string>, // C.25 (#403): loan payments leave the creep baseline too
  // U.16: the days the boundary released to BOTH sides of a combined pair
  // (`getReconciliationHandoverDates`). Empty = the truth for a reader with no
  // combined accounts, so an existing caller changes nothing by not passing it.
  handoverKeys: ReadonlySet<string> = new Set<string>(),
): CreepResult {
  const lastFullMonthStart = addMonthsClamped(isoDate(`${monthKey(today)}-01`), 0);
  const months: string[] = [];
  for (let k = windowMonths; k >= 1; k--) {
    months.push(monthKey(addMonthsClamped(lastFullMonthStart, -k)));
  }

  const discSpend = new Map<string, number>(months.map((m) => [m, 0]));
  const discRows = new Map<string, CreepRow[]>(months.map((m) => [m, []]));
  const income = new Map<string, number>(months.map((m) => [m, 0]));
  // A positive row filed to a discretionary category (a return, or cashback
  // filed to "shopping") never nets the bar. The bar is GROSS discretionary
  // spend; the panel must disclose the divergence when one occurred, so we
  // record it per month (O.20d critic P2-2).
  const discRefunds = new Map<string, boolean>(months.map((m) => [m, false]));
  for (const t of transactions) {
    if (!countsInFlows(t, excludedFlowIds)) continue;
    const month = monthKey(t.date);
    if (!discSpend.has(month)) continue;
    // Re-review F8: a $0.00 authorization/adjustment fell through to the spend
    // branch, pushing a `$0.00` row that inflated the panel's "Show N
    // purchases" count without moving the figure by a cent. It is neither
    // spend nor income; skip it before either branch (routing it to the income
    // branch instead would let a $0.00 row raise the refund disclosure).
    if (t.amountCents === 0) continue;
    if (t.amountCents > 0) {
      // O.20g — ONE definition of an income row, the one `monthlyFlows` (and so
      // the savings-rate card sitting on this same page) already uses. This
      // branch previously admitted EVERY positive row, so a merchandise return
      // counted as income here while #166 explicitly refuses it four functions
      // up: "counting it as income would inflate income AND expenses". The
      // reported failure was a $2,000 furniture return filed to `refund` in the
      // median month of the second half, which lifted income growth to ~33%,
      // cleared the flag, and printed "income grew ~33.3%" — a raise that never
      // happened — beside a savings-rate card reporting income unchanged.
      //
      // A refused positive is DROPPED, never netted into `discSpend`: the bar is
      // deliberately GROSS discretionary spend (that is the whole subject of the
      // disclosure `hasDiscretionaryRefunds` raises below), and netting it here
      // would move a live figure on three surfaces and falsify that sentence.
      // It leaves the income series; it does not enter the spending one.
      if (isIncomeFlowRow(t, excludedFlowIds)) {
        income.set(month, income.get(month)! + t.amountCents);
      }
      // The same stored-category resolution the spend branch uses — the flag
      // must not drift from what the spend side counts by.
      const categoryId =
        t.categoryId ??
        categorize({
          rawDescriptor: t.rawDescriptor,
          amountCents: t.amountCents,
          date: t.date,
          accountId: t.accountId,
        }).categoryId;
      // Re-review F1: keying this on `discretionary` alone gave the disclosure a
      // systematic blind spot at the CANONICAL case — the reader who returns a
      // jacket and picks the app's own "Refund" category, which ships as
      // `{group: 'Income', discretionary: false}`. The bar stayed gross, and the
      // sentence that exists to explain exactly that stayed silent. The 'refund'
      // leaf is a merchandise return by definition (#166), so it flags too.
      //
      // Deliberately NOT extended to every non-income positive: a return filed to
      // a NON-discretionary category (groceries) neither enters this bar nor is
      // withheld from it, so disclosing it would explain a divergence that does
      // not exist on this figure — and an uncategorized inflow may be a deposit,
      // not a return, which the sentence must not assert (F7).
      if (meta.get(categoryId)?.discretionary || categoryId === 'refund') {
        discRefunds.set(month, true);
      }
      continue;
    }
    // The STORED category is the truth — it reflects the user's triage
    // corrections (cycle-1 H2: re-categorizing here ignored them, so budgets
    // and the creep detector could permanently disagree). The pipeline is
    // only a fallback for uncategorized rows.
    const categoryId =
      t.categoryId ??
      categorize({
        rawDescriptor: t.rawDescriptor,
        amountCents: t.amountCents,
        date: t.date,
        accountId: t.accountId,
      }).categoryId;
    if (meta.get(categoryId)?.discretionary) {
      discSpend.set(month, discSpend.get(month)! - t.amountCents);
      // Carry the row out of the SAME loop that summed the figure (O.20d): the
      // panel rows are these rows, so they cannot disagree with the bar.
      const rows = discRows.get(month)!;
      const label = t.merchantName ?? normalizeMerchant(t.rawDescriptor).canonical;
      const id = typeof t.id === 'string' ? t.id : null;
      rows.push({
        key: id ?? `${t.date}:${t.rawDescriptor}:${rows.length}`,
        transactionId: id,
        date: t.date,
        label,
        rawDescriptor: label === t.rawDescriptor ? null : t.rawDescriptor,
        amountCents: cents(-t.amountCents),
        isPending: false, // countsInFlows admitted only POSTED rows
        onHandoverDay: handoverKeys.has(handoverKey(t.accountId, t.date)), // U.16
      });
    }
  }

  // Median of first-half months vs median of second-half months. Median (not
  // mean) so a calendar month with 3 biweekly paydays doesn't read as an
  // "income raise", and one big restaurant night doesn't read as creep.
  // Returns the growth AND the baseline it was divided by, because the caller
  // cannot otherwise tell a measured 0% (flat) from the 0% this returns when
  // there was nothing to divide by (O.20g).
  const halfGrowth = (series: number[]): { bps: number; baseline: number } => {
    const half = Math.floor(series.length / 2);
    const first = median(series.slice(0, half));
    const last = median(series.slice(series.length - half));
    if (first <= 0) return { bps: 0, baseline: first };
    return { bps: Math.round(((last - first) / first) * 10000), baseline: first };
  };

  const spend = halfGrowth(months.map((m) => discSpend.get(m)!));
  const inc = halfGrowth(months.map((m) => income.get(m)!));
  // Rounded to the cent because both are RENDERED by the refusal copy: a median
  // over an even-sized half is the mean of two, so it can land on a half cent,
  // and a money value this app prints is an integer number of cents (rule 3).
  //
  // A non-finite median becomes 0 — "no baseline", which is what it means. At
  // the degenerate `windowMonths <= 1` the compared half is an EMPTY slice and
  // `median([])` is NaN; passing that to `cents()` THROWS ("requires a safe
  // integer"), so the exported API would crash rather than refuse. Both readings
  // of NaN reach the same verdict here — nothing to divide by — so it is
  // collapsed at the boundary instead of carried into a typed money field.
  const toBaselineCents = (n: number): Cents => cents(Number.isFinite(n) ? Math.round(n) : 0);
  const incomeBaselineCents = toBaselineCents(inc.baseline);
  const discretionaryBaselineCents = toBaselineCents(spend.baseline);
  const spendMeasured = discretionaryBaselineCents > 0;
  // See `incomeMeasured`'s docblock for the argument.
  const incomeMeasured =
    incomeBaselineCents > 0 && incomeBaselineCents >= discretionaryBaselineCents;

  return {
    // Flag when spending outgrew income by ≥5 percentage points across the
    // window — a sustained trend, not a single celebratory month. BOTH sides
    // must be measurable first (O.20g): "spending is outpacing income" is a
    // comparative claim, and an income the app cannot see is not an income the
    // reader is outpacing. Without this the refusal 0 acts as a real income
    // growth of 0% and the flag fires on the spend side alone.
    flagged: incomeMeasured && spendMeasured && spend.bps - inc.bps >= 500,
    spendGrowthBps: spend.bps,
    incomeGrowthBps: inc.bps,
    incomeMeasured,
    spendMeasured,
    incomeBaselineCents,
    discretionaryBaselineCents,
    monthlyDiscretionaryCents: months.map((m) => ({
      month: m,
      amountCents: cents(discSpend.get(m)!),
      rows: discRows.get(m)!,
      hasDiscretionaryRefunds: discRefunds.get(m)!,
      // U.16: counted off the rows this month's panel LISTS, so its sentence
      // can never describe money the panel does not show.
      countedOnHandoverDays: discRows.get(m)!.reduce((n, r) => (r.onHandoverDay ? n + 1 : n), 0),
    })),
    windowMonths,
    loanPaymentsExcluded: excludedFlowIds !== undefined && excludedFlowIds.size > 0,
  };
}

/**
 * The basis sentences behind one month's creep bar (O.20d), engine-composed with
 * the RENDERED figure embedded — a rule in a .tsx cannot be locked by a test,
 * and the two surfaces must never state in their own words what counts here.
 *
 * `monthLabel` is the already-rendered month ("May 2026"), like every embedded
 * string.
 *
 * Re-review F6 — the loan-payment exclusion sentence was REMOVED from this
 * panel, for two independent reasons either of which is sufficient:
 *
 *  1. It was unscoped. `CreepResult.loanPaymentsExcluded` is one window-wide
 *     boolean meaning "the caller handed me a non-empty set", not "I excluded
 *     something from THIS month" — so a single July payment printed the
 *     exclusion sentence on the February bar, where nothing was excluded.
 *  2. It was vacuous here regardless. `loan-payment` ships as
 *     `discretionary: false`, so an excluded loan payment could never have
 *     entered a discretionary figure in the first place; the sentence explained
 *     an exclusion that cannot move this number.
 *
 * The C.25 disclosure remains on the surfaces whose figures it actually changes.
 */
export function creepPanelBasis(
  monthLabel: string,
  amountCents: Cents,
  hasDiscretionaryRefunds: boolean,
  // U.16: how many LISTED rows fall on a released handover day, and whether the
  // panel's penny-match currently holds. Both required rather than defaulted:
  // this bar lists transactions under a "matched to the penny" line exactly like
  // the category panel, so it carries the same exposure, and a default of 0
  // would let a caller ship the silence U.16 exists to remove.
  countedOnHandoverDays: number,
  statesATally: boolean,
): readonly [string, ...string[]] {
  const out: [string, string, ...string[]] = [
    `The ${formatCents(amountCents)} is ${monthLabel}’s discretionary spending: posted purchases in a discretionary category — dining out, shopping, entertainment, and the other categories the app treats as discretionary.`,
    `Each row counts by the category you filed it under (the app guesses only for uncategorized rows); transfers, pending rows, and rows you’ve excluded are never in it.`,
  ];
  // Re-review F2: "discretionary" means two different things in this product.
  // Here it is the CATEGORY's taxonomy flag; in the register and in /budgets it
  // is the Fixed/Discretionary spend class, which honours a recurring-bill guess
  // and the reader's own override (#397: "the reader's verdict on THIS row
  // wins"). So a gym membership the register labels "Fixed · you set this" is
  // still counted here, and listing the rows — which this slice added — turns
  // that divergence into two visible, contradictory labels for one charge.
  // Unifying the two definitions moves a live figure on three surfaces and is
  // queued as its own critic-gated slice; until then the panel says so rather
  // than letting the reader discover it.
  out.push(
    `This counts by category, not by the Fixed or Discretionary setting on a row — a charge you’ve marked Fixed is still counted here.`,
  );
  if (hasDiscretionaryRefunds) {
    // The bar is GROSS spend: a credit posted to a discretionary category (or
    // filed to Refund) never nets this figure — stated exactly when one
    // occurred, never claimed when none did (critic P2-2).
    //
    // "A credit posted", not "a refund you filed" (F7): the same branch catches
    // a bike sold and filed to 'shopping', which is not a refund, and a category
    // the app guessed rather than one the reader chose.
    //
    // O.20g — the sentence used to explain the gross-ness by naming where the
    // credit DID go ("counts as money in"), and that clause is now false for the
    // canonical case: a return filed to a discretionary category or to Refund is
    // refused by `isIncomeFlowRow` and no longer reaches the income series. It
    // is not replaced by the opposite claim ("it isn't counted as income
    // either"), which would be false in the other direction for the row this
    // branch also catches — an UNCATEGORIZED credit that the pipeline files to a
    // discretionary category is admitted as income, because an inflow the reader
    // never labelled may be a deposit (the F7 argument). So the sentence now
    // asserts only what holds for every row that reaches it: this figure is not
    // reduced. Where the credit is counted is a claim for a surface that knows
    // which of the two rows it has.
    out.push(
      `A credit posted to a discretionary category this month — a return, cashback, or anything filed to Refund — does not reduce this figure.`,
    );
  }
  // U.16, and the SAME sentence the category and month-flow panels print: one
  // fact, one author. This bar lists transactions under a penny-match line, so a
  // released handover day is counted here too, and silence beside a matching
  // total reads as confirmation that both lines belong.
  if (countedOnHandoverDays > 0) {
    out.push(breakdownHandoverDayCopy(countedOnHandoverDays, statesATally));
  }
  return out;
}

// ── Room for error (months of runway) ────────────────────────────────────────

export function monthsOfRunway(
  liquidCents: Cents,
  avgMonthlyExpensesCents: Cents,
): number {
  if (avgMonthlyExpensesCents <= 0) return Infinity;
  return Math.round((liquidCents / avgMonthlyExpensesCents) * 10) / 10;
}

// ── Life energy (Your Money or Your Life) ────────────────────────────────────

/** Hours of work a purchase costs at the user's real (after-tax) hourly wage. */
export function hoursOfWork(amountCents: Cents, hourlyWageCents: number): number {
  if (hourlyWageCents <= 0) return 0;
  return Math.round((Math.abs(amountCents) / hourlyWageCents) * 10) / 10;
}
