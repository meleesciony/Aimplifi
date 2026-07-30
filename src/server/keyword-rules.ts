'use server';

/**
 * Typed keyword rules — server layer (TASKS O.13a).
 *
 * The owner asked for the one thing this app has never had: a match key HE
 * writes. `keyword-rule.ts` owns the semantics; this module owns persistence,
 * ownership checks, and the PREVIEW.
 *
 * WHY THE PREVIEW MATTERS MORE THAN THE CREATE. A rule files money without asking
 * again, so the reader must see what it will touch BEFORE it exists. The preview
 * and the write therefore share ONE scope (`matchableWhere` + `matchingRows`) —
 * there is no second definition to drift from.
 *
 * THE SCOPE IS NOT "EVERY ROW THE USER OWNS", and the first version of this file
 * made exactly that mistake (critic P0, reproduced): with no exclusions, one click
 * re-filed a pair-flagged TRANSFER, a split PARENT, both of a purchase's split
 * CHILDREN — collapsing an allocation the reader made by hand, which is the only
 * record of it — a row he had review-PINNED, and rows on INVESTMENT and non-USD
 * accounts that no register page will ever show him. Every sibling writer carries
 * these exclusions (`similarTransactionsWhere`, `fileMerchantGroup`,
 * `runBackfillForUser`); this one now shares their shape, so the count the reader
 * is shown is also the population the register displays.
 *
 * Matching runs in JS rather than SQL because `contains` is case-sensitive on
 * Postgres while Prisma's `mode: 'insensitive'` does not exist on the SQLite
 * client this repo also generates — a SQL predicate would be a THIRD basis
 * agreeing with neither.
 *
 * Scale note, stated correctly this time: this reads every matchable row of the
 * reader's history, unpaginated. The register's own query is also unpaginated (it
 * slices in memory), so the volume is the same order — but the earlier docblock
 * claimed this was "one page of history", which was false and was the stated
 * reason for not bounding it (critic P2).
 */
import { revalidatePath } from 'next/cache';
import { prisma, serializableTx } from '@/lib/db';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import {
  KEYWORD_RULE_PRIORITY,
  MIN_KEYWORD_LENGTH,
  encodeKeywords,
  keywordsMatch,
  longestKeywordLength,
  parseKeywords,
} from '@/lib/engine/categorize/keyword-rule';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { auditLog, requireUserId } from '@/server/authz';
import { assertOwnedCategory } from '@/server/category-meta';
import { ensureCategories } from '@/server/ensure-categories';

export interface KeywordRulePreview {
  /** The parsed key, echoed back so the UI renders the chips it will actually store. */
  keywords: string[];
  /** Rows whose statement text carries every keyword, within the matchable scope. */
  matchCount: number;
  /** Of those, how many are still unfiled — the ones a rule would newly answer. */
  unfiledCount: number;
  /** Of those, how many already carry a DIFFERENT category — an overwrite warning. */
  alreadyFiledElsewhereCount: number;
  /** How many rows the apply would actually write (excludes already-correct and wrong-sign). */
  wouldFileCount: number;
  /** A few real descriptors, so the reader judges the key against his own text. */
  samples: { rawDescriptor: string; amountCents: number; date: string; categoryId: string }[];
  /**
   * Recent raw statement texts, shown ONLY when the key matches nothing. The
   * register displays the app's cleaned-up merchant NAME, not the bank's text — so
   * a reader told to "check the spelling" had no surface showing the string a rule
   * matches against, and this session's own brand work widened that gap ("MACYS
   * LENOX SQUARE" now displays as "Macy's", which never matches as typed; critic
   * P1, 4 of 6 executed cases). Until the transaction detail view (O.13b) renders
   * the raw text everywhere, a zero-match preview hands him real examples to copy.
   */
  recentDescriptors: string[];
  /**
   * Matched OUTFLOWS that would be filed into an Income category — money that
   * disappears from every spending total (`isSpendRow` drops Income-group rows)
   * while the flows engine still counts it as an expense: two surfaces disagreeing
   * by that amount. These rows are EXCLUDED from the apply set, not merely warned
   * about, and the pipeline refuses them for future rows too.
   *
   * The inflow direction is deliberately NOT counted. A positive row in a spend
   * category is the app's documented refund convention (`pipeline.ts`: "the INFLOW
   * direction is deliberately NOT guarded … returns offset spend"), so the first
   * version's symmetric warning was FALSE — a reader obeying it inflated both his
   * income and his spending (critic P1, reproduced: savings rate went to −100%).
   */
  signMismatchCount: number | null;
  /** Inflows / outflows in the matched set, so the split is visible at a glance. */
  inflowCount: number;
  outflowCount: number;
}

