/**
 * W.6(c) — YMOYL fulfillment curve: life-energy per discretionary CATEGORY
 * over time.
 *
 * Per-purchase hours already live on `/coach` (`hoursOfWork` + LifeEnergyCard).
 * This engine answers the missing half: how much working life each discretionary
 * category took across complete months — so a rising dining line is visible as
 * hours, not only as dollars on the creep card.
 *
 * Pure: no I/O, integer cents for spend, hours only via `hoursOfWork`.
 * Same month window idiom as lifestyle creep (complete months before `today`).
 * Same discretionary + `countsInFlows` gates as `averageDiscretionaryCategorySpend`.
 */

import { addMonthsClamped, isoDate, monthKey, type ISODate } from '@/lib/dates';
import { CATEGORY_BY_ID, type CategoryMeta } from '@/lib/engine/categorize/categories';
import { countsInFlows, hoursOfWork, type TxnLike } from '@/lib/engine/fi/insights';
import { categoryMatchesMoneyDial } from '@/lib/engine/fi/discretionary-cuts';
import { cents } from '@/lib/money';
import { median } from '@/lib/stats';

/** Default window — same length as lifestyle creep. */
export const FULFILLMENT_WINDOW_MONTHS = 6;

/** How many categories the card ranks (by total life-energy spend). */
export const FULFILLMENT_TOP_N = 5;

export interface FulfillmentMonth {
  month: string; // YYYY-MM
  /** Positive outflow cents in this category this month. */
  spendCents: number;
  /** `hoursOfWork(spendCents, wage)` — tenths of an hour. */
  hours: number;
}

export interface FulfillmentCategory {
  categoryId: string;
  categoryName: string;
  isMoneyDial: boolean;
  /** One entry per window month, oldest → newest (zeros included). */
  monthly: FulfillmentMonth[];
  totalSpendCents: number;
  /**
   * Sum of monthly `hours` (same rounding the sparkline shows). Prefer this
   * over a single `hoursOfWork(total)` so the headline and the strip cannot
   * disagree by a tenth.
   */
  totalHours: number;
  /**
   * Second-half median monthly spend vs first-half, in bps of the first half.
   * Same half-split as lifestyle creep (`Math.floor(n/2)`). 0 when unmeasured.
   */
  trendBps: number;
  /** False when the first-half median spend is ≤ 0 — nothing to divide by. */
  trendMeasured: boolean;
}

export interface FulfillmentCurve {
  windowMonths: number;
  /** Complete months in the window, oldest → newest. */
  months: string[];
  hourlyWageCents: number;
  /** Top categories by total spend (capped at `topN`). */
  categories: FulfillmentCategory[];
  /**
   * How many discretionary categories had spend in the window — may exceed
   * `categories.length` when topN truncates. The card must disclose the gap.
   */
  categoryCount: number;
}

export interface FulfillmentByCategoryInput {
  transactions: readonly TxnLike[];
  today: ISODate;
  hourlyWageCents: number;
  windowMonths?: number;
  topN?: number;
  meta?: ReadonlyMap<string, CategoryMeta>;
  moneyDialIds?: readonly string[];
  nameOf?: (id: string) => string;
  excludedFlowIds?: ReadonlySet<string>;
}

/**
 * Median of first half vs median of second half — the creep halfGrowth shape,
 * kept on *spend cents* so the trend is integer-money and wage-invariant.
 */
function halfTrendBps(series: number[]): { bps: number; measured: boolean } {
  const half = Math.floor(series.length / 2);
  if (half <= 0) return { bps: 0, measured: false };
  const first = median(series.slice(0, half));
  const last = median(series.slice(series.length - half));
  if (!Number.isFinite(first) || first <= 0) return { bps: 0, measured: false };
  const lastSafe = Number.isFinite(last) ? last : 0;
  return { bps: Math.round(((lastSafe - first) / first) * 10000), measured: true };
}

/**
 * Life-energy by discretionary category across complete months.
 *
 * Returns `null` when the hourly wage is unset/non-positive — hours are the
 * whole lens, and fabricating them from a zero wage would be a silent lie.
 * An empty `categories` array (wage set, no discretionary spend in the window)
 * is a real empty state the card can name.
 */
export function fulfillmentByCategory(
  input: FulfillmentByCategoryInput,
): FulfillmentCurve | null {
  const wage = Math.trunc(input.hourlyWageCents);
  if (wage <= 0) return null;

  const windowMonths = Math.max(1, Math.trunc(input.windowMonths ?? FULFILLMENT_WINDOW_MONTHS));
  const topN = Math.max(1, Math.trunc(input.topN ?? FULFILLMENT_TOP_N));
  const meta = input.meta ?? CATEGORY_BY_ID;
  const moneyDialIds = input.moneyDialIds ?? [];
  const nameOf = input.nameOf ?? ((id: string) => meta.get(id)?.name ?? id);

  const lastFullMonthStart = addMonthsClamped(isoDate(`${monthKey(input.today)}-01`), 0);
  const months: string[] = [];
  for (let k = windowMonths; k >= 1; k--) {
    months.push(monthKey(addMonthsClamped(lastFullMonthStart, -k)));
  }
  const monthSet = new Set(months);

  // categoryId → month → spend cents (positive)
  const byCat = new Map<string, Map<string, number>>();
  for (const t of input.transactions) {
    if (!countsInFlows(t, input.excludedFlowIds)) continue;
    if (t.amountCents >= 0) continue;
    const m = monthKey(t.date);
    if (!monthSet.has(m)) continue;
    const categoryId = t.categoryId;
    if (!categoryId || categoryId === 'uncategorized') continue;
    if (!meta.get(categoryId)?.discretionary) continue;
    let monthMap = byCat.get(categoryId);
    if (!monthMap) {
      monthMap = new Map(months.map((mo) => [mo, 0]));
      byCat.set(categoryId, monthMap);
    }
    monthMap.set(m, (monthMap.get(m) ?? 0) - t.amountCents);
  }

  const ranked = [...byCat.entries()]
    .map(([categoryId, monthMap]) => {
      const monthly: FulfillmentMonth[] = months.map((month) => {
        const spendCents = monthMap.get(month) ?? 0;
        return {
          month,
          spendCents,
          hours: hoursOfWork(cents(spendCents), wage),
        };
      });
      const totalSpendCents = monthly.reduce((s, row) => s + row.spendCents, 0);
      const totalHours =
        Math.round(monthly.reduce((s, row) => s + row.hours, 0) * 10) / 10;
      const trend = halfTrendBps(monthly.map((row) => row.spendCents));
      return {
        categoryId,
        categoryName: nameOf(categoryId),
        isMoneyDial: categoryMatchesMoneyDial(categoryId, moneyDialIds),
        monthly,
        totalSpendCents,
        totalHours,
        trendBps: trend.bps,
        trendMeasured: trend.measured,
      };
    })
    .filter((c) => c.totalSpendCents > 0)
    .sort(
      (a, b) =>
        b.totalSpendCents - a.totalSpendCents ||
        a.categoryName.localeCompare(b.categoryName),
    );

  return {
    windowMonths,
    months,
    hourlyWageCents: wage,
    categoryCount: ranked.length,
    categories: ranked.slice(0, topN),
  };
}
