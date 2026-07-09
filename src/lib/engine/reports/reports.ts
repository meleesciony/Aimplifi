/**
 * Reports engine (DECISIONS #67) — pure spending analytics over categorized
 * transactions. Spending = expenses only (transfers, split parents, and income
 * excluded); refunds net against their category. Rolls leaf subcategories up to
 * their parent group. Integer cents in/out, no I/O.
 *
 * Category month-over-month series (DECISIONS #171) reuses the SAME spend
 * definition via spendingByCategory — never a parallel classifier.
 */
import { CATEGORY_BY_ID, type CategoryMeta } from '@/lib/engine/categorize/categories';
import { addMonthsClamped, isoDate } from '@/lib/dates';

export interface ReportTxn {
  date: string; // YYYY-MM-DD
  amountCents: number; // signed; negative = spend
  categoryId?: string | null;
  isTransfer?: boolean;
  isSplitParent?: boolean;
}

export interface CategorySpend {
  categoryId: string;
  name: string;
  group: string;
  amountCents: number;
}
export interface GroupSpend {
  group: string;
  amountCents: number;
  categories: CategorySpend[];
}
export interface SpendingBreakdown {
  totalCents: number;
  byCategory: CategorySpend[]; // sorted desc
  byGroup: GroupSpend[]; // sorted desc
}

/** One month in a per-category spend series (amountCents may be 0). */
export interface CategoryMonthSpend {
  ym: string;
  amountCents: number;
}

/**
 * Per-category month-over-month series ending at `endYm` (inclusive), oldest →
 * newest. `currentCents` / `priorCents` / `deltaCents` / `pctChange` describe
 * the last two months in the window (Mint-style MoM, not the #74 movers
 * baseline-average). `pctChange` is null when prior is 0 (undefined %).
 */
export interface CategorySpendSeries {
  categoryId: string;
  name: string;
  group: string;
  months: CategoryMonthSpend[];
  currentCents: number;
  priorCents: number;
  deltaCents: number;
  pctChange: number | null;
}

/** Spending grouped by category for months in [fromYm, toYm] (inclusive). */
export function spendingByCategory(
  txns: readonly ReportTxn[],
  range: { fromYm: string; toYm: string },
  // Custom-category aware (DECISIONS #111): defaults to the static system map, so
  // a user with no custom categories gets byte-identical output.
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
): SpendingBreakdown {
  const totals = new Map<string, number>();
  for (const t of txns) {
    if (t.isSplitParent || t.isTransfer) continue;
    const ym = t.date.slice(0, 7);
    if (ym < range.fromYm || ym > range.toYm) continue;
    const id = t.categoryId ?? 'uncategorized';
    if (id === 'transfer') continue;
    const cat = meta.get(id);
    if (cat?.group === 'Income') continue; // income isn't spending
    if (t.amountCents < 0) {
      totals.set(id, (totals.get(id) ?? 0) + -t.amountCents);
    } else {
      totals.set(id, (totals.get(id) ?? 0) - t.amountCents); // refund nets down
    }
  }

  const byCategory: CategorySpend[] = [];
  for (const [id, amountCents] of totals) {
    if (amountCents <= 0) continue; // net refund / zero → drop
    const cat = meta.get(id);
    byCategory.push({ categoryId: id, name: cat?.name ?? 'Uncategorized', group: cat?.group ?? 'Other', amountCents });
  }
  byCategory.sort((a, b) => b.amountCents - a.amountCents);

  const groupMap = new Map<string, CategorySpend[]>();
  for (const c of byCategory) {
    const arr = groupMap.get(c.group) ?? [];
    arr.push(c);
    groupMap.set(c.group, arr);
  }
  const byGroup: GroupSpend[] = [...groupMap.entries()]
    .map(([group, categories]) => ({
      group,
      amountCents: categories.reduce((s, c) => s + c.amountCents, 0),
      categories,
    }))
    .sort((a, b) => b.amountCents - a.amountCents);

  const totalCents = byCategory.reduce((s, c) => s + c.amountCents, 0);
  return { totalCents, byCategory, byGroup };
}

/**
 * Whether a category id is a valid MoM drill-down target. Income leaves and
 * `transfer` are never spending in this engine — opening a spend panel for them
 * would invent a fake drill-down (Hostile Critic #171 P1). `uncategorized` is
 * allowed (it appears in the breakdown). Unknown ids (not in meta) are rejected
 * unless the caller also sees them in this month's breakdown.
 */
export function isSpendDrilldownCategory(
  categoryId: string,
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
): boolean {
  if (categoryId === 'transfer') return false;
  if (categoryId === 'uncategorized') return true;
  const cat = meta.get(categoryId);
  if (!cat) return false;
  if (cat.group === 'Income') return false;
  return true;
}

/**
 * Month-over-month spend series for one leaf category. Reuses spendingByCategory
 * per month so refunds / income / transfers / splits stay byte-identical to the
 * reports breakdown. Months with no net spend return amountCents: 0 (kept for
 * chart continuity — unlike byCategory which drops net-zero rows).
 */
export function categorySpendSeries(
  txns: readonly ReportTxn[],
  categoryId: string,
  endYm: string,
  monthCount: number,
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
): CategorySpendSeries {
  if (monthCount < 1) throw new Error(`categorySpendSeries: monthCount must be ≥1, got ${monthCount}`);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(endYm)) {
    throw new Error(`categorySpendSeries: malformed endYm "${endYm}"`);
  }

  const months: CategoryMonthSpend[] = [];
  for (let i = monthCount - 1; i >= 0; i--) {
    const ym = addMonthsClamped(isoDate(`${endYm}-01`), -i).slice(0, 7);
    const { byCategory } = spendingByCategory(txns, { fromYm: ym, toYm: ym }, meta);
    const amountCents = byCategory.find((c) => c.categoryId === categoryId)?.amountCents ?? 0;
    months.push({ ym, amountCents });
  }

  const currentCents = months[months.length - 1]?.amountCents ?? 0;
  const priorCents = months.length >= 2 ? (months[months.length - 2]?.amountCents ?? 0) : 0;
  const deltaCents = currentCents - priorCents;
  const cat = meta.get(categoryId);

  return {
    categoryId,
    name: cat?.name ?? 'Uncategorized',
    group: cat?.group ?? 'Other',
    months,
    currentCents,
    priorCents,
    deltaCents,
    pctChange: priorCents === 0 ? null : deltaCents / priorCents,
  };
}
