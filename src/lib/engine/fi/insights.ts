/**
 * FI Coach insights (Phase 3): monthly savings rate from real transactions,
 * savings opportunities ranked by compounded impact, lifestyle-creep
 * detection, room-for-error runway, life-energy view, and the monthly
 * Money Review narrative. Pure functions; all user-facing strings live in
 * coach-copy.ts so the guardrail test can scan them exhaustively.
 */

import { type Cents, cents } from '@/lib/money';
import { type ISODate, addMonthsClamped, isoDate, monthKey } from '@/lib/dates';
import { median } from '@/lib/stats';
import { categorize } from '@/lib/engine/categorize/pipeline';
import { isExcludedFromTotals } from '@/lib/engine/transactions/exclude';
import { CATEGORY_BY_ID, type CategoryMeta, isIncomeCategoryId } from '@/lib/engine/categorize/categories';
import type { RecurringSeriesResult } from '@/lib/engine/recurring/detect';
import { opportunityValueTodayCents, savingsRateBps } from './fi';

export interface TxnLike {
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
export function countsInFlows(t: TxnLike): boolean {
  return !t.isTransfer && t.status === 'POSTED' && !t.isSplitParent && !isExcludedFromTotals(t);
}

/**
 * The exact rows `monthlyFlows` counts as INCOME, exported so the Glass-Box
 * trace (GLASSBOX_PLAN) cites the same rows the flows summed — one predicate,
 * two surfaces, no drift. A positive counts as income when it has no category,
 * or an Income-group category other than the 'refund' leaf (a merchandise
 * return nets against spend instead — #166).
 */
export function isIncomeFlowRow(t: TxnLike): boolean {
  if (!countsInFlows(t) || t.amountCents <= 0) return false;
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
export function monthlyFlows(transactions: readonly TxnLike[]): MonthlyFlow[] {
  const byMonth = new Map<string, { income: number; expenses: number }>();
  for (const t of transactions) {
    if (!countsInFlows(t)) continue;
    const slot = byMonth.get(monthKey(t.date)) ?? { income: 0, expenses: 0 };
    if (isIncomeFlowRow(t)) slot.income += t.amountCents;
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
      todayValue10Cents: opportunityValueTodayCents(m, 120, nominalReturnBps, inflationBps),
      todayValue20Cents: opportunityValueTodayCents(m, 240, nominalReturnBps, inflationBps),
      todayValue30Cents: opportunityValueTodayCents(m, 360, nominalReturnBps, inflationBps),
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

export interface CreepResult {
  flagged: boolean;
  /** Growth of MEDIAN discretionary spend, first half → second half of the window (bps). */
  spendGrowthBps: number;
  /** Same measure for income — median is robust to biweekly-payroll months with 3 paydays. */
  incomeGrowthBps: number;
  monthlyDiscretionaryCents: { month: string; amountCents: Cents }[];
  windowMonths: number;
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
): CreepResult {
  const lastFullMonthStart = addMonthsClamped(isoDate(`${monthKey(today)}-01`), 0);
  const months: string[] = [];
  for (let k = windowMonths; k >= 1; k--) {
    months.push(monthKey(addMonthsClamped(lastFullMonthStart, -k)));
  }

  const discSpend = new Map<string, number>(months.map((m) => [m, 0]));
  const income = new Map<string, number>(months.map((m) => [m, 0]));
  for (const t of transactions) {
    if (!countsInFlows(t)) continue;
    const month = monthKey(t.date);
    if (!discSpend.has(month)) continue;
    if (t.amountCents > 0) {
      income.set(month, income.get(month)! + t.amountCents);
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
    }
  }

  // Median of first-half months vs median of second-half months. Median (not
  // mean) so a calendar month with 3 biweekly paydays doesn't read as an
  // "income raise", and one big restaurant night doesn't read as creep.
  const halfGrowthBps = (series: number[]): number => {
    const half = Math.floor(series.length / 2);
    const first = median(series.slice(0, half));
    const last = median(series.slice(series.length - half));
    if (first <= 0) return 0;
    return Math.round(((last - first) / first) * 10000);
  };

  const spendGrowth = halfGrowthBps(months.map((m) => discSpend.get(m)!));
  const incomeGrowth = halfGrowthBps(months.map((m) => income.get(m)!));

  return {
    // flag when spending outgrew income by ≥5 percentage points across the
    // window — a sustained trend, not a single celebratory month
    flagged: spendGrowth - incomeGrowth >= 500,
    spendGrowthBps: spendGrowth,
    incomeGrowthBps: incomeGrowth,
    monthlyDiscretionaryCents: months.map((m) => ({ month: m, amountCents: cents(discSpend.get(m)!) })),
    windowMonths,
  };
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
