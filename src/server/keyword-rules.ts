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
import { isUniqueViolation, prisma, serializableTx } from '@/lib/db';
import { accountLabel } from '@/lib/engine/account/display-name';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import {
  KEYWORD_RULE_PRIORITY,
  MIN_KEYWORD_LENGTH,
  encodeKeywordGroups,
  encodeKeywords,
  keywordGroupsMatch,
  longestKeywordLength,
  parseKeywordGroups,
  storedKeywordGroups,
} from '@/lib/engine/categorize/keyword-rule';
import { parseDollarInput } from '@/lib/money';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { auditLog, requireUserId } from '@/server/authz';
import { assertOwnedCategory } from '@/server/category-meta';
import { ensureCategories } from '@/server/ensure-categories';

export interface KeywordRulePreview {
  /**
   * The parsed OR-groups (O.13c), echoed back so the UI renders the chips it will
   * actually store. One inner array per group; a single-group key is `[[...]]`.
   */
  groups: string[][];
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
function matchableWhere(userId: string, accountId?: string | null) {
  return {
    isSplitParent: false,
    splitParentId: null,
    isTransfer: false,
    reviewPinned: false,
    // O.13c account condition: when the rule is scoped to one account, the
    // preview and the write both narrow to it HERE — one shared scope, so the
    // count shown is still exactly the population written.
    ...(accountId ? { accountId } : {}),
    account: {
      userId,
      type: { in: [...SPENDING_ACCOUNT_TYPES] },
      OR: [{ currency: null }, { currency: 'USD' }],
    },
  };
}

/**
 * The full IF-side of a rule, shared verbatim by preview, create, and update
 * (O.13c). `groups` are the parsed OR-groups; the optional conditions mirror the
 * columns `CategorizationRule` has carried since Phase 2 (`accountId`,
 * `minAmountCents`/`maxAmountCents` on ABSOLUTE value — the same magnitude
 * semantics `ruleMatches` uses), finally exposed to the builder.
 */
export interface KeywordRuleConditions {
  groups: string[][];
  accountId: string | null;
  minAmountCents: number | null;
  maxAmountCents: number | null;
}

/** Does one matchable row satisfy the amount band? Absolute value, like `ruleMatches`. */
function amountInBand(
  amountCents: number,
  minAmountCents: number | null,
  maxAmountCents: number | null,
): boolean {
  const magnitude = Math.abs(amountCents);
  if (minAmountCents !== null && magnitude < minAmountCents) return false;
  if (maxAmountCents !== null && magnitude > maxAmountCents) return false;
  return true;
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

async function matchableHistory(
  userId: string,
  client: FindManyClient,
  accountId?: string | null,
): Promise<MatchRow[]> {
  return client.transaction.findMany({
    where: matchableWhere(userId, accountId),
    select: MATCH_SELECT,
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
  });
}

async function matchingRows(
  userId: string,
  conditions: KeywordRuleConditions,
  client: FindManyClient = prisma,
): Promise<MatchRow[]> {
  if (conditions.groups.length === 0) return [];
  const rows = await matchableHistory(userId, client, conditions.accountId);
  return rows.filter(
    (r) =>
      keywordGroupsMatch(conditions.groups, r.rawDescriptor) &&
      amountInBand(r.amountCents, conditions.minAmountCents, conditions.maxAmountCents),
  );
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

function assertUsableKey(groups: readonly (readonly string[])[]): void {
  // Note the WORDING: an empty key matches nothing (keywordsMatch refuses it). The
  // danger is structural — a keyword rule carries no merchantId, and a null
  // merchantCanonical means "any merchant" — so without the refusal it would be a
  // rule with no conditions at all. The earlier message told the reader an empty
  // rule "would match every transaction", which is the RATIONALE, not the behaviour
  // (critic P1: the engine's own docblock says the opposite in capitals).
  if (groups.length === 0) {
    throw new Error('Enter at least one word for the rule to match on.');
  }
  // The length floor is PER GROUP (O.13c): each OR-group can match on its own, so
  // one weak group ("or: at") would re-open exactly the hole the floor closes.
  for (const g of groups) {
    if (longestKeywordLength(g) < MIN_KEYWORD_LENGTH) {
      throw new Error(
        `Use at least ${MIN_KEYWORD_LENGTH} letters in one word of every "or" line — a shorter one matches most of your transactions.`,
      );
    }
  }
}

/** Longest payee name a rename may store — same order as the register renders. */
const MAX_RENAME_LEN = 60;

/**
 * Normalize the optional rename-payee action: trimmed, length-capped, null when
 * blank. The name is the reader's own text and is stored verbatim otherwise — it
 * becomes a Merchant canonical, exactly like a normalizer-derived one.
 */
function normalizeRenameTo(renameTo: string | null | undefined): string | null {
  const trimmed = (renameTo ?? '').trim();
  if (trimmed === '') return null;
  if (trimmed.length > MAX_RENAME_LEN) {
    throw new Error(`Keep the payee name under ${MAX_RENAME_LEN} characters.`);
  }
  return trimmed;
}

/**
 * Parse + validate the optional IF-side conditions from raw form values. Amounts
 * arrive as the user typed them ("$25", "1,000"); `parseDollarInput` is the same
 * lenient boundary parser every other money form uses. Stored as ABSOLUTE cents
 * (magnitude), matching `ruleMatches`.
 */
async function resolveConditions(
  userId: string,
  input: { keywordsRaw: string; accountId?: string | null; minAmountRaw?: string; maxAmountRaw?: string },
): Promise<KeywordRuleConditions> {
  const groups = parseKeywordGroups(input.keywordsRaw);
  let accountId: string | null = null;
  if (input.accountId) {
    // Ownership check — a foreign account id must never scope a rule (same
    // userId-in-the-WHERE discipline every sibling action uses).
    const account = await prisma.account.findFirst({
      where: { id: input.accountId, userId },
      select: { id: true },
    });
    if (!account) throw new Error('That account wasn’t found — refresh and try again.');
    accountId = account.id;
  }
  const parseAmount = (raw: string | undefined, label: string): number | null => {
    const trimmed = (raw ?? '').trim();
    if (trimmed === '') return null;
    const parsed = parseDollarInput(trimmed);
    if (parsed === null || parsed < 0) {
      throw new Error(`Enter the ${label} amount as a positive dollar figure, like 25 or 12.50.`);
    }
    return parsed;
  };
  const minAmountCents = parseAmount(input.minAmountRaw, 'minimum');
  const maxAmountCents = parseAmount(input.maxAmountRaw, 'maximum');
  if (minAmountCents !== null && maxAmountCents !== null && minAmountCents > maxAmountCents) {
    throw new Error('The minimum amount is larger than the maximum — swap them.');
  }
  return { groups, accountId, minAmountCents, maxAmountCents };
}

/**
 * The two keyword columns a typed rule writes (critic cycle 1, P0+P1).
 *
 * `matchKeywords` keeps the pure-AND meaning it has always had and carries the
 * rule's FIRST group, so every row in that column — old or new — is a truthful
 * AND key, and it remains the discriminator for "this is a typed keyword rule"
 * (`NOT: { matchKeywords: null }`, used by the list, the edit, and the delete).
 * `matchKeywordGroups` carries the full OR encoding and is what the engine reads.
 *
 * The OR groups were NOT encoded into the existing column, because `|` was an
 * ordinary character inside a keyword under the old parser: re-reading those
 * bytes with a `|`-aware parser silently widens a stored AND rule into an OR (see
 * `decodeKeywords`). Writing the first group into the old column also fixes the
 * failure DIRECTION if the new column were ever null: the rule narrows to one
 * group rather than widening.
 */
function keywordColumns(groups: readonly string[][]): {
  matchKeywords: string;
  matchKeywordGroups: string;
} {
  return {
    matchKeywords: encodeKeywords(groups[0] ?? []),
    matchKeywordGroups: encodeKeywordGroups(groups),
  };
}

/**
 * What would this key match? Read-only, over the SAME scope the write uses.
 */
export async function previewKeywordRule(input: {
  keywordsRaw: string;
  categoryId?: string;
  accountId?: string | null;
  minAmountRaw?: string;
  maxAmountRaw?: string;
}): Promise<KeywordRulePreview> {
  const userId = await requireUserId();
  const conditions = await resolveConditions(userId, input);
  const history = await matchableHistory(userId, prisma, conditions.accountId);
  const rows =
    conditions.groups.length === 0
      ? []
      : history.filter(
          (r) =>
            keywordGroupsMatch(conditions.groups, r.rawDescriptor) &&
            amountInBand(r.amountCents, conditions.minAmountCents, conditions.maxAmountCents),
        );
  const target = input.categoryId;
  const known = target !== undefined && CATEGORY_BY_ID.has(target);
  const wrongSign = known ? rows.filter((r) => signWouldErase(target!, r.amountCents)) : [];
  const alreadyCorrect = rows.filter((r) => filedCategory(r.categoryId) === target);
  return {
    groups: conditions.groups,
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
  /** The parsed OR-groups the rule stored (O.13c). */
  groups: string[][];
  /** Rows re-filed now (0 when the reader declined to touch history). */
  affected: number;
  /** One per re-filed row, so the whole action is undoable like every other filing. */
  correctionIds: string[];
  /** Outflows left alone because filing them as income would erase them. */
  skippedWrongSign: number;
  /** Rows whose payee was renamed now (0 when no rename or the reader declined). */
  renamed: number;
  /** The stored THEN action + conditions, echoed for the client's optimistic list. */
  renameTo: string | null;
  accountId: string | null;
  minAmountCents: number | null;
  maxAmountCents: number | null;
}

/**
 * The one apply-to-history writer, shared by create and update (O.13c). Runs
 * INSIDE `serializableTx` for the DECISIONS #146 reason the create documented:
 * the matched set must be read in the same transaction that writes it.
 *
 * Two writes, deliberately different in weight:
 *  - CATEGORY refile — exactly the O.13a behavior: Correction per row (undoable),
 *    sign-eroding rows skipped, undo lineage on the first correction.
 *  - PAYEE RENAME — applied to every matched row the SIGN GUARD also allows, so
 *    the two paths that can rename agree (critic cycle 1, P1-3). `rawDescriptor`
 *    is untouched: the bank's text remains the permanent record and the match key.
 *
 * `claimLineage` is the create/update difference and it is not cosmetic (critic
 * cycle 1, P1-1). `undoCorrections` deletes the rule whose `createdFrom` still
 * points at the correction being undone — right for a rule the correction MINTED,
 * catastrophic for a rule that merely got edited, because undoing the edit's
 * re-apply would delete a rule the reader only meant to change. So only the create
 * path claims lineage; an edit's re-apply is undoable as a filing and leaves the
 * rule alone, which is the same stance `deleteKeywordRule` documents.
 */
async function applyRuleToHistory(
  userId: string,
  rule: { id: string; categoryId: string; renameTo: string | null },
  conditions: KeywordRuleConditions,
  opts: { claimLineage: boolean },
): Promise<{ ids: string[]; wrongSign: number; renamed: number }> {
  return serializableTx(async (tx) => {
    const targets = await matchingRows(userId, conditions, tx);
    const eligible = targets.filter((t) => filedCategory(t.categoryId) !== rule.categoryId);
    const toRefile = eligible.filter((t) => !signWouldErase(rule.categoryId, t.amountCents));
    const wrongSign = eligible.length - toRefile.length;
    // The SAME guard the refile uses, for the same reason one level up (critic
    // cycle 1, P1-3). A rename is not just a label: `merchantId` is the batch key
    // `similarTransactionsWhere` uses, and `recategorize({scope:'merchant'})` re-files
    // ALREADY-FILED rows in that batch. Renaming a wrong-signed outflow into an
    // income payee's group therefore builds a mixed-sign group in which one later
    // "file all similar" turns three real deposits into spend — the exact erasure
    // the sign guard exists to prevent, arriving by a different door. It also made
    // the two rename paths contradict each other: `categorize` renames only a rule
    // that actually FILED (pipeline.ts), so the same row would be named one way on
    // backfill and another way on the next sync.
    const toRename = targets.filter((t) => !signWouldErase(rule.categoryId, t.amountCents));

    const ids: string[] = [];
    for (const t of toRefile) {
      const c = await tx.correction.create({
        data: {
          userId,
          transactionId: t.id,
          fromCategoryId: t.categoryId,
          toCategoryId: rule.categoryId,
        },
      });
      ids.push(c.id);
    }
    if (ids.length > 0) {
      await tx.transaction.updateMany({
        // The read predicate is re-asserted here, not just the ids, so a row that
        // moved out of scope underneath us is skipped rather than overwritten.
        where: { id: { in: toRefile.map((t) => t.id) }, ...matchableWhere(userId, conditions.accountId) },
        data: { categoryId: rule.categoryId, needsReview: false, confidenceBps: 9900 },
      });
      await tx.categoryPrediction.updateMany({
        where: { transactionId: { in: toRefile.map((t) => t.id) }, userId },
        data: { actualCategoryId: rule.categoryId, labeledAt: new Date() },
      });
      // Undo lineage — see the createKeywordRule docblock. Only the FIRST
      // correction owns the rule, the shape `undoCorrections` knows how to unwind,
      // and only on the CREATE path (see `claimLineage` above).
      if (opts.claimLineage) {
        await tx.correction.update({ where: { id: ids[0] }, data: { becameRuleId: rule.id } });
        await tx.categorizationRule.update({ where: { id: rule.id }, data: { createdFrom: ids[0] } });
      }
    }

    let renamed = 0;
    if (rule.renameTo !== null && toRename.length > 0) {
      // Same upsert shape the ingest writers use (plaid.ts / simplefin.ts): the
      // Merchant table is keyed by canonical, and a renamed payee is a canonical
      // the reader named rather than one the normalizer derived.
      //
      // The unique index on `canonical` is GLOBAL, so a concurrent insert of the
      // same name (this reader's own in-flight sync, or another reader's) surfaces
      // a UNIQUE violation rather than the serialization failure `serializableTx`
      // retries — the class `isUniqueViolation` already exists for at the ingest
      // sites (critic cycle 1, P2-7). Losing the whole re-file to a name that now
      // exists would be absurd, so read the winner and carry on.
      let merchant: { id: string };
      try {
        merchant = await tx.merchant.upsert({
          where: { canonical: rule.renameTo },
          create: { canonical: rule.renameTo, defaultCategoryId: rule.categoryId },
          update: {},
        });
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        const existing = await tx.merchant.findUnique({
          where: { canonical: rule.renameTo },
          select: { id: true },
        });
        if (!existing) throw e;
        merchant = existing;
      }
      const res = await tx.transaction.updateMany({
        where: {
          id: { in: toRename.map((t) => t.id) },
          // Rows already carrying this payee are excluded, so the count the toast
          // reports is rows CHANGED, not rows matched — a repeat apply of an
          // unchanged rule must not claim it renamed 12 payees (critic P2-9).
          //
          // Spelled as an explicit OR, not `NOT: { merchantId }`: in SQL's
          // three-valued logic `NOT (merchantId = 'x')` is UNKNOWN when the column
          // is NULL, so the unnamed rows — the majority, and the whole point of a
          // rename — were silently excluded and every rename reported 0. Caught by
          // this slice's own count lock.
          OR: [{ merchantId: null }, { merchantId: { not: merchant.id } }],
          ...matchableWhere(userId, conditions.accountId),
        },
        data: { merchantId: merchant.id },
      });
      renamed = res.count;
    }
    return { ids, wrongSign, renamed };
  });
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
export interface KeywordRuleInput {
  keywordsRaw: string;
  categoryId: string;
  /** Optional THEN action: rename the payee on matched rows (O.13c). Blank = none. */
  renameTo?: string | null;
  /** Optional IF condition: only rows on this account (O.13c). Falsy = any account. */
  accountId?: string | null;
  /** Optional IF condition: minimum absolute amount, as typed ("$25"). Blank = none. */
  minAmountRaw?: string;
  /** Optional IF condition: maximum absolute amount, as typed. Blank = none. */
  maxAmountRaw?: string;
  applyToExisting?: boolean;
}

export async function createKeywordRule(input: KeywordRuleInput): Promise<CreateKeywordRuleResult> {
  const userId = await requireUserId();
  // SHARED-DEMO FENCE. `loadExplicitUserRules` returns [] for the demo row, so a
  // rule created here could never file anything while the UI promised it would —
  // and `listKeywordRules` would render one anonymous visitor's typed words (a
  // payee, an employer, a person) to the next (#210/#226 class, and the seed never
  // re-runs against a database with real users, so a leak would be permanent).
  if (isDemoUser(userId)) throw new Error(DEMO_ENTRY_BLOCKED);
  await assertOwnedCategory(userId, input.categoryId);
  assertTargetable(input.categoryId);
  const conditions = await resolveConditions(userId, input);
  assertUsableKey(conditions.groups);
  const renameTo = normalizeRenameTo(input.renameTo);
  // Both writes reference Category rows by id (#65) — the same guard
  // `applyCategory` and `fileMerchantGroup` run for exactly this reason.
  await ensureCategories();

  const rule = await prisma.categorizationRule.create({
    data: {
      userId,
      categoryId: input.categoryId,
      priority: KEYWORD_RULE_PRIORITY,
      ...keywordColumns(conditions.groups),
      renameTo,
      accountId: conditions.accountId,
      minAmountCents: conditions.minAmountCents,
      maxAmountCents: conditions.maxAmountCents,
    },
  });
  await auditLog(userId, 'rule.create', {
    ruleId: rule.id,
    categoryId: input.categoryId,
    // COUNTS, never the reader's text (a keyword or payee name can be a person).
    keywordCount: conditions.groups.reduce((n, g) => n + g.length, 0),
    groupCount: conditions.groups.length,
    hasRename: renameTo !== null,
  });

  let affected = 0;
  let skippedWrongSign = 0;
  let renamed = 0;
  const correctionIds: string[] = [];
  if (input.applyToExisting) {
    // Re-read INSIDE the transaction (applyRuleToHistory) — DECISIONS #146: a
    // concurrent commit must not produce a Correction stamped with a
    // `fromCategoryId` the row never had.
    const written = await applyRuleToHistory(
      userId,
      { id: rule.id, categoryId: input.categoryId, renameTo },
      conditions,
      // The rule was minted by THIS action, so its undo may delete it.
      { claimLineage: true },
    );
    correctionIds.push(...written.ids);
    affected = written.ids.length;
    skippedWrongSign = written.wrongSign;
    renamed = written.renamed;
    if (affected > 0 || renamed > 0) {
      await auditLog(userId, 'rule.batch-apply', {
        ruleId: rule.id,
        categoryId: input.categoryId,
        affected,
        renamed,
      });
    }
  }

  // '/rules' renders the list this write just changed and is where the reader is
  // standing; omitting it served him the pre-write payload.
  revalidatePath('/rules');
  revalidatePath('/transactions');
  revalidatePath('/triage');
  return {
    ruleId: rule.id,
    groups: conditions.groups,
    affected,
    correctionIds,
    skippedWrongSign,
    renamed,
    renameTo,
    accountId: conditions.accountId,
    minAmountCents: conditions.minAmountCents,
    maxAmountCents: conditions.maxAmountCents,
  };
}

export interface UpdateKeywordRuleResult extends CreateKeywordRuleResult {
  updated: boolean;
}

/**
 * Edit a typed rule in place (O.13c — Simplifi lets a rule be edited; O.13a only
 * offered delete-and-retype, which silently dropped the rule's undo lineage).
 * Ownership is asserted by userId + keyword-key shape in the WHERE, the same
 * discipline `deleteKeywordRule` uses; a merchant-keyed or learned rule can never
 * be edited through this door. Optionally re-applies to history through the SAME
 * writer the create uses — one basis, no drift.
 */
export async function updateKeywordRule(
  ruleId: string,
  input: KeywordRuleInput,
): Promise<UpdateKeywordRuleResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) throw new Error(DEMO_ENTRY_BLOCKED);
  const existing = await prisma.categorizationRule.findFirst({
    where: { id: ruleId, userId, NOT: { matchKeywords: null } },
    select: { id: true },
  });
  if (!existing) throw new Error('That rule wasn’t found — refresh and try again.');
  await assertOwnedCategory(userId, input.categoryId);
  assertTargetable(input.categoryId);
  const conditions = await resolveConditions(userId, input);
  assertUsableKey(conditions.groups);
  const renameTo = normalizeRenameTo(input.renameTo);
  await ensureCategories();

  await prisma.categorizationRule.update({
    where: { id: existing.id },
    data: {
      categoryId: input.categoryId,
      ...keywordColumns(conditions.groups),
      renameTo,
      accountId: conditions.accountId,
      minAmountCents: conditions.minAmountCents,
      maxAmountCents: conditions.maxAmountCents,
    },
  });
  await auditLog(userId, 'rule.update', {
    ruleId: existing.id,
    categoryId: input.categoryId,
    keywordCount: conditions.groups.reduce((n, g) => n + g.length, 0),
    groupCount: conditions.groups.length,
    hasRename: renameTo !== null,
  });

  let affected = 0;
  let skippedWrongSign = 0;
  let renamed = 0;
  const correctionIds: string[] = [];
  if (input.applyToExisting) {
    const written = await applyRuleToHistory(
      userId,
      { id: existing.id, categoryId: input.categoryId, renameTo },
      conditions,
      // The rule PRE-EXISTED this edit, so undoing the re-apply must put the
      // transactions back WITHOUT deleting a rule the reader only changed (P1-1).
      { claimLineage: false },
    );
    correctionIds.push(...written.ids);
    affected = written.ids.length;
    skippedWrongSign = written.wrongSign;
    renamed = written.renamed;
    if (affected > 0 || renamed > 0) {
      await auditLog(userId, 'rule.batch-apply', {
        ruleId: existing.id,
        categoryId: input.categoryId,
        affected,
        renamed,
      });
    }
  }

  revalidatePath('/rules');
  revalidatePath('/transactions');
  revalidatePath('/triage');
  return {
    ruleId: existing.id,
    groups: conditions.groups,
    affected,
    correctionIds,
    skippedWrongSign,
    renamed,
    renameTo,
    accountId: conditions.accountId,
    minAmountCents: conditions.minAmountCents,
    maxAmountCents: conditions.maxAmountCents,
    updated: true,
  };
}

export interface StoredKeywordRule {
  id: string;
  /** OR-groups (O.13c): the rule matches when any one group's words all appear. */
  groups: string[][];
  categoryId: string;
  renameTo: string | null;
  accountId: string | null;
  minAmountCents: number | null;
  maxAmountCents: number | null;
}

/** The reader's typed rules, for a list he can see, edit, and delete. */
export async function listKeywordRules(): Promise<StoredKeywordRule[]> {
  const userId = await requireUserId();
  // Same fence as creation: the shared demo row must never render one anonymous
  // visitor's typed words to the next.
  if (isDemoUser(userId)) return [];
  const rows = await prisma.categorizationRule.findMany({
    where: { userId, NOT: { matchKeywords: null } },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      matchKeywords: true,
      matchKeywordGroups: true,
      categoryId: true,
      renameTo: true,
      accountId: true,
      minAmountCents: true,
      maxAmountCents: true,
    },
  });
  return rows
    .map((r) => ({
      id: r.id,
      // The SAME decoder the engine loader uses (`server/rules.ts`), so the list
      // cannot show a key the engine would not execute — including the pre-O.13c
      // AND meaning and the read-path length floor.
      groups: storedKeywordGroups(r),
      categoryId: r.categoryId,
      renameTo: r.renameTo,
      accountId: r.accountId,
      minAmountCents: r.minAmountCents,
      maxAmountCents: r.maxAmountCents,
    }))
    // A row whose stored key decodes to nothing is refused by `toRuleLikes` and files
    // nothing, so listing it would render "contains → Category" with no chips.
    .filter((r) => r.groups.length > 0);
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

/**
 * The transaction a rule is being written FROM (TASKS O.13b).
 *
 * Owner: *"Having to remember which transaction and how to populate them exactly
 * as written is too cumbersome."* The builder had no prefill of any kind, and the
 * register renders the app's cleaned-up merchant name rather than the bank's
 * text — so the only string a rule can match against was on no screen he could
 * reach. This read is what makes `/rules?from=<id>` possible.
 *
 * Scoped by `account.userId`, like every other read here: a transaction id from
 * another account resolves to `null` and the page falls back to the blank
 * builder, never to someone else's descriptor.
 *
 * `excludedReason` is NOT a refusal. The row is still shown and the key is still
 * prefilled — but when the clicked row lives outside the population a rule may
 * write (`matchableWhere`), the preview will legitimately report a count that
 * does not include it, and a reader who is not told why has been handed a
 * contradiction. Naming the reason is the honest version of the same fact.
 */
export interface RuleSourceTransaction {
  id: string;
  rawDescriptor: string;
  merchantName: string | null;
  categoryId: string | null;
  date: string;
  amountCents: number;
  accountName: string;
  excludedReason: string | null;
}

export async function getRuleSourceTransaction(
  transactionId: string,
): Promise<RuleSourceTransaction | null> {
  const userId = await requireUserId();
  const t = await prisma.transaction.findFirst({
    where: { id: transactionId, account: { userId } },
    select: {
      id: true,
      rawDescriptor: true,
      categoryId: true,
      date: true,
      amountCents: true,
      isSplitParent: true,
      splitParentId: true,
      isTransfer: true,
      reviewPinned: true,
      merchant: { select: { canonical: true } },
      account: { select: { name: true, displayName: true, type: true, currency: true } },
    },
  });
  if (!t) return null;

  // Mirrors `matchableWhere` field for field — if that scope changes, this
  // sentence has to change with it, which is why they sit in the same file.
  const excludedReason = t.isSplitParent
    ? 'This row was split, so a rule files the pieces rather than this container.'
    : t.splitParentId !== null
      ? 'This is one piece of a split you made by hand, and a rule never overwrites those.'
      : t.isTransfer
        ? 'This looks like a transfer between two of your own accounts, which a rule does not re-file.'
        : t.reviewPinned
          ? 'This row is pinned for review, so a rule leaves it for you to decide.'
          : !SPENDING_ACCOUNT_TYPES.includes(
                t.account.type as (typeof SPENDING_ACCOUNT_TYPES)[number],
              )
            ? 'Rules apply to your spending accounts, and this row is on another kind of account.'
            : t.account.currency !== null && t.account.currency !== 'USD'
              ? 'Rules apply to your US dollar accounts.'
              : null;

  return {
    id: t.id,
    rawDescriptor: t.rawDescriptor,
    merchantName: t.merchant?.canonical ?? null,
    categoryId: t.categoryId,
    date: t.date,
    amountCents: t.amountCents,
    accountName: accountLabel(t.account),
    excludedReason,
  };
}
