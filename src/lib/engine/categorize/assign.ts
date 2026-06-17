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
export const ASSIGNABLE_CATEGORIES: { id: string; name: string }[] = CATEGORIES.filter(
  (c) => c.id !== 'uncategorized',
).map((c) => ({ id: c.id, name: c.name }));

/**
 * A merchant-wide "always" rule is offered only for real merchants — never for
 * aggregate pseudo-merchants (Zelle / checks / ATM) that group unrelated payees,
 * where "always file ALL of these the same way" would be wrong (DECISIONS #23).
 */
export function isRuleEligibleMerchant(rawDescriptor: string): boolean {
  return !normalizeMerchant(rawDescriptor).aggregate;
}
