/**
 * User-rule loader (cycle-1 fix C2): the bridge that was missing between the
 * stored CategorizationRule rows (keyed by merchantId) and the pure
 * pipeline's RuleLike (keyed by canonical merchant name). Without this, rules
 * created by "Always" were write-only.
 */
import { prisma } from '@/lib/db';
import { decodeKeywords } from '@/lib/engine/categorize/keyword-rule';
import { deriveLearnedRules, type LearnedCorrectionInput } from '@/lib/engine/categorize/learn';
import { isAggregateCanonical } from '@/lib/engine/categorize/normalize';
import { isDemoUser } from '@/lib/demo-user';
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
  /** Space-joined typed keywords (O.13a). Null on every pre-O.13a row. */
  matchKeywords?: string | null;
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
  // A TYPED key (O.13a). Two things are deliberate here and both are the opposite
  // of how a DERIVED key is treated:
  //
  //  - it may target an aggregate. `isAggregateCanonical` above refuses a
  //    merchant-keyed rule on Venmo/Zelle/checks because the normalizer INFERRED
  //    that identity and one canonical hides many payees. A keyword the reader typed
  //    is not an inference — he named it, he can see it in the rule list, and he can
  //    delete it — which is the same asymmetry that licenses propose.ts to use
  //    evidence learn.ts refuses. A keyword rule carries no merchantId, so it never
  //    reaches that guard, and that is correct rather than an oversight.
  //  - a DECLARED but EMPTY key matches nothing. `merchantCanonical: null` means
  //    "ANY merchant" (see the orphan case above), so a rule that announced a
  //    keyword key and has none left would file every transaction in the app. Same
  //    trap as the orphan, same answer: refuse the row.
  const declaresKeywordKey = rule.matchKeywords != null;
  const keywords = decodeKeywords(rule.matchKeywords);
  if (declaresKeywordKey && keywords.length === 0) return null;
  return {
    id: rule.id,
    merchantCanonical,
    matchKeywords: declaresKeywordKey ? keywords : null,
    minAmountCents: rule.minAmountCents,
    maxAmountCents: rule.maxAmountCents,
    weekendOnly: rule.weekendOnly,
    weekdayOnly: rule.weekdayOnly,
    accountId: rule.accountId,
    categoryId: rule.categoryId,
    priority: rule.priority,
  };
}

/** The user's EXPLICIT stored rules ("Always" / register merchant-scope). */
export async function loadExplicitUserRules(userId: string): Promise<RuleLike[]> {
  // SHARED-DEMO FENCE (O.9d critic F4, same class as loadCorrectionInputs below):
  // every anonymous visitor is the same `user-demo` row, so a rule one visitor
  // mints with "Always" would steer the pipeline verdict — and now the register's
  // one-tap suggestion chip — shown to the NEXT visitor. The demo seed writes no
  // rules (it categorizes with rules=[]), so goldens are untouched; a demo
  // visitor's "Always" still re-files the rows it matched at creation time, the
  // rule just never speaks again on a later read.
  if (isDemoUser(userId)) return [];
  const rules = await prisma.categorizationRule.findMany({ where: { userId } });
  const merchantIds = [...new Set(rules.map((r) => r.merchantId).filter((x): x is string => !!x))];
  const merchants = merchantIds.length
    ? await prisma.merchant.findMany({ where: { id: { in: merchantIds } } })
    : [];
  const canonicalById = new Map(merchants.map((m) => [m.id, m.canonical]));
  return rules.map((r) => toRuleLike(r, canonicalById)).filter((r): r is RuleLike => r !== null);
}

/**
 * Flat correction history for the pure learner / triage hints (DECISIONS #161,
 * #207). Shared by `loadLearnedRules` and triage `suggestAlternatives`.
 * Demo seed (zero corrections) returns [] — goldens stay byte-identical.
 */
export async function loadCorrectionInputs(userId: string): Promise<LearnedCorrectionInput[]> {
  // SHARED-DEMO FENCE (#331, applying the #226/#243 lesson). The one-click demo is
  // credential-free, so every anonymous visitor signs in as the SAME row. Everything
  // downstream of this loader — learned rules, personalized triage hints, and now
  // category PROPOSALS — turns one visitor's filing decisions into something the NEXT
  // visitor is shown, and the proposal states it in the first person ("You filed 2
  // earlier payments to J. PARK as Dining"), which is both a false sentence about that
  // reader and a disclosure of a stranger's choices.
  //
  // This is the one read every correction-derived feature goes through, so fencing it
  // here fences all three by construction rather than at three call sites that must
  // each be remembered. The demo SEED writes no corrections, so every golden value is
  // byte-identical; a demo visitor's own correction still files the row they clicked,
  // it just never becomes evidence about another row.
  if (isDemoUser(userId)) return [];
  const corrections = await prisma.correction.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { transactionId: true, toCategoryId: true, undoesId: true },
  });
  if (corrections.length === 0) return [];
  const txnIds = [...new Set(corrections.map((c) => c.transactionId))];
  const txns = await prisma.transaction.findMany({
    where: { id: { in: txnIds }, account: { userId } },
    select: { id: true, rawDescriptor: true, amountCents: true },
  });
  const txnById = new Map(txns.map((t) => [t.id, t]));
  const inputs: LearnedCorrectionInput[] = [];
  corrections.forEach((c, i) => {
    const t = txnById.get(c.transactionId);
    if (!t) return; // transaction deleted or not owned — skip
    inputs.push({
      transactionId: c.transactionId,
      toCategoryId: c.toCategoryId,
      isUndo: c.undoesId != null,
      seq: i,
      rawDescriptor: t.rawDescriptor,
      amountCents: t.amountCents,
    });
  });
  return inputs;
}

/**
 * Synthetic LEARNED rules derived from the user's correction history
 * (DECISIONS #161). The pure learner (engine/categorize/learn.ts) owns every
 * threshold + guard; this loader just joins each Correction to its transaction
 * and hands over flat rows.
 */
export async function loadLearnedRules(userId: string): Promise<RuleLike[]> {
  return deriveLearnedRules(await loadCorrectionInputs(userId));
}

/**
 * Every categorize read-path (ingest ×4, backfill, triage suggestions) loads
 * rules through here, so appending learned rules teaches all of them at once.
 * Explicit rules come first and outrank learned ones (priority 100 > 50).
 */
export async function loadUserRules(userId: string): Promise<RuleLike[]> {
  const [explicit, learned] = await Promise.all([
    loadExplicitUserRules(userId),
    loadLearnedRules(userId),
  ]);
  return [...explicit, ...learned];
}
