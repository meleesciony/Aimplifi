/**
 * Trailing average monthly spend by discretionary category — input for
 * dial-aware cut proposals (DECISIONS #375).
 *
 * Uses STORED categoryId (triage truth), same as lifestyle-creep. Only complete
 * months before `today`. Pure: caller supplies today + meta.
 *
 * History-aware denominator (audit P2): the window divides by the number of
 * months that ACTUALLY have data, not the full requested window — a new user
 * with one month of history must not have every figure divided by 3 (cut
 * proposals three times smaller than the truth). Steady-state users with a full
 * window are unchanged.
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
  // Distinct months in the window with any eligible transaction — the true
  // history span (audit P2). A user tracked for 2 months must not be divided
  // by a 3-month window; a user with 4 months is unchanged.
  const monthsWithData = new Set<string>();
  for (const t of transactions) {
    if (!countsInFlows(t, excludedFlowIds)) continue;
    if (t.amountCents >= 0) continue;
    const m = monthKey(t.date);
    if (!monthSet.has(m)) continue;
    monthsWithData.add(m);
    const categoryId = t.categoryId;
    if (!categoryId || categoryId === 'uncategorized') continue;
    if (!meta.get(categoryId)?.discretionary) continue;
    totals.set(categoryId, (totals.get(categoryId) ?? 0) - t.amountCents);
  }

  const denom = Math.max(1, monthsWithData.size);
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
