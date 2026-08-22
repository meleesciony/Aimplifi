/**
 * P2.2 — Life-energy "memory dividend / who notices" reflection (C5 ·
 * Perkins, Housel).
 *
 * A lens for big discretionary buys outside declared money dials. No new
 * money math. Reuses `categoryMatchesMoneyDial` and the taxonomy
 * `discretionary` flag the creep / cut engines already read.
 *
 * Shown only when at least one listed purchase is discretionary AND not a
 * dial. Rent, bills, and money-dial travel are silent — applying
 * "meant to impress" to those is a false claim. An unknown category is
 * not a fact (uncategorized / missing meta → do not apply).
 */
import type { CategoryMeta } from '@/lib/engine/categorize/categories';
import { COACH_COPY } from './coach-copy';
import { categoryMatchesMoneyDial } from './discretionary-cuts';

export type MemoryDividendKind = 'reflect' | 'not_applicable' | 'empty';

export interface MemoryDividendItem {
  categoryId: string | null;
}

export interface MemoryDividendRow {
  kind: MemoryDividendKind;
  /** True only for `reflect` — the Coach card renders the line then. */
  show: boolean;
  line: string;
}

export function memoryDividendApplies(
  items: readonly MemoryDividendItem[],
  moneyDialIds: readonly string[],
  meta: ReadonlyMap<string, CategoryMeta>,
): boolean {
  return items.some((item) => {
    if (!item.categoryId) return false;
    const cat = meta.get(item.categoryId);
    if (!cat?.discretionary) return false;
    return !categoryMatchesMoneyDial(item.categoryId, moneyDialIds);
  });
}

export function composeMemoryDividend(input: {
  items: readonly MemoryDividendItem[];
  moneyDialIds: readonly string[];
  meta: ReadonlyMap<string, CategoryMeta>;
}): MemoryDividendRow {
  if (input.items.length === 0) {
    return {
      kind: 'empty',
      show: false,
      line: COACH_COPY.memoryDividendEmpty(),
    };
  }
  if (memoryDividendApplies(input.items, input.moneyDialIds, input.meta)) {
    return {
      kind: 'reflect',
      show: true,
      line: COACH_COPY.memoryDividend(),
    };
  }
  return {
    kind: 'not_applicable',
    show: false,
    line: COACH_COPY.memoryDividendNotApplicable(),
  };
}
