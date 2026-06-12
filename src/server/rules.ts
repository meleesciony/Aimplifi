/**
 * User-rule loader (cycle-1 fix C2): the bridge that was missing between the
 * stored CategorizationRule rows (keyed by merchantId) and the pure
 * pipeline's RuleLike (keyed by canonical merchant name). Without this, rules
 * created by "Always" were write-only.
 */
import { prisma } from '@/lib/db';
import { isAggregateCanonical } from '@/lib/engine/categorize/normalize';
import type { RuleLike } from '@/lib/engine/categorize/pipeline';

export interface RuleRow {
  id: string;
  merchantId: string | null;
  minAmountCents: number | null;
  maxAmountCents: number | null;
  weekendOnly: boolean | null;
  weekdayOnly: boolean | null;
  accountId: string | null;
  categoryId: string;
  priority: number;
}

/**
 * Pure mapper — unit-tested without a database. Returns null for a rule whose
 * merchantId can no longer be resolved: in RuleLike, `merchantCanonical: null`
 * means "ANY merchant", so mapping an orphan to null would silently turn it
 * into a match-everything rule. Orphans must match NOTHING.
 */
export function toRuleLike(
  rule: RuleRow,
  canonicalByMerchantId: ReadonlyMap<string, string>,
): RuleLike | null {
  let merchantCanonical: string | null = null;
  if (rule.merchantId) {
    const canonical = canonicalByMerchantId.get(rule.merchantId);
    if (!canonical) return null; // orphaned merchant reference
    // defense in depth: aggregate pseudo-merchants never steer suggestions,
    // even if a rule row predates the creation-time guard
    if (isAggregateCanonical(canonical)) return null;
    merchantCanonical = canonical;
  }
  return {
    id: rule.id,
    merchantCanonical,
    minAmountCents: rule.minAmountCents,
    maxAmountCents: rule.maxAmountCents,
    weekendOnly: rule.weekendOnly,
    weekdayOnly: rule.weekdayOnly,
    accountId: rule.accountId,
    categoryId: rule.categoryId,
    priority: rule.priority,
  };
}

export async function loadUserRules(userId: string): Promise<RuleLike[]> {
  const rules = await prisma.categorizationRule.findMany({ where: { userId } });
  const merchantIds = [...new Set(rules.map((r) => r.merchantId).filter((x): x is string => !!x))];
  const merchants = merchantIds.length
    ? await prisma.merchant.findMany({ where: { id: { in: merchantIds } } })
    : [];
  const canonicalById = new Map(merchants.map((m) => [m.id, m.canonical]));
  return rules.map((r) => toRuleLike(r, canonicalById)).filter((r): r is RuleLike => r !== null);
}
