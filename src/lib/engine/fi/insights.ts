/**
 * FI Coach insights (Phase 3): monthly savings rate from real transactions,
 * savings opportunities ranked by compounded impact, lifestyle-creep
 * detection, room-for-error runway, life-energy view, and the monthly
 * Money Review narrative. Pure functions; all user-facing strings live in
 * coach-copy.ts so the guardrail test can scan them exhaustively.
 */

import { type Cents, cents } from '@/lib/money';
import { type ISODate, addMonthsClamped, isoDate } from '@/lib/dates';
import { categorize } from '@/lib/engine/categorize/pipeline';
import { CATEGORY_BY_ID, type CategoryMeta, isIncomeCategoryId } from '@/lib/engine/categorize/categories';
import type { RecurringSeriesResult } from '@/lib/engine/recurring/detect';
import { opportunityFVCents, savingsRateBps } from './fi';

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
}

/** The single inclusion rule for flow aggregation (one definition, used everywhere). */
function countsInFlows(t: TxnLike): boolean {
  return !t.isTransfer && t.status === 'POSTED' && !t.isSplitParent;
}

/** Month key 'YYYY-MM'. */
const ym = (date: string) => date.slice(0, 7);

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
    const slot = byMonth.get(ym(t.date)) ?? { income: 0, expenses: 0 };
    if (t.amountCents > 0) {
      if (t.categoryId && (t.categoryId === 'refund' || !isIncomeCategoryId(t.categoryId))) slot.expenses -= t.amountCents; // refund
      else slot.income += t.amountCents;
    } else {
      slot.expenses += -t.amountCents;
    }
    byMonth.set(ym(t.date), slot);
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
  fv10Cents: Cents;
  fv20Cents: Cents;
  fv30Cents: Cents;
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

export function findOpportunities(
  series: readonly RecurringSeriesResult[],
  expectedReturnBps: number,
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
      fv10Cents: opportunityFVCents(m, 120, expectedReturnBps),
      fv20Cents: opportunityFVCents(m, 240, expectedReturnBps),
      fv30Cents: opportunityFVCents(m, 360, expectedReturnBps),
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

  return out.sort((a, b) => b.fv30Cents - a.fv30Cents);
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
  const lastFullMonthStart = addMonthsClamped(isoDate(`${ym(today)}-01`), 0);
  const months: string[] = [];
  for (let k = windowMonths; k >= 1; k--) {
    months.push(ym(addMonthsClamped(lastFullMonthStart, -k)));
  }

  const discSpend = new Map<string, number>(months.map((m) => [m, 0]));
  const income = new Map<string, number>(months.map((m) => [m, 0]));
  for (const t of transactions) {
    if (!countsInFlows(t)) continue;
    const month = ym(t.date);
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
  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
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
