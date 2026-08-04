/**
 * Trailing average monthly spend by discretionary category — input for
 * dial-aware cut proposals (DECISIONS #375).
 *
 * Uses STORED categoryId (triage truth), same as lifestyle-creep. Only complete
 * months before `today`. Pure: caller supplies today + meta.
 */
import { addMonthsClamped, isoDate, monthKey, type ISODate } from '@/lib/dates';
import { CATEGORY_BY_ID, type CategoryMeta } from '@/lib/engine/categorize/categories';
import { countsInFlows, type TxnLike } from '@/lib/engine/fi/insights';
import type { DiscretionaryCategorySpend } from '@/lib/engine/fi/discretionary-cuts';

export function averageDiscretionaryCategorySpend(
  transactions: readonly TxnLike[],
  today: ISODate,
  windowMonths = 3,
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
  nameOf: (id: string) => string = (id) => meta.get(id)?.name ?? id,
  excludedFlowIds?: ReadonlySet<string>, // C.25 (#403): loan payments are not discretionary spend
): DiscretionaryCategorySpend[] {
  const months = Math.max(1, Math.trunc(windowMonths));
  const lastFullMonthStart = addMonthsClamped(isoDate(`${monthKey(today)}-01`), 0);
  const monthSet = new Set<string>();
  for (let k = months; k >= 1; k--) {
    monthSet.add(monthKey(addMonthsClamped(lastFullMonthStart, -k)));
  }

  const totals = new Map<string, number>();
  for (const t of transactions) {
    if (!countsInFlows(t, excludedFlowIds)) continue;
    if (t.amountCents >= 0) continue;
    const m = monthKey(t.date);
    if (!monthSet.has(m)) continue;
    const categoryId = t.categoryId;
    if (!categoryId || categoryId === 'uncategorized') continue;
    if (!meta.get(categoryId)?.discretionary) continue;
    totals.set(categoryId, (totals.get(categoryId) ?? 0) - t.amountCents);
  }

  const denom = monthSet.size;
  return [...totals.entries()]
    .map(([categoryId, sum]) => ({
      categoryId,
      categoryName: nameOf(categoryId),
      monthlyCents: Math.round(sum / denom),
      discretionary: true as const,
    }))
    .filter((c) => c.monthlyCents > 0)
    .sort((a, b) => b.monthlyCents - a.monthlyCents || a.categoryName.localeCompare(b.categoryName));
}
