/**
 * Money dials are category IDs (O.17a / DECISIONS #482).
 *
 * `User.moneyDials` is still a JSON string[] column. New writes store IDs.
 * Rows written as names (the free-text field) resolve on read: an exact id
 * wins; a name maps only when it uniquely matches a catalog display name or
 * built-in name. Ambiguous or unknown tokens are dropped — never guessed.
 */
import { CATEGORIES } from '@/lib/engine/categorize/categories';
import { isBudgetable } from '@/lib/engine/budgets/status';

const DIAL_ID_CAP = 12;

export interface DialCatalogEntry {
  id: string;
  /** Current display name (rename overlay applied). */
  name: string;
  /** Built-in name for a system category; same as `name` for a custom. */
  builtInName: string;
  group: string;
  hidden: boolean;
}

export function buildDialCatalog(
  custom: readonly { id: string; name: string; group: string }[],
  renames: ReadonlyMap<string, string> = new Map(),
  hiddenIds: ReadonlySet<string> = new Set(),
): DialCatalogEntry[] {
  const out: DialCatalogEntry[] = [];
  for (const c of CATEGORIES) {
    if (!isBudgetable(c.id)) continue;
    out.push({
      id: c.id,
      name: renames.get(c.id) ?? c.name,
      builtInName: c.name,
      group: c.group,
      hidden: hiddenIds.has(c.id),
    });
  }
  for (const c of custom) {
    if (!isBudgetable(c.id)) continue;
    out.push({
      id: c.id,
      name: c.name,
      builtInName: c.name,
      group: c.group,
      hidden: hiddenIds.has(c.id),
    });
  }
  return out;
}

/**
 * Map stored tokens (ids and/or leftover names) onto catalog ids.
 * First-seen order; duplicates dropped; capped at 12.
 */
export function resolveMoneyDialIds(
  stored: readonly string[],
  catalog: readonly DialCatalogEntry[],
): string[] {
  const byId = new Map<string, DialCatalogEntry>();
  const byName = new Map<string, string[]>();
  const addName = (raw: string, id: string) => {
    const key = raw.trim().toLowerCase();
    if (!key) return;
    const existing = byName.get(key);
    if (existing) {
      if (!existing.includes(id)) existing.push(id);
    } else {
      byName.set(key, [id]);
    }
  };
  for (const e of catalog) {
    byId.set(e.id, e);
    addName(e.name, e.id);
    addName(e.builtInName, e.id);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of stored) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    let id: string | undefined;
    if (byId.has(trimmed)) {
      id = trimmed;
    } else {
      const matches = byName.get(trimmed.toLowerCase()) ?? [];
      if (matches.length === 1) id = matches[0];
    }
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= DIAL_ID_CAP) break;
  }
  return out;
}

export function dialDisplayNames(
  ids: readonly string[],
  catalog: readonly DialCatalogEntry[],
): string[] {
  const byId = new Map(catalog.map((e) => [e.id, e.name]));
  return ids.map((id) => byId.get(id)).filter((n): n is string => !!n);
}

/** Budgetable system ids — the default write-path allow-list when the caller has no customs. */
export function systemBudgetableDialIds(): string[] {
  return CATEGORIES.filter((c) => isBudgetable(c.id)).map((c) => c.id);
}
