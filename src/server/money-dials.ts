/**
 * Load the money-dial catalog and resolve stored tokens to category ids.
 * One overlay + hidden set; callers must not re-derive the name→id map.
 */
import { parseStoredDials } from '@/lib/engine/settings/dials';
import {
  buildDialCatalog,
  resolveMoneyDialIds,
  type DialCatalogEntry,
} from '@/lib/engine/settings/money-dial-ids';
import { getCategoryOverlay } from '@/server/category-meta';
import { getHiddenCategoryIds } from '@/server/categories';

export async function loadDialCatalog(userId: string): Promise<DialCatalogEntry[]> {
  const [overlay, hidden] = await Promise.all([
    getCategoryOverlay(userId),
    getHiddenCategoryIds(userId),
  ]);
  return buildDialCatalog(overlay.custom, overlay.renames, hidden);
}

export function resolvedMoneyDialIds(
  raw: string | null | undefined,
  catalog: readonly DialCatalogEntry[],
): string[] {
  return resolveMoneyDialIds(parseStoredDials(raw), catalog);
}
