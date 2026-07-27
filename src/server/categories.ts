/**
 * Per-user category visibility reads (DECISIONS #110). The hidden set is a tiny
 * per-user table; these helpers feed it into the pure visibility layer to
 * produce the management catalog (Settings) and the filtered picker sources
 * (inbox full picker, register two-level picker). Ownership-scoped by userId.
 */
import { prisma } from '@/lib/db';
import {
  categoryCatalog,
  visibleCategories,
  visibleGroups,
  type CatalogGroup,
} from '@/lib/engine/categorize/visibility';
import { getCustomCategories } from '@/server/category-meta';

export async function getHiddenCategoryIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.hiddenCategory.findMany({
    where: { userId },
    select: { categoryId: true },
  });
  return new Set(rows.map((r) => r.categoryId));
}

/** Full management catalog (every category + its hidden flag) for the Settings UI. */
export async function getCategoryCatalog(userId: string): Promise<CatalogGroup[]> {
  return categoryCatalog(await getHiddenCategoryIds(userId));
}

/**
 * Visible assignable categories (flat) — the inbox "any category" picker. Custom
 * categories (DECISIONS #111) are merged in so a created category is assignable
 * everywhere; with none the result is the system-only set.
 */
export async function getVisibleCategories(
  userId: string,
): Promise<{ id: string; name: string; group: string }[]> {
  const [hidden, custom] = await Promise.all([
    getHiddenCategoryIds(userId),
    getCustomCategories(userId),
  ]);
  return visibleCategories(hidden, custom);
}

/** Visible assignable categories grouped by parent — the register picker. */
export async function getVisibleGroups(
  userId: string,
): Promise<{ group: string; categories: { id: string; name: string }[] }[]> {
  const [hidden, custom] = await Promise.all([
    getHiddenCategoryIds(userId),
    getCustomCategories(userId),
  ]);
  return visibleGroups(hidden, custom);
}

/**
 * The `linkable` set every `categoryRegisterHref` caller must pass (O.5/O.6) —
 * exactly the ids the register's own category `<select>` can DISPLAY, which is
 * the flattened register picker above.
 *
 * One author, because this is a fence and a fence copied per call site misses
 * call sites. /reports flattened `getVisibleGroups` inline; O.6 adds two more
 * surfaces, and three inline copies of the same flatMap is precisely how the
 * hidden-category hole (O.5 critic F-3) would reopen on one page and not the
 * others. Callers pass the returned array straight to a client component, so it
 * is a plain array rather than a Set — the component builds the Set.
 */
export async function getLinkableCategoryIds(userId: string): Promise<string[]> {
  const groups = await getVisibleGroups(userId);
  return groups.flatMap((g) => g.categories.map((c) => c.id));
}
