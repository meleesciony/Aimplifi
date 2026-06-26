/**
 * Manual-assignment helpers for the transaction register / triage (DECISIONS #36).
 *
 * The categorization pipeline auto-files transactions and routes only the
 * low-confidence ones to triage. But a CONFIDENT-but-wrong guess never reaches
 * triage, so the register needs its own inline recategorization. These pure
 * helpers define what a user may assign by hand and which merchants can carry a
 * durable "always" rule — no React, no DB.
 */
import { CATEGORIES } from './categories';
import { normalizeMerchant } from './normalize';

/**
 * Categories a user can assign by hand, in the canonical CATEGORIES order.
 * Excludes the internal `uncategorized` placeholder — you can't deliberately
 * file something as "uncategorized" (that's the absence of a decision).
 */
export const ASSIGNABLE_CATEGORIES: { id: string; name: string; group: string }[] = CATEGORIES.filter(
  (c) => c.id !== 'uncategorized',
).map((c) => ({ id: c.id, name: c.name, group: c.group }));

/**
 * Subcategories grouped under their parent category, for the two-level picker
 * (DECISIONS #65). Group order follows CATEGORIES; `uncategorized` excluded.
 */
export const ASSIGNABLE_GROUPS: { group: string; categories: { id: string; name: string }[] }[] = (() => {
  const out: { group: string; categories: { id: string; name: string }[] }[] = [];
  for (const c of ASSIGNABLE_CATEGORIES) {
    let g = out.find((o) => o.group === c.group);
    if (!g) {
      g = { group: c.group, categories: [] };
      out.push(g);
    }
    g.categories.push({ id: c.id, name: c.name });
  }
  return out;
})();

export interface AssignableCategory {
  id: string;
  name: string;
  group: string;
}

/**
 * Assignable categories with the user's CUSTOM categories appended (DECISIONS
 * #111). System categories keep their canonical order; customs follow, in the
 * order given. With no customs the shared static array is returned unchanged, so
 * every existing caller and golden stays byte-identical.
 */
export function assignableCategories(
  custom: readonly AssignableCategory[] = [],
): AssignableCategory[] {
  return custom.length === 0 ? ASSIGNABLE_CATEGORIES : [...ASSIGNABLE_CATEGORIES, ...custom];
}

/**
 * Two-level grouping including customs: a custom slots into an existing group
 * when its `group` matches a system group name, otherwise it opens a new group
 * appended after the system ones. With no customs the shared static grouping is
 * returned unchanged.
 */
export function assignableGroups(
  custom: readonly AssignableCategory[] = [],
): { group: string; categories: { id: string; name: string }[] }[] {
  if (custom.length === 0) return ASSIGNABLE_GROUPS;
  const out: { group: string; categories: { id: string; name: string }[] }[] = [];
  for (const c of assignableCategories(custom)) {
    let g = out.find((o) => o.group === c.group);
    if (!g) {
      g = { group: c.group, categories: [] };
      out.push(g);
    }
    g.categories.push({ id: c.id, name: c.name });
  }
  return out;
}

/**
 * Groups a user may file a CUSTOM category under (DECISIONS #111, critic F2/F4).
 * SPENDING groups only: the flow engines classify income and transfers by literal
 * id (`monthlyFlows` nets non-`income` inflows as refunds; reports/query exclude
 * `id==='transfer'`), so a custom placed in "Income" or "Transfers & Other" would
 * be mis-aggregated. Excluding those two groups makes every custom a genuine
 * spending category, so a custom can never be mistaken for income or a transfer.
 */
const NON_CUSTOM_GROUPS: ReadonlySet<string> = new Set(['Income', 'Transfers & Other']);
export const CUSTOM_CATEGORY_GROUPS: string[] = ASSIGNABLE_GROUPS.map((g) => g.group).filter(
  (g) => !NON_CUSTOM_GROUPS.has(g),
);

/**
 * A merchant-wide "always" rule is offered only for real merchants — never for
 * aggregate pseudo-merchants (Zelle / checks / ATM) that group unrelated payees,
 * where "always file ALL of these the same way" would be wrong (DECISIONS #23).
 */
export function isRuleEligibleMerchant(rawDescriptor: string): boolean {
  return !normalizeMerchant(rawDescriptor).aggregate;
}
