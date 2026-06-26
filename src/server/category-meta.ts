/**
 * Per-user category-meta resolver (DECISIONS #111). Loads the user's custom
 * (non-system) Category rows and overlays them on the static system map, so any
 * engine threaded with this map resolves a custom category's name/group/
 * discretionary correctly instead of falling back to "Uncategorized"/"Other".
 * Ownership-scoped by userId; built once per request and passed down.
 */
import { prisma } from '@/lib/db';
import {
  mergeCategoryMeta,
  type CategoryMeta,
  type CustomCategoryInput,
} from '@/lib/engine/categorize/categories';

/** A user's custom categories, normalized for the resolver (group never null). */
export async function getCustomCategories(userId: string): Promise<CustomCategoryInput[]> {
  const rows = await prisma.category.findMany({
    where: { userId, isSystem: false },
    select: { id: true, name: true, group: true, discretionary: true },
    orderBy: { name: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    // A custom row should always carry a group (the create form requires one);
    // fall back to the catch-all group only defensively so grouping never breaks.
    group: r.group ?? 'Transfers & Other',
    discretionary: r.discretionary,
  }));
}

/** Per-user id→meta resolver: static system map overlaid with the user's customs. */
export async function getCategoryMeta(userId: string): Promise<Map<string, CategoryMeta>> {
  return mergeCategoryMeta(await getCustomCategories(userId));
}
