/**
 * Category visibility (DECISIONS #110) — pure helpers for the "hide the
 * categories I don't use" feature. A per-user hidden-id set filters the
 * assignment pickers; the system Category rows themselves are never deleted
 * (they're global + FK'd by historical data), so hiding is purely a display
 * concern. No React, no DB.
 */
import {
  ASSIGNABLE_CATEGORIES,
  type AssignableCategory,
  assignableCategories,
  assignableGroups,
} from './assign';
import { CATEGORY_BY_ID, NO_RENAMES } from './categories';

/**
 * Categories that can never be hidden. `uncategorized` is the absence-of-a-
 * decision fallback (and the reassign target when a custom category is deleted),
 * so it must always remain valid — though it's already excluded from the
 * ASSIGNABLE_* tables, so it never appears in a picker anyway.
 */
export const NON_HIDEABLE: ReadonlySet<string> = new Set(['uncategorized']);

/** A real, user-hideable system category (excludes unknown ids + uncategorized). */
export function isHideable(categoryId: string): boolean {
  return CATEGORY_BY_ID.has(categoryId) && !NON_HIDEABLE.has(categoryId);
}

export interface CatalogEntry {
  id: string;
  /** What the reader sees — their rename when they set one, else the built-in name. */
  name: string;
  /** The built-in name, always. The manager needs it to offer "Reset to <default>". */
  defaultName: string;
  renamed: boolean;
  group: string;
  hidden: boolean;
  hideable: boolean;
}
export interface CatalogGroup {
  group: string;
  categories: CatalogEntry[];
}

/**
 * The full management catalog for the Settings UI: every assignable system
 * category annotated with its hidden state, grouped by parent in CATEGORIES
 * order. Shows hidden ones too (so they can be turned back on).
 */
export function categoryCatalog(
  hiddenIds: Iterable<string>,
  renames: ReadonlyMap<string, string> = NO_RENAMES,
): CatalogGroup[] {
  const hidden = new Set(hiddenIds);
  const out: CatalogGroup[] = [];
  for (const c of ASSIGNABLE_CATEGORIES) {
    let g = out.find((o) => o.group === c.group);
    if (!g) {
      g = { group: c.group, categories: [] };
      out.push(g);
    }
    const renamed = renames.get(c.id);
    g.categories.push({
      id: c.id,
      name: renamed ?? c.name,
      defaultName: c.name,
      renamed: renamed !== undefined,
      group: c.group,
      hidden: hidden.has(c.id),
      hideable: isHideable(c.id),
    });
  }
  return out;
}

/**
 * Visible assignable categories (flat), hidden ones removed, the user's custom
 * categories included (DECISIONS #111). Inbox full picker. With no customs this
 * is byte-identical to the system-only result.
 */
export function visibleCategories(
  hiddenIds: Iterable<string>,
  custom: readonly AssignableCategory[] = [],
  renames: ReadonlyMap<string, string> = NO_RENAMES,
): { id: string; name: string; group: string }[] {
  const hidden = new Set(hiddenIds);
  return assignableCategories(custom, renames).filter((c) => !hidden.has(c.id));
}

/**
 * Visible assignable categories grouped by parent, empty groups dropped, with
 * custom categories merged in (DECISIONS #111). The two-level register picker.
 */
export function visibleGroups(
  hiddenIds: Iterable<string>,
  custom: readonly AssignableCategory[] = [],
  renames: ReadonlyMap<string, string> = NO_RENAMES,
): { group: string; categories: { id: string; name: string }[] }[] {
  const hidden = new Set(hiddenIds);
  return assignableGroups(custom, renames)
    .map((g) => ({
      group: g.group,
      categories: g.categories.filter((c) => !hidden.has(c.id)),
    }))
    .filter((g) => g.categories.length > 0);
}
