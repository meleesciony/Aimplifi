/**
 * P2.2 — memory-dividend / who-notices reflection (C5 · Perkins, Housel).
 *
 * The Life Energy card already lists the largest purchases. The reflection is
 * only about big discretionary buys outside declared money dials. Rent,
 * groceries, a travel dial, and an uncategorized row are not that set —
 * showing the line beside them would police protected spending or invent a
 * "buy". No money math: the caller already ranked the purchases.
 */
import type { CategoryMeta } from '@/lib/engine/categorize/categories';
import { categoryMatchesMoneyDial } from './discretionary-cuts';

export function memoryDividendApplies(
  categoryId: string | null | undefined,
  moneyDialIds: readonly string[],
  meta: ReadonlyMap<string, Pick<CategoryMeta, 'discretionary'>>,
): boolean {
  if (!categoryId || categoryId === 'uncategorized') return false;
  if (categoryMatchesMoneyDial(categoryId, moneyDialIds)) return false;
  return meta.get(categoryId)?.discretionary === true;
}

/** True when the listed purchases include at least one that may carry the line. */
export function lifeEnergyShowsMemoryDividend(
  items: readonly { categoryId: string | null | undefined }[],
  moneyDialIds: readonly string[],
  meta: ReadonlyMap<string, Pick<CategoryMeta, 'discretionary'>>,
): boolean {
  return items.some((item) => memoryDividendApplies(item.categoryId, moneyDialIds, meta));
}