/**
 * `Transaction.categoryId` is NULLABLE and an unfiled row can be either null or
 * the literal 'uncategorized' — the register's own ladder call site normalizes it
 * exactly this way (`server/transactions.ts`), so the preview must too.
 */
function filedCategory(categoryId: string | null): string {
  return categoryId ?? 'uncategorized';
}

/**
 * The one scope shared by the preview and the write. Every clause is a sibling's
 * clause rather than a new opinion:
 *  - `isSplitParent: false` — a container whose categoryId is intentionally null;
 *  - `splitParentId: null` — a split CHILD carries the parent's rawDescriptor, so a
 *    keyword rule would otherwise collapse a hand-made allocation into one
 *    category, and that allocation is the only record of the reader's intent;
 *  - `isTransfer: false` — a transfer is the transfer pass's call, never a category
 *    rule's (#165). `categorize` also returns 'transfer' BEFORE rules are
 *    consulted, so counting these rows would promise filings the pipeline refuses;
 *  - `reviewPinned: false` — "a dissolve-PINNED row is the user's to decide, never
 *    the system's" (`backfill.ts`), and the apply used to clear that flag with no
 *    way to restore it;
 *  - spending account types + USD/null currency — the population the register and
 *    the inbox actually render (DECISIONS #135).
 */
function matchableWhere(userId: string) {
  return {
    isSplitParent: false,
    splitParentId: null,
    isTransfer: false,
    reviewPinned: false,
    account: {
      userId,
      type: { in: [...SPENDING_ACCOUNT_TYPES] },
      OR: [{ currency: null }, { currency: 'USD' }],
    },
  };
}

type MatchRow = {
  id: string;
  rawDescriptor: string;
  amountCents: number;
  date: string;
  categoryId: string | null;
};

const MATCH_SELECT = {
  id: true,
  rawDescriptor: true,
  amountCents: true,
  date: true,
  categoryId: true,
} as const;

type FindManyClient = { transaction: { findMany: typeof prisma.transaction.findMany } };

async function matchableHistory(userId: string, client: FindManyClient): Promise<MatchRow[]> {
  return client.transaction.findMany({
    where: matchableWhere(userId),
    select: MATCH_SELECT,
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
  });
}

async function matchingRows(
  userId: string,
  keywords: readonly string[],
  client: FindManyClient = prisma,
): Promise<MatchRow[]> {
  if (keywords.length === 0) return [];
  const rows = await matchableHistory(userId, client);
  return rows.filter((r) => keywordsMatch(keywords, r.rawDescriptor));
}

/**
 * Would filing this row as `categoryId` erase it from every spending total? True
 * only for an OUTFLOW into an Income-group category — see `signMismatchCount`.
 * Unknown group (a custom category) makes no claim.
 */
function signWouldErase(categoryId: string, amountCents: number): boolean {
  const cat = CATEGORY_BY_ID.get(categoryId);
  if (!cat) return false;
  return cat.group === 'Income' && amountCents < 0;
}

/** Category ids a durable rule may never target, each for a stated reason. */
function assertTargetable(categoryId: string): void {
  // 'transfer' without `isTransfer` drops the row from every spending sum while the
  // flows engine still counts it — the erasure `isUsableProviderHint` refuses by
  // name ("mislabeling spend as a transfer silently erases it"). Transfers are
  // detected from the pair of accounts by tested code, never asserted by a rule.
  if (categoryId === 'transfer') {
    throw new Error(
      'Transfers are detected from the two accounts involved, not from a rule — pick a spending or income category instead.',
    );
  }
  // A durable rule to the placeholder files rows as decided-but-uncategorized:
  // invisible to the inbox forever.
  if (categoryId === 'uncategorized') {
    throw new Error('Choose a real category — "uncategorized" is the state a rule exists to resolve.');
  }
}

