/**
 * Per-user category-meta resolver (DECISIONS #111). Loads the user's custom
 * (non-system) Category rows and overlays them on the static system map, so any
 * engine threaded with this map resolves a custom category's name/group/
 * discretionary correctly instead of falling back to "Uncategorized"/"Other".
 * Ownership-scoped by userId; built once per request and passed down.
 */
import { prisma } from '@/lib/db';
import {
  CATEGORY_BY_ID,
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

/**
 * Scoped name lookup for shared-register rows (HOUSEHOLD_ARCHITECTURE §4.5 /
 * TASKS 4.2 slice 3). Resolves ONLY the `categoryId`s that appear on
 * partner-shared transactions — never the partner's full category vocabulary.
 *
 * **Do not widen `getCategoryMeta`.** That resolver feeds coach / reports /
 * trends / recurring / triage; union-ing a partner's customs into it would leak
 * private category names into every surface §4.5 promised stays personal.
 * Callers that need the viewer's own picker/meta keep using `getCategoryMeta`.
 */
export async function categoryNamesByIds(
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id && id !== 'uncategorized'))];
  const map = new Map<string, string>();
  // System ids resolve from the static map — no DB round-trip.
  const remaining: string[] = [];
  for (const id of unique) {
    const sys = CATEGORY_BY_ID.get(id);
    if (sys) map.set(id, sys.name);
    else remaining.push(id);
  }
  if (remaining.length === 0) return map;
  // Custom (and any other) rows: id-scoped only. The ids came from shared-account
  // transactions the viewer is already allowed to see, so the name is inherent
  // shared data — not a vocabulary leak.
  const rows = await prisma.category.findMany({
    where: { id: { in: remaining } },
    select: { id: true, name: true },
  });
  for (const r of rows) map.set(r.id, r.name);
  return map;
}

/**
 * Write-path guard (DECISIONS #111): a category id may be assigned only when it
 * is a known SYSTEM category (incl. subcategories + the `uncategorized`
 * placeholder) OR a CUSTOM category this user owns. Throws otherwise — so a
 * hand-crafted POST can't file a row under an arbitrary string or, worse,
 * another user's custom category id (a cross-tenant name leak via the display
 * join). System ids short-circuit with no DB call, so the hot path is unchanged.
 */
export async function assertOwnedCategory(userId: string, categoryId: string): Promise<void> {
  if (CATEGORY_BY_ID.has(categoryId)) return;
  const owned = await prisma.category.findFirst({
    where: { id: categoryId, userId, isSystem: false },
    select: { id: true },
  });
  if (!owned) throw new Error('Choose a valid category');
}
