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

/**
 * A merchant-wide "always" rule is offered only for real merchants — never for
 * aggregate pseudo-merchants (Zelle / checks / ATM) that group unrelated payees,
 * where "always file ALL of these the same way" would be wrong (DECISIONS #23).
 */
export function isRuleEligibleMerchant(rawDescriptor: string): boolean {
  return !normalizeMerchant(rawDescriptor).aggregate;
}
