/**
 * User-rule loader (cycle-1 fix C2): the bridge that was missing between the
 * stored CategorizationRule rows (keyed by merchantId) and the pure
 * pipeline's RuleLike (keyed by canonical merchant name). Without this, rules
 * created by "Always" were write-only.
 */
import { prisma } from '@/lib/db';
import { deriveLearnedRules, type LearnedCorrectionInput } from '@/lib/engine/categorize/learn';
import { toRuleLikes, type RuleRow } from '@/lib/engine/categorize/rule-mapping';
import { isDemoUser } from '@/lib/demo-user';
import type { RuleLike } from '@/lib/engine/categorize/pipeline';

/**
 * The mapper itself moved into the engine in O.15 slice 3 (see
 * `lib/engine/categorize/rule-mapping.ts`) so the /rules inventory can name WHY a
 * stored rule files nothing without re-deriving the refusal. Re-exported here
 * because this module has been its import site since cycle 1, and the behaviour is
 * unchanged.
 */
export { toRuleLike, toRuleLikes, type RuleRow } from '@/lib/engine/categorize/rule-mapping';

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
  const { rules, canonicalById } = await loadStoredRuleRows(userId);
  return rules.flatMap((r) => toRuleLikes(r, canonicalById));
}

/**
 * The stored rows + the merchant-name lookup the mapper needs — ONE query, shared
 * by the engine loader above and by the /rules inventory (O.15 slice 3).
 *
 * Sharing it is the point of the slice, not a tidy-up. Before it, the page's list
 * ran its OWN narrower query (`NOT: { matchKeywords: null }`) than the engine, so a
 * rule minted by "Always" filed money on a page that showed a strict subset of what
 * ran — and the delete action was scoped to that same subset, so those rules could
 * not be removed from any surface. Two queries, two answers to "what are my rules".
 *
 * NOT demo-fenced here: this returns raw rows, and each caller states its own
 * reason (the engine loader fences because one visitor's rule must not steer the
 * next visitor's verdict; the inventory fences because it would RENDER one
 * visitor's typed words to the next). A fence that lives only in a shared helper
 * reads as "handled" at call sites that may need a different answer.
 */
export async function loadStoredRuleRows(userId: string): Promise<{
  rules: RuleRowWithMerchant[];
  canonicalById: ReadonlyMap<string, string>;
}> {
  const rules = await prisma.categorizationRule.findMany({ where: { userId } });
  const merchantIds = [...new Set(rules.map((r) => r.merchantId).filter((x): x is string => !!x))];
  const merchants = merchantIds.length
    ? await prisma.merchant.findMany({ where: { id: { in: merchantIds } } })
    : [];
  const canonicalById = new Map(merchants.map((m) => [m.id, m.canonical]));
  return { rules, canonicalById };
}

/** A stored row as Prisma returns it (every RuleRow field, plus provenance). */
export type RuleRowWithMerchant = RuleRow & { createdFrom: string | null };

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
