'use server';

/**
 * Typed keyword rules — server layer (TASKS O.13a).
 *
 * The owner asked for the one thing this app has never had: a match key HE
 * writes. `keyword-rule.ts` owns the semantics; this module owns persistence,
 * ownership checks, and the PREVIEW.
 *
 * WHY THE PREVIEW MATTERS MORE THAN THE CREATE. A rule files money without
 * asking again, so the reader has to see what it will touch BEFORE it exists —
 * Simplifi's "you'll handle existing transactions next", except we show the count
 * first. And the preview must be computed by the SAME predicate the rule itself
 * will use, or it is a different question wearing the same words
 * (docs/lessons/one-question-one-basis-and-the-invariant-sets-the-scope.md): the
 * count comes from `keywordsMatch` over the reader's own rows, exactly as
 * `ruleMatches` will evaluate it at ingest. That is also why the matching happens
 * in JS rather than SQL — `contains` is case-sensitive on Postgres and Prisma's
 * `mode: 'insensitive'` does not exist on the SQLite client this repo also
 * generates, so a SQL predicate would be a THIRD basis that agrees with neither.
 *
 * Scale note: this loads the user's descriptors (id + text + category), which is
 * the same order of rows the register already reads for one page of history.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import {
  KEYWORD_RULE_PRIORITY,
  encodeKeywords,
  keywordsMatch,
  parseKeywords,
} from '@/lib/engine/categorize/keyword-rule';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import { auditLog, requireUserId } from '@/server/authz';
import { assertOwnedCategory } from '@/server/category-meta';

export interface KeywordRulePreview {
  /** The parsed key, echoed back so the UI renders the chips it will actually store. */
  keywords: string[];
  /** Rows whose statement text carries every keyword. */
  matchCount: number;
  /** Of those, how many are still unfiled — the ones a rule would newly answer. */
  unfiledCount: number;
  /** Of those, how many already carry a DIFFERENT category — an overwrite warning. */
  alreadyFiledElsewhereCount: number;
  /** A few real descriptors, so the reader judges the key against his own text. */
  samples: { rawDescriptor: string; amountCents: number; date: string; categoryId: string }[];
  /**
   * Matched rows whose SIGN disagrees with the chosen category — an outflow about
   * to be filed as income, or an inflow as spending. An explicit rule the reader
   * typed is deliberate, so this does not refuse anything; but filing an outflow
   * as income inflates income everywhere money is summed, and that is the one
   * mistake here the reader cannot see afterwards. Null when the category's group
   * is unknown (a custom category), because a warning we cannot justify is worse
   * than none.
   */
  signMismatchCount: number | null;
  /** Inflows / outflows in the matched set, so the split is visible at a glance. */
  inflowCount: number;
  outflowCount: number;
}

/**
 * `Transaction.categoryId` is NULLABLE and an unfiled row can be either null or
 * the literal 'uncategorized' — the register's own ladder call site normalizes it
 * exactly this way (`server/transactions.ts`), so the preview must too or its
 * counts describe a different set than the rule does.
 */
function filedCategory(categoryId: string | null): string {
  return categoryId ?? 'uncategorized';
}

/**
 * Does this row's sign contradict the category it is about to be filed as? Same
 * question `propose.ts`'s #44 guard asks, asked here as a WARNING rather than a
 * refusal, because a typed rule is the reader's deliberate instruction.
 */
function signDisagrees(categoryId: string, amountCents: number): boolean {
  const cat = CATEGORY_BY_ID.get(categoryId);
  if (!cat) return false; // custom category — group unknown, so no claim is made
  if (cat.group === 'Income') return amountCents < 0;
  if (categoryId === 'transfer') return false;
  return amountCents > 0;
}

async function matchingRows(userId: string, keywords: readonly string[]) {
  if (keywords.length === 0) return [];
  const rows = await prisma.transaction.findMany({
    where: { account: { userId } },
    select: { id: true, rawDescriptor: true, amountCents: true, date: true, categoryId: true },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
  });
  return rows.filter((r) => keywordsMatch(keywords, r.rawDescriptor));
}

/**
 * What would this key match? Read-only, so it is safe to call on every keystroke
 * the UI debounces.
 */
export async function previewKeywordRule(input: {
  keywordsRaw: string;
  categoryId?: string;
}): Promise<KeywordRulePreview> {
  const userId = await requireUserId();
  const keywords = parseKeywords(input.keywordsRaw);
  const rows = await matchingRows(userId, keywords);
  const unfiled = rows.filter((r) => filedCategory(r.categoryId) === 'uncategorized');
  return {
    keywords,
    matchCount: rows.length,
    unfiledCount: unfiled.length,
    alreadyFiledElsewhereCount: rows.filter(
      (r) =>
        filedCategory(r.categoryId) !== 'uncategorized' &&
        filedCategory(r.categoryId) !== input.categoryId,
    ).length,
    signMismatchCount:
      input.categoryId === undefined || !CATEGORY_BY_ID.has(input.categoryId)
        ? null
        : rows.filter((r) => signDisagrees(input.categoryId!, r.amountCents)).length,
    inflowCount: rows.filter((r) => r.amountCents > 0).length,
    outflowCount: rows.filter((r) => r.amountCents < 0).length,
    samples: rows.slice(0, 5).map((r) => ({
      rawDescriptor: r.rawDescriptor,
      amountCents: r.amountCents,
      date: r.date,
      categoryId: filedCategory(r.categoryId),
    })),
  };
}

