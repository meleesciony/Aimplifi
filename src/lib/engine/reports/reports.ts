/**
 * Reports engine (DECISIONS #67) — pure spending analytics over categorized
 * transactions. Spending = expenses only (transfers, split parents, and income
 * excluded); refunds net against their category. Rolls leaf subcategories up to
 * their parent group. Integer cents in/out, no I/O.
 */
import { CATEGORY_BY_ID, type CategoryMeta } from '@/lib/engine/categorize/categories';

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
