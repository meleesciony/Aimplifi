/**
 * Manual-assignment helpers for the transaction register / triage (DECISIONS #36).
 *
 * The categorization pipeline auto-files transactions and routes only the
 * low-confidence ones to triage. But a CONFIDENT-but-wrong guess never reaches
 * triage, so the register needs its own inline recategorization. These pure
 * helpers define what a user may assign by hand and which merchants can carry a
 * durable "always" rule — no React, no DB.
 */
import { CATEGORIES, NO_RENAMES } from './categories';
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
  renames: ReadonlyMap<string, string> = NO_RENAMES,
): AssignableCategory[] {
  if (custom.length === 0 && renames.size === 0) return ASSIGNABLE_CATEGORIES;
  // A rename replaces the LABEL in place; canonical order never changes, so the
  // picker does not reshuffle under a reader who renamed one row (and no golden
  // that pins an index moves).
  const base =
    renames.size === 0
      ? ASSIGNABLE_CATEGORIES
      : ASSIGNABLE_CATEGORIES.map((c) => {
          const renamed = renames.get(c.id);
          return renamed ? { ...c, name: renamed } : c;
        });
  return custom.length === 0 ? base : [...base, ...custom];
}

/**
 * Two-level grouping including customs: a custom slots into an existing group
 * when its `group` matches a system group name, otherwise it opens a new group
 * appended after the system ones. With no customs the shared static grouping is
 * returned unchanged.
 */
export function assignableGroups(
  custom: readonly AssignableCategory[] = [],
  renames: ReadonlyMap<string, string> = NO_RENAMES,
): { group: string; categories: { id: string; name: string }[] }[] {
  if (custom.length === 0 && renames.size === 0) return ASSIGNABLE_GROUPS;
  const out: { group: string; categories: { id: string; name: string }[] }[] = [];
  for (const c of assignableCategories(custom, renames)) {
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
 * SPENDING groups only: the flow engines classify income by GROUP
 * (`isIncomeCategoryId` — see #166; custom ids are never in the static
 * taxonomy, so they always net as spending) and transfers by flag/id, so a
 * custom placed in "Income" or "Transfers & Other" would be mis-aggregated. Excluding those two groups makes every custom a genuine
 * spending category, so a custom can never be mistaken for income or a transfer.
 *
 * HOW LOAD-BEARING THIS IS (measured 2026-07-30, O.13e decision, DECISIONS #345).
 * The paragraph above names `isIncomeCategoryId`, which has exactly TWO call
 * sites (`budgets/status.ts`, `fi/insights.ts`). That understates the
 * dependency by an order of magnitude: "is this category income?" is answered in
 * **14 places**, twelve of them inline `group === 'Income'` comparisons that
 * never touch the shared predicate. Worse, those readers split across two
 * different maps — `reports.ts` and `trends.ts` resolve through the PER-USER
 * merged meta (custom-aware), while the other twelve read the static
 * `CATEGORY_BY_ID` (custom-blind). Those two families agree today for one reason
 * only: this exclusion.
 *
 * So do not relax this set as a UI convenience. Admitting a custom category to
 * the Income group turns `pipeline.ts`'s three #44 sign guards from a documented
 * exemption ("custom category — group unknown, so no claim is made") into a live
 * defect: `keywordRuleSignOk` would return true for an OUTFLOW into a custom
 * income category, `isSpendRow` would then drop that row from reports, trends and
 * budgets while `monthlyFlows` still counted it as an expense — two surfaces
 * disagreeing by the amount, with no badge and no review. The prerequisite for
 * ever allowing it is threading per-user meta into `pipeline.ts` and collapsing
 * all 14 predicates onto one custom-aware basis; see TASKS O.13e.
 *
 * Locked fail-old by `tests/unit/custom-category-lifecycle.test.ts` ("refuses the
 * Income and Transfers groups").
 */
const NON_CUSTOM_GROUPS: ReadonlySet<string> = new Set(['Income', 'Transfers & Other']);
export const CUSTOM_CATEGORY_GROUPS: string[] = ASSIGNABLE_GROUPS.map((g) => g.group).filter(
  (g) => !NON_CUSTOM_GROUPS.has(g),
);

/**
 * Case-insensitive substring filter over grouped category options — the pure
 * core of the searchable pickers (#136 increment 2). Empty/blank query returns
 * the SAME array reference (zero-cost identity for the no-search render).
 * A query matching a GROUP label keeps the whole group: the labels are visible
 * in the picker, so "bills" must find the "Bills & Utilities" group — a
 * name-only match would falsely say "no match" and nudge the user into
 * creating a duplicate category (critic P1). Groups with no match are dropped.
 */
export function filterCategoryOptions(
  groups: readonly { group: string; items: { id: string; name: string }[] }[],
  query: string,
): { group: string; items: { id: string; name: string }[] }[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups as { group: string; items: { id: string; name: string }[] }[];
  return groups
    .map((g) =>
      g.group.toLowerCase().includes(q)
        ? g
        : { group: g.group, items: g.items.filter((c) => c.name.toLowerCase().includes(q)) },
    )
    .filter((g) => g.items.length > 0);
}

/**
 * A merchant-wide "always" rule is offered only for real merchants — never for
 * aggregate pseudo-merchants (Zelle / checks / ATM) that group unrelated payees,
 * where "always file ALL of these the same way" would be wrong (DECISIONS #23).
 */
export function isRuleEligibleMerchant(rawDescriptor: string): boolean {
  return !normalizeMerchant(rawDescriptor).aggregate;
}
