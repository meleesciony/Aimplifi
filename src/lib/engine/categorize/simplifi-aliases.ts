/**
 * O.17 refused Simplifi leaf names as duplicates of existing ids
 * (categories.ts header). Simplifi wins classification: those names must be
 * clickable in the picker and file the existing id — never a second leaf.
 *
 * Search still filters; filing is scroll/click, then the existing Just-this-once
 * confirm. Do not treat type-and-Enter as the apply path.
 */
export const SIMPLIFI_LEAF_ALIASES: Readonly<Record<string, readonly string[]>> = {
  dining: ['Restaurants'],
  subscriptions: ['Digital Services'],
  fitness: ['Gym'],
  transport: ['Rideshare'],
  parking: ['Tolls'],
};

/** Canonical display name for a system id, for the File-as confirm copy. */
export function canonicalCategoryName(
  id: string,
  items: readonly { id: string; name: string }[],
): string {
  return items.find((c) => c.id === id)?.name ?? id;
}

/**
 * Append Simplifi alias rows after each canonical leaf, same id.
 * Clicking "Restaurants" files `dining`. Skips an alias that already exists
 * as a name in the group (custom leaf, or Food Delivery which is real).
 */
export function expandSimplifiAliasRows(
  items: readonly { id: string; name: string }[],
): { id: string; name: string }[] {
  const seen = new Set(items.map((i) => i.name.toLowerCase()));
  const out: { id: string; name: string }[] = [];
  for (const item of items) {
    out.push({ id: item.id, name: item.name });
    for (const alias of SIMPLIFI_LEAF_ALIASES[item.id] ?? []) {
      const key = alias.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: item.id, name: alias });
    }
  }
  return out;
}
