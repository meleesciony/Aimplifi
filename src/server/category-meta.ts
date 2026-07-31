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
export type { CustomCategoryInput };

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

/**
 * A user's per-user renames of SYSTEM categories, id → their name (O.17).
 *
 * System Category rows are global and FK'd by everyone's history, so a rename is
 * an overlay rather than an edit. Ids that are no longer in CATEGORIES (a
 * category retired by a later release) are dropped here rather than at each
 * reader: a stale row must never resurrect a label for a category the pickers no
 * longer offer.
 */
export async function getCategoryRenames(userId: string): Promise<Map<string, string>> {
  const rows = await prisma.categoryRename.findMany({
    where: { userId },
    select: { categoryId: true, name: true },
  });
  const m = new Map<string, string>();
  for (const r of rows) {
    if (CATEGORY_BY_ID.has(r.categoryId)) m.set(r.categoryId, r.name);
  }
  return m;
}

/**
 * The user's whole category overlay in ONE round trip: their custom categories
 * plus their system renames.
 *
 * Every surface that resolves a category NAME takes it from here (directly, or
 * via `getCategoryMeta` below). That is deliberate: a rename applied per call
 * site would reach the pickers and miss the register, or reach the register and
 * miss Ask — the failure this codebase has already paid for twice
 * (fence-by-construction, docs/lessons). One loader, one overlay.
 */
export async function getCategoryOverlay(
  userId: string,
): Promise<{ custom: CustomCategoryInput[]; renames: Map<string, string> }> {
  const [custom, renames] = await Promise.all([
    getCustomCategories(userId),
    getCategoryRenames(userId),
  ]);
  return { custom, renames };
}

/**
 * Every category name this reader can currently SEE, lowercased → the id that
 * owns it. Built-ins under their EFFECTIVE name (their rename when they set
 * one), then the reader's custom categories.
 *
 * ONE author for the duplicate-name rule, because there are three doors into it
 * — create a custom, rename a custom, rename a built-in — and a rule copied per
 * door misses a door. It did: the rename door guarded against a custom's name
 * while the create door still compared against CANONICAL built-in names, so a
 * custom could take a renamed built-in's label (two identical picker rows, one
 * of them a budget target), and creating a custom called "Groceries" was refused
 * on behalf of a built-in the reader had already renamed away from it.
 *
 * Hidden categories are INCLUDED deliberately: removing one is reversible, so a
 * name in use by a removed category is still spoken for. Callers say so in the
 * refusal rather than making the reader hunt for a row they cannot see.
 */
export async function visibleCategoryNames(userId: string): Promise<Map<string, string>> {
  const { custom, renames } = await getCategoryOverlay(userId);
  const byName = new Map<string, string>();
  for (const c of CATEGORY_BY_ID.values()) {
    byName.set((renames.get(c.id) ?? c.name).toLowerCase(), c.id);
  }
  for (const c of custom) byName.set(c.name.toLowerCase(), c.id);
  return byName;
}

/**
 * Per-user id→meta resolver: static system map overlaid with the user's customs
 * and their system renames.
 */
export async function getCategoryMeta(userId: string): Promise<Map<string, CategoryMeta>> {
  const { custom, renames } = await getCategoryOverlay(userId);
  return mergeCategoryMeta(custom, renames);
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