function assertUsableKey(keywords: readonly string[]): void {
  // Note the WORDING: an empty key matches nothing (keywordsMatch refuses it). The
  // danger is structural — a keyword rule carries no merchantId, and a null
  // merchantCanonical means "any merchant" — so without the refusal it would be a
  // rule with no conditions at all. The earlier message told the reader an empty
  // rule "would match every transaction", which is the RATIONALE, not the behaviour
  // (critic P1: the engine's own docblock says the opposite in capitals).
  if (keywords.length === 0) {
    throw new Error('Enter at least one word for the rule to match on.');
  }
  if (longestKeywordLength(keywords) < MIN_KEYWORD_LENGTH) {
    throw new Error(
      `Use at least ${MIN_KEYWORD_LENGTH} letters in one of your words — a shorter one matches most of your transactions.`,
    );
  }
}

/**
 * What would this key match? Read-only, over the SAME scope the write uses.
 */
export async function previewKeywordRule(input: {
  keywordsRaw: string;
  categoryId?: string;
}): Promise<KeywordRulePreview> {
  const userId = await requireUserId();
  const keywords = parseKeywords(input.keywordsRaw);
  const history = await matchableHistory(userId, prisma);
  const rows = keywords.length === 0 ? [] : history.filter((r) => keywordsMatch(keywords, r.rawDescriptor));
  const target = input.categoryId;
  const known = target !== undefined && CATEGORY_BY_ID.has(target);
  const wrongSign = known ? rows.filter((r) => signWouldErase(target!, r.amountCents)) : [];
  const alreadyCorrect = rows.filter((r) => filedCategory(r.categoryId) === target);
  return {
    keywords,
    matchCount: rows.length,
    unfiledCount: rows.filter((r) => filedCategory(r.categoryId) === 'uncategorized').length,
    alreadyFiledElsewhereCount: rows.filter(
      (r) => filedCategory(r.categoryId) !== 'uncategorized' && filedCategory(r.categoryId) !== target,
    ).length,
    wouldFileCount: rows.length - alreadyCorrect.length - wrongSign.length,
    signMismatchCount: known ? wrongSign.length : null,
    inflowCount: rows.filter((r) => r.amountCents > 0).length,
    outflowCount: rows.filter((r) => r.amountCents < 0).length,
    samples: rows.slice(0, 5).map((r) => ({
      rawDescriptor: r.rawDescriptor,
      amountCents: r.amountCents,
      date: r.date,
      categoryId: filedCategory(r.categoryId),
    })),
    // Only when nothing matched — otherwise the samples above already show the text.
    recentDescriptors: rows.length === 0 ? [...new Set(history.map((r) => r.rawDescriptor))].slice(0, 6) : [],
  };
}

export interface CreateKeywordRuleResult {
  ruleId: string;
  keywords: string[];
  /** Rows re-filed now (0 when the reader declined to touch history). */
  affected: number;
  /** One per re-filed row, so the whole action is undoable like every other filing. */
  correctionIds: string[];
  /** Outflows left alone because filing them as income would erase them. */
  skippedWrongSign: number;
}

/**
 * Store the rule, and optionally apply it to the history it matches.
 *
 * `applyToExisting` defaults to FALSE: creating a rule is a statement about the
 * future, and rewriting months of already-filed categories is a larger action the
 * reader opts into with the count in front of him. (The first UI shipped that
 * checkbox defaulted ON, contradicting this paragraph — critic P1.)
 *
 * UNDO LINEAGE. The first correction carries `becameRuleId` and the rule carries
 * `createdFrom` pointing back at it, which is what lets the EXISTING
 * `undoCorrections` path delete the rule when the reader reverts. Without that
 * pairing the rule survived its own undo and the next backfill silently re-filed
 * every row he had just reverted — a loop he could not escape (critic P1,
 * reproduced: 5 rows reverted, all 5 re-filed by one backfill).
 */