export interface CreateKeywordRuleResult {
  ruleId: string;
  keywords: string[];
  /** Rows re-filed now (0 when the reader declined to touch history). */
  affected: number;
  /** One per re-filed row, so the whole action is undoable like every other filing. */
  correctionIds: string[];
}

/**
 * Store the rule, and optionally apply it to the history it matches.
 *
 * `applyToExisting` defaults to FALSE deliberately: creating a rule is a
 * statement about the future, and silently rewriting months of already-filed
 * categories is a different, much larger action. The reader opts into it with the
 * count in front of him.
 */
export async function createKeywordRule(input: {
  keywordsRaw: string;
  categoryId: string;
  applyToExisting?: boolean;
}): Promise<CreateKeywordRuleResult> {
  const userId = await requireUserId();
  await assertOwnedCategory(userId, input.categoryId); // system id, or a custom this user owns
  const keywords = parseKeywords(input.keywordsRaw);
  // An empty key would carry no merchantId either, and `merchantCanonical: null`
  // means "ANY merchant" — i.e. a rule that files everything. Refused here as well
  // as in the engine and the mapper: this is the one mistake in the feature whose
  // blast radius is the entire account.
  if (keywords.length === 0) {
    throw new Error('Enter at least one keyword — an empty rule would match every transaction.');
  }

  const rule = await prisma.categorizationRule.create({
    data: {
      userId,
      categoryId: input.categoryId,
      priority: KEYWORD_RULE_PRIORITY,
      matchKeywords: encodeKeywords(keywords),
    },
  });
  await auditLog(userId, 'rule.create', {
    ruleId: rule.id,
    categoryId: input.categoryId,
    keywordCount: keywords.length, // the COUNT, never the reader's text
  });

  let affected = 0;
  const correctionIds: string[] = [];
  if (input.applyToExisting) {
    const targets = await matchingRows(userId, keywords);
    const toRefile = targets.filter((t) => filedCategory(t.categoryId) !== input.categoryId);
    if (toRefile.length > 0) {
      // Same shape as `applyToAllSimilar`: one Correction per row (undo restores
      // each), the rows updated, and prediction ground truth stamped.
      const ids = await prisma.$transaction(async (tx) => {
        const out: string[] = [];
        for (const t of toRefile) {
          const c = await tx.correction.create({
            data: {
              userId,
              transactionId: t.id,
              fromCategoryId: t.categoryId,
              toCategoryId: input.categoryId,
            },
          });
          out.push(c.id);
        }
        await tx.transaction.updateMany({
          where: { id: { in: toRefile.map((t) => t.id) } },
          data: { categoryId: input.categoryId, needsReview: false, confidenceBps: 9900, reviewPinned: false },
        });
        await tx.categoryPrediction.updateMany({
          where: { transactionId: { in: toRefile.map((t) => t.id) }, userId },
          data: { actualCategoryId: input.categoryId, labeledAt: new Date() },
        });
        return out;
      });
      correctionIds.push(...ids);
      affected = toRefile.length;
      await auditLog(userId, 'rule.batch-apply', {
        ruleId: rule.id,
        categoryId: input.categoryId,
        affected,
      });
    }
  }

  // '/rules' is where the reader IS when this runs, and it renders the list this
  // write just changed. Omitting it left the page serving its pre-write payload:
  // "Rule saved, and 2 transactions filed" printed directly above "You haven't
  // written any rules yet" — caught by the e2e, invisible to every unit test,
  // because a stale render is a fact about the router cache and not about the
  // engine (docs/lessons/count-the-state-not-the-writers.md, one level over).
  revalidatePath('/rules');
  revalidatePath('/transactions');
  revalidatePath('/triage');
  return { ruleId: rule.id, keywords, affected, correctionIds };
}

export interface StoredKeywordRule {
  id: string;
  keywords: string[];
  categoryId: string;
}

/** The reader's typed rules, for a list he can see and delete (O.13d's seed). */
export async function listKeywordRules(): Promise<StoredKeywordRule[]> {
  const userId = await requireUserId();
  const rows = await prisma.categorizationRule.findMany({
    where: { userId, NOT: { matchKeywords: null } },
    orderBy: { id: 'asc' },
    select: { id: true, matchKeywords: true, categoryId: true },
  });
  return rows.map((r) => ({
    id: r.id,
    keywords: parseKeywords(r.matchKeywords ?? ''),
    categoryId: r.categoryId,
  }));
}

/**
 * Delete a typed rule. Scoped by userId in the WHERE (never a fetch-then-delete),
 * and it deliberately does NOT revert the filings the rule caused — those are
 * Corrections with their own undo, and silently re-uncategorizing months of rows
 * because a rule was removed is the destructive reading of "delete this rule".
 */
export async function deleteKeywordRule(ruleId: string): Promise<{ deleted: boolean }> {
  const userId = await requireUserId();
  const res = await prisma.categorizationRule.deleteMany({
    where: { id: ruleId, userId, NOT: { matchKeywords: null } },
  });
  if (res.count > 0) await auditLog(userId, 'rule.delete', { ruleId });
  revalidatePath('/rules');
  revalidatePath('/transactions');
  revalidatePath('/triage');
  return { deleted: res.count > 0 };
}