export async function createKeywordRule(input: {
  keywordsRaw: string;
  categoryId: string;
  applyToExisting?: boolean;
}): Promise<CreateKeywordRuleResult> {
  const userId = await requireUserId();
  // SHARED-DEMO FENCE. `loadExplicitUserRules` returns [] for the demo row, so a
  // rule created here could never file anything while the UI promised it would —
  // and `listKeywordRules` would render one anonymous visitor's typed words (a
  // payee, an employer, a person) to the next (#210/#226 class, and the seed never
  // re-runs against a database with real users, so a leak would be permanent).
  if (isDemoUser(userId)) throw new Error(DEMO_ENTRY_BLOCKED);
  await assertOwnedCategory(userId, input.categoryId);
  assertTargetable(input.categoryId);
  const keywords = parseKeywords(input.keywordsRaw);
  assertUsableKey(keywords);
  // Both writes reference Category rows by id (#65) — the same guard
  // `applyCategory` and `fileMerchantGroup` run for exactly this reason.
  await ensureCategories();

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
  let skippedWrongSign = 0;
  const correctionIds: string[] = [];
  if (input.applyToExisting) {
    const written = await serializableTx(async (tx) => {
      // Re-read INSIDE the transaction. The set was previously read outside it, so a
      // concurrent commit (a second tab, a household partner, a sync) produced a
      // Correction stamped with a `fromCategoryId` the row never had — and the undo
      // the UI promises would then restore the wrong category (the DECISIONS #146
      // class `db.ts` provides `serializableTx` for).
      const targets = await matchingRows(userId, keywords, tx);
      const eligible = targets.filter((t) => filedCategory(t.categoryId) !== input.categoryId);
      const toRefile = eligible.filter((t) => !signWouldErase(input.categoryId, t.amountCents));
      const wrongSign = eligible.length - toRefile.length;

      const ids: string[] = [];
      for (const t of toRefile) {
        const c = await tx.correction.create({
          data: {
            userId,
            transactionId: t.id,
            fromCategoryId: t.categoryId,
            toCategoryId: input.categoryId,
          },
        });
        ids.push(c.id);
      }
      if (ids.length > 0) {
        await tx.transaction.updateMany({
          // The read predicate is re-asserted here, not just the ids, so a row that
          // moved out of scope underneath us is skipped rather than overwritten.
          where: { id: { in: toRefile.map((t) => t.id) }, ...matchableWhere(userId) },
          data: { categoryId: input.categoryId, needsReview: false, confidenceBps: 9900 },
        });
        await tx.categoryPrediction.updateMany({
          where: { transactionId: { in: toRefile.map((t) => t.id) }, userId },
          data: { actualCategoryId: input.categoryId, labeledAt: new Date() },
        });
        // Undo lineage — see the docblock. Only the FIRST correction owns the rule,
        // which is the shape `undoCorrections` already knows how to unwind.
        await tx.correction.update({ where: { id: ids[0] }, data: { becameRuleId: rule.id } });
        await tx.categorizationRule.update({ where: { id: rule.id }, data: { createdFrom: ids[0] } });
      }
      return { ids, wrongSign };
    });
    correctionIds.push(...written.ids);
    affected = written.ids.length;
    skippedWrongSign = written.wrongSign;
    if (affected > 0) {
      await auditLog(userId, 'rule.batch-apply', {
        ruleId: rule.id,
        categoryId: input.categoryId,
        affected,
      });
    }
  }

  // '/rules' renders the list this write just changed and is where the reader is
  // standing; omitting it served him the pre-write payload.
  revalidatePath('/rules');
  revalidatePath('/transactions');
  revalidatePath('/triage');
  return { ruleId: rule.id, keywords, affected, correctionIds, skippedWrongSign };
}

export interface StoredKeywordRule {
  id: string;
  keywords: string[];
  categoryId: string;
}

/** The reader's typed rules, for a list he can see and delete. */
export async function listKeywordRules(): Promise<StoredKeywordRule[]> {
  const userId = await requireUserId();
  // Same fence as creation: the shared demo row must never render one anonymous
  // visitor's typed words to the next.
  if (isDemoUser(userId)) return [];
  const rows = await prisma.categorizationRule.findMany({
    where: { userId, NOT: { matchKeywords: null } },
    orderBy: { id: 'asc' },
    select: { id: true, matchKeywords: true, categoryId: true },
  });
  return rows
    .map((r) => ({
      id: r.id,
      keywords: parseKeywords(r.matchKeywords ?? ''),
      categoryId: r.categoryId,
    }))
    // A row whose stored key decodes to nothing is refused by `toRuleLike` and files
    // nothing, so listing it would render "contains → Category" with no chips.
    .filter((r) => r.keywords.length > 0);
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
