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
import {
  hasTag,
  normalizeSetTaxClass,
  resolveRuleTaxStamp,
} from '@/lib/engine/categorize/tax-action';
import {
  extraOccurrenceIds,
  guessRuleSpendClass,
  isSpendClassChoice,
  normalizeSetSpendClass,
  resolveRuleSpendClassStamp,
  type SpendClassChoice,
} from '@/lib/engine/categorize/spend-class-action';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { overrideKey } from '@/lib/engine/recurring/override';
import { guessSpendClass } from '@/lib/engine/spending-plan/spend-class';
import { isTaxClass } from '@/lib/engine/tax/classes';
import { parseDollarInput } from '@/lib/money';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { auditLog, requireUserId } from '@/server/authz';
import { assertOwnedCategory, getCategoryMeta } from '@/server/category-meta';
import { ensureCategories } from '@/server/ensure-categories';
import { getRecurringOutflowCadences } from '@/server/recurring-bill-merchants';
import { getReconciliationTxnKeep } from '@/server/reconciliation';

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
  /**
   * Matched rows the reader filed BY HAND into some other category — his outliers.
   * They are EXCLUDED from the apply set, not merely warned about (owner
   * 2026-07-30: *"occasionally we may change a single transaction (outlier) for a
   * diff category. Keep that intact."*), so this number exists to keep
   * `wouldFileCount` honest: it is part of `matchCount` and not part of what the
   * apply writes. `null` until a target category is chosen, because "some other
   * category" has no meaning before then.
   */
  handFiledCount: number | null;
  /**
   * Rows the tag-for-taxes action would newly tag (O.15 slice 6) — see `taxTagSets`
   * for the three populations it subtracts. `null` until BOTH a tax class and a
   * target category are chosen: the sign guard is part of the set, so a count shown
   * before a category exists is a promise the save would then reduce, and a tag
   * count is the number this feature is judged on.
   *
   * Counted separately from `wouldFileCount` because the two answer different
   * questions and their sets genuinely differ: a row already in the right category
   * is written by no re-file and still takes the tag.
   */
  wouldTagCount: number | null;
  /**
   * Matched rows that ALREADY carry a tax tag and are therefore left alone.
   * Reported rather than silently skipped, for the same reason `preservedHandFiled`
   * is: a reader who is told "12 rows match" and sees "tagged 9" has been handed a
   * contradiction unless the other 3 are named. It counts rows carrying ANY tag,
   * including this rule's own class — so the copy beside it may not imply those rows
   * are outside the class.
   */
  alreadyTaggedCount: number | null;
  /**
   * Algorithmic Fixed/Discretionary guess for the matched set (recurring → Fixed
   * seed). Null until there is at least one classifiable match. The builder
   * pre-selects this; the reader can override.
   */
  suggestedSpendClass: SpendClassChoice | null;
  /** Rows the spend-class action would stamp (baseline — extras abstain). */
  wouldStampSpendClassCount: number | null;
  /** Matched rows refused as extra occurrences in their billing period. */
  spendClassExtraCount: number | null;
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
 *  - `isSplitParent: false` — a container the children have taken the money from
 *    (it carries its own category since O.13b, but never any spending);
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
  accountId: string;
  categoryId: string | null;
  needsReview: boolean;
  taxClass: string | null;
  excludeFromTotals: boolean;
};

const MATCH_SELECT = {
  id: true,
  rawDescriptor: true,
  amountCents: true,
  date: true,
  accountId: true,
  categoryId: true,
  // Half of the hand-filed test — see `handFiledIds`.
  needsReview: true,
  // O.15 slice 6: the tag action never overwrites a tag that is already there, so
  // both the preview's count and the write's set have to be able to see one.
  taxClass: true,
  // …and it never bulk-tags a row the reader has taken OUT of his spending — see
  // `taxTagSets` for why that carve-out does not transfer from a hand tag to a rule.
  excludeFromTotals: true,
} as const;

type FindManyClient = {
  transaction: { findMany: typeof prisma.transaction.findMany };
  correction: { findMany: typeof prisma.correction.findMany };
};

/**
 * Rows the READER filed by hand, which an apply-to-history must leave alone.
 *
 * Owner, 2026-07-30: *"Rules are great but occasionally we may change a single
 * transaction (outlier) for a diff category. Keep that intact."*
 *
 * He was right that this was exposed. The sync path has always preserved a
 * hand-filed row — `simplefin.ts` computes `corrected && !fresh.needsReview` and
 * writes only bank facts when it holds — and `runBackfillForUser` never touches a
 * decided row at all (`OR: [needsReview, categoryId null, 'uncategorized']`). The
 * keyword-rule apply had NEITHER guard: it filtered only "already the target
 * category" and the sign check, so one tick of "apply to existing" overwrote every
 * outlier the reader had filed by hand, on a rule that is right about the other
 * ninety-nine rows.
 *
 * The predicate is COPIED from the sync path rather than invented, so a row that
 * survives a sync and a row that survives a backfill are the same row:
 *  - a `Correction` exists (a human decided this row at some point), AND
 *  - it is not back in review (`needsReview: false`) — a row the app has since
 *    re-opened is undecided again, and the rule may answer it.
 *
 * FUTURE rows are unaffected: the rule still files everything that arrives after
 * it, which is the half of "prior and forward" he asked for. This guard is only
 * about not un-deciding a decision he already made.
 */
async function handFiledIds(
  userId: string,
  rows: readonly MatchRow[],
  client: FindManyClient,
): Promise<Set<string>> {
  const decided = rows.filter((r) => !r.needsReview).map((r) => r.id);
  if (decided.length === 0) return new Set();
  const corrections = await client.correction.findMany({
    // `sourceRuleId: null` is the half that stops a rule confirming its OWN past
    // writes. Without it, the corrections an apply-to-history wrote read back as
    // the reader's hand decisions, so EDITING that rule re-filed nothing — caught
    // by the pre-existing O.13c edit lock, not by a new test. A correction with a
    // sourceRuleId was authored by a rule; only a human's is a hand decision.
    where: { userId, transactionId: { in: decided }, sourceRuleId: null },
    select: { transactionId: true },
  });
  return new Set(corrections.map((c) => c.transactionId));
}

async function matchableHistory(
  userId: string,
  client: FindManyClient,
  accountId?: string | null,
): Promise<MatchRow[]> {
  const [rows, keepsReconciled] = await Promise.all([
    client.transaction.findMany({
      where: matchableWhere(userId, accountId),
      select: MATCH_SELECT,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    }),
    // Reconciliation boundary (H.8): a combined connection's disowned duplicate
    // rows are in no register, no total, and no triage — but they passed
    // `matchableWhere`, so the preview counted them and the apply WROTE to them
    // (measured live: 1,124 of 2,456 matchable rows were invisible copies, so a
    // broad rule's "Matches N" was nearly double what any screen shows, and an
    // apply stamped categories on rows the reader could never see or undo from
    // the register). Filtering HERE keeps this file's core invariant for free:
    // preview and every write flow through this one function, so the number
    // shown is still exactly the population written. The windowed keep cannot be
    // expressed in the Prisma where-clause (it depends on each predecessor's
    // full-history span), hence the post-fetch filter — the same idiom as
    // triage/register. Safe to read outside `serializableTx`: links change only
    // on an explicit user confirm/undo. Race directions, stated exactly (H.8
    // critic P3): an UNDO mid-apply widens ownership, and the previously-disowned
    // rows are simply absent from this call's id set (they file on the next
    // apply); a CONFIRM mid-apply means a just-disowned row IS still written —
    // which is byte-identical to the pre-H.8 behavior for that row, not a new
    // wrong write, and requires the user to confirm a combine mid-click.
    getReconciliationTxnKeep(userId),
  ]);
  return rows.filter((r) => keepsReconciled(r.accountId, r.date));
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

/**
 * The tag-for-taxes action's row sets (O.15 slice 6) — ONE derivation, called by
 * the preview and by the write, because this file's core invariant is that the
 * number shown to the reader IS the population written.
 *
 * The eligible set is NOT the re-file set — a row already sitting in the rule's
 * category is written by no re-file at all, and it is exactly the row a reader
 * adding a tag action to an existing rule is trying to reach. It is the re-file
 * set plus those already-correct rows, and MINUS three populations:
 *
 *  - SIGN-REFUSED rows, for the reason the rename docblock gives one level up:
 *    `categorize` tags only a rule that actually FILED, so tagging a row the
 *    pipeline refuses would make the same row carry one answer from a backfill and
 *    a different one from the next sync.
 *  - HAND-FILED outliers. The first cut excluded them from the re-file and tagged
 *    them anyway, on the argument that their exclusion protects a CATEGORY and a
 *    tag is not a category. Two independent fresh-context critics falsified that
 *    the same way: the reader is shown "1 transaction you filed yourself was left
 *    as it was" about a row a rule had just written a DEDUCTION CLAIM onto. A
 *    Correction means "I decided this row", and of the two decisions the tag is the
 *    higher-stakes one. Excluding them also restores the invariant this feature
 *    states everywhere else — a rule tags only what it files or already agrees with.
 *  - EXCLUDED rows (`excludeFromTotals`). `engine/transactions/exclude.ts` records
 *    that the tax export deliberately still counts a row the reader both tagged AND
 *    excluded, because "a row given two orders" should not lose the deduction
 *    silently. That reasoning was written when the only way to get a `taxClass` was
 *    the reader typing it on that row. Here the reader gave exactly ONE order —
 *    "this is not my spending" — and a rule would supply the other, putting money he
 *    removed from every other total into a figure he may hand a preparer. He can
 *    still tag such a row by hand, which is the case the carve-out was written for.
 */
function taxTagSets(
  rows: readonly MatchRow[],
  categoryId: string | undefined,
  setTaxClass: string | null,
  handFiled: ReadonlySet<string>,
): { toTag: MatchRow[]; alreadyTagged: number } {
  if (!isTaxClass(setTaxClass)) return { toTag: [], alreadyTagged: 0 };
  const eligible = rows.filter(
    (r) =>
      !handFiled.has(r.id) &&
      !r.excludeFromTotals &&
      (categoryId === undefined || !signWouldErase(categoryId, r.amountCents)),
  );
  return {
    toTag: eligible.filter(
      (r) => resolveRuleTaxStamp({ ruleTaxClass: setTaxClass, currentTaxClass: r.taxClass }) !== null,
    ),
    alreadyTagged: eligible.filter((r) => hasTag(r.taxClass)).length,
  };
}

/**
 * The WHERE-clause half of the same invariant: a row may take the stamp only while
 * it is still untagged AND still counted. Spelled as an explicit OR rather than
 * `taxClass: null` because `hasTag` counts a blank string as untagged, and a
 * preview that counted a row the write then skipped would be the contradiction this
 * file exists to avoid. A function rather than a const so Prisma gets a mutable
 * array (its `OR` input type is not readonly).
 *
 * Callers compose it under `AND` rather than spreading it: it carries a TOP-LEVEL
 * `OR`, and today it only survives a spread beside `matchableWhere` because that
 * one's `OR` is nested inside `account`. The day anyone adds a top-level `OR`
 * there, a spread would drop this guard silently — which is the whole class of
 * failure it exists to prevent.
 */
function untaggedWhere() {
  return { OR: [{ taxClass: null }, { taxClass: '' }], excludeFromTotals: false };
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
  /** O.15 slice 6 — the tag-for-taxes action, so its counts preview like the rest. */
  setTaxClass?: string | null;
  /** Fixed/Discretionary THEN action — preview uses the same baseline/extra split as apply. */
  setSpendClass?: string | null;
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
  // The reader's hand-filed outliers, counted on exactly the basis the apply
  // excludes them on — this file's core invariant is that the number shown IS the
  // population written, so the preview cannot use a looser test than the write.
  const handFiled = await handFiledIds(userId, rows, prisma);
  const preserved = known
    ? rows.filter((r) => handFiled.has(r.id) && filedCategory(r.categoryId) !== target).length
    : null;
  // The write set, derived the same way `applyRuleToHistory` derives it — not by
  // subtracting three counts that could double-count a row failing two tests.
  const eligiblePreview = rows.filter(
    (r) => filedCategory(r.categoryId) !== target && !handFiled.has(r.id),
  );
  const wouldFile = known
    ? eligiblePreview.filter((r) => !signWouldErase(target!, r.amountCents)).length
    : rows.length - alreadyCorrect.length;
  // O.15 slice 6 — the same derivation the write runs, so the two counts cannot
  // drift. `known ? target : undefined` keeps the sign guard out of it until a real
  // category is chosen, exactly as `wouldFile` does above.
  const setTaxClass = normalizeSetTaxClass(input.setTaxClass);
  const tags = taxTagSets(rows, known ? target : undefined, setTaxClass, handFiled);
  // Suppressed until a category is chosen too: the sign guard is part of the set,
  // so counting before then would show a number the save reduces (critic P3).
  const tagCountsReady = setTaxClass !== null && known;

  const [meta, cadenceBy] = await Promise.all([
    getCategoryMeta(userId),
    getRecurringOutflowCadences(userId),
  ]);
  const fixedMerchants = new Set(cadenceBy.keys());
  // Guess as if the rule had already filed the target category (preview honesty).
  const classes = rows.map((r) =>
    guessSpendClass(
      {
        date: r.date,
        amountCents: r.amountCents,
        rawDescriptor: r.rawDescriptor,
        accountId: r.accountId,
        categoryId: known ? target! : filedCategory(r.categoryId),
        isTransfer: false,
        status: 'POSTED',
        isSplitParent: false,
        splitParentId: null,
        excludeFromTotals: r.excludeFromTotals,
        spendClassOverride: null,
      },
      meta,
      fixedMerchants,
    ),
  );
  const suggestedSpendClass =
    classes.some((c) => c === 'fixed' || c === 'guilt-free') ? guessRuleSpendClass(classes) : null;
  const setSpendClass = normalizeSetSpendClass(input.setSpendClass) ?? suggestedSpendClass;
  const occurrenceRows = rows
    .filter((r) => !handFiled.has(r.id) && (known ? !signWouldErase(target!, r.amountCents) : true))
    .map((r) => ({
      id: r.id,
      date: r.date,
      groupKey: overrideKey(normalizeMerchant(r.rawDescriptor).canonical),
    }));
  const extras = extraOccurrenceIds(occurrenceRows, cadenceBy);
  const spendReady = setSpendClass !== null && known;
  const wouldStamp = spendReady
    ? occurrenceRows.filter(
        (r) =>
          resolveRuleSpendClassStamp({
            ruleSpendClass: setSpendClass,
            isExtraOccurrence: extras.has(r.id),
          }) !== null,
      ).length
    : null;

  return {
    groups: conditions.groups,
    matchCount: rows.length,
    unfiledCount: rows.filter((r) => filedCategory(r.categoryId) === 'uncategorized').length,
    alreadyFiledElsewhereCount: rows.filter(
      (r) => filedCategory(r.categoryId) !== 'uncategorized' && filedCategory(r.categoryId) !== target,
    ).length,
    wouldFileCount: wouldFile,
    signMismatchCount: known ? wrongSign.length : null,
    handFiledCount: preserved,
    wouldTagCount: tagCountsReady ? tags.toTag.length : null,
    alreadyTaggedCount: tagCountsReady ? tags.alreadyTagged : null,
    suggestedSpendClass,
    wouldStampSpendClassCount: wouldStamp,
    spendClassExtraCount: spendReady ? extras.size : null,
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
  /**
   * Rows the reader had filed BY HAND into another category, left exactly as he
   * filed them (owner 2026-07-30). Reported rather than silently dropped: an
   * exclusion the reader is not told about is its own kind of surprise.
   */
  preservedHandFiled: number;
  /** Rows whose payee was renamed now (0 when no rename or the reader declined). */
  renamed: number;
  /**
   * Rows newly tagged for taxes (O.15 slice 6). Rows ACTUALLY written, read off the
   * update's own count — never the size of the intended set, so a row tagged by
   * hand inside the read→write window is not claimed.
   */
  taxTagged: number;
  /** Matched rows left alone because they already carried a tag. */
  taxAlreadyTagged: number;
  /** Baseline rows stamped Fixed/Discretionary (extras excluded). */
  spendClassStamped: number;
  /** Extra occurrences left with no override. */
  spendClassExtras: number;
  /** The stored THEN action + conditions, echoed for the client's optimistic list. */
  renameTo: string | null;
  setTaxClass: string | null;
  setSpendClass: string | null;
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
  rule: {
    id: string;
    categoryId: string;
    renameTo: string | null;
    setTaxClass: string | null;
    setSpendClass: string | null;
  },
  conditions: KeywordRuleConditions,
  opts: { claimLineage: boolean },
): Promise<{
  ids: string[];
  wrongSign: number;
  renamed: number;
  preserved: number;
  taxTagged: number;
  taxAlreadyTagged: number;
  spendClassStamped: number;
  spendClassExtras: number;
}> {
  return serializableTx(async (tx) => {
    const targets = await matchingRows(userId, conditions, tx);
    // The reader's own outliers, left exactly as he filed them (owner 2026-07-30).
    // Computed INSIDE the serializable transaction, on the same rows the write
    // uses, so a correction landing mid-apply cannot be missed by a read taken
    // earlier — the same reason `matchingRows` is called with `tx` here.
    const handFiled = await handFiledIds(userId, targets, tx);
    const eligible = targets.filter(
      (t) => filedCategory(t.categoryId) !== rule.categoryId && !handFiled.has(t.id),
    );
    const toRefile = eligible.filter((t) => !signWouldErase(rule.categoryId, t.amountCents));
    const wrongSign = eligible.length - toRefile.length;
    const preserved = targets.filter(
      (t) => handFiled.has(t.id) && filedCategory(t.categoryId) !== rule.categoryId,
    ).length;
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
          // Stamped so this write can never later be mistaken for the reader's own
          // outlier decision — see `handFiledIds`.
          sourceRuleId: rule.id,
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

    // TAG FOR TAXES (O.15 slice 6). Third and lightest of the three writes: it
    // creates no Correction, because a tag is not a category decision and the
    // undo path unwinds category decisions. What it is instead is REVERSIBLE BY
    // HAND on a control that already exists — the tax select on /transactions/[id]
    // — and it can only ever fill a blank, never change an answer. That pairing is
    // what makes a per-row undo unnecessary rather than merely absent, and the
    // residual is recorded in docs/STATUS.md rather than implied.
    const tags = taxTagSets(targets, rule.categoryId, rule.setTaxClass, handFiled);
    let taxTagged = 0;
    if (tags.toTag.length > 0 && isTaxClass(rule.setTaxClass)) {
      const res = await tx.transaction.updateMany({
        where: {
          id: { in: tags.toTag.map((t) => t.id) },
          // Re-asserted like the re-file's write, and for one more reason on top:
          // `untaggedWhere()` makes "never overwrite a tag, never tag an excluded
          // row" hold in SQL, so a tag or an exclusion the reader sets between this
          // transaction's read and its write survives even though the row was in
          // the intended set. Composed under AND — see that function's docblock.
          AND: [untaggedWhere(), matchableWhere(userId, conditions.accountId)],
        },
        data: { taxClass: rule.setTaxClass },
      });
      taxTagged = res.count;
    }

    // Fixed/Discretionary — stamp baseline matches; EXTRA OCCURRENCES take no
    // override (utilities vary in amount; a second charge in the month is the
    // outlier). Sign-refused and hand-filed rows are skipped like tax.
    let spendClassStamped = 0;
    let spendClassExtras = 0;
    if (isSpendClassChoice(rule.setSpendClass)) {
      const cadenceBy = await getRecurringOutflowCadences(userId);
      const stampCandidates = targets.filter(
        (t) => !handFiled.has(t.id) && !signWouldErase(rule.categoryId, t.amountCents),
      );
      const occurrenceRows = stampCandidates.map((t) => ({
        id: t.id,
        date: t.date,
        groupKey: overrideKey(normalizeMerchant(t.rawDescriptor).canonical),
      }));
      const extras = extraOccurrenceIds(occurrenceRows, cadenceBy);
      spendClassExtras = extras.size;
      const toStamp = stampCandidates.filter(
        (t) =>
          resolveRuleSpendClassStamp({
            ruleSpendClass: rule.setSpendClass,
            isExtraOccurrence: extras.has(t.id),
          }) !== null,
      );
      if (toStamp.length > 0) {
        const res = await tx.transaction.updateMany({
          where: {
            id: { in: toStamp.map((t) => t.id) },
            ...matchableWhere(userId, conditions.accountId),
          },
          data: { spendClassOverride: rule.setSpendClass },
        });
        spendClassStamped = res.count;
      }
    }

    return {
      ids,
      wrongSign,
      renamed,
      preserved,
      taxTagged,
      taxAlreadyTagged: tags.alreadyTagged,
      spendClassStamped,
      spendClassExtras,
    };
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
  /**
   * Optional THEN action: tag matched rows for taxes (O.15 slice 6). One of the
   * closed set in engine/tax/classes.ts; blank or unrecognized = no tag action.
   */
  setTaxClass?: string | null;
  /**
   * Optional THEN action: Fixed or Discretionary on matched baseline rows.
   * Blank = no spend-class action. Extra occurrences in a period take no override.
   */
  setSpendClass?: string | null;
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
  const setTaxClass = normalizeSetTaxClass(input.setTaxClass);
  const setSpendClass = normalizeSetSpendClass(input.setSpendClass);
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
      setTaxClass,
      setSpendClass,
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
    // The CLASS, never a count of rows: it is a closed-set slug, not the reader's text.
    taxClass: setTaxClass,
    spendClass: setSpendClass,
  });

  let affected = 0;
  let skippedWrongSign = 0;
  let preservedHandFiled = 0;
  let renamed = 0;
  let taxTagged = 0;
  let taxAlreadyTagged = 0;
  let spendClassStamped = 0;
  let spendClassExtras = 0;
  const correctionIds: string[] = [];
  if (input.applyToExisting) {
    // Re-read INSIDE the transaction (applyRuleToHistory) — DECISIONS #146: a
    // concurrent commit must not produce a Correction stamped with a
    // `fromCategoryId` the row never had.
    const written = await applyRuleToHistory(
      userId,
      { id: rule.id, categoryId: input.categoryId, renameTo, setTaxClass, setSpendClass },
      conditions,
      // The rule was minted by THIS action, so its undo may delete it.
      { claimLineage: true },
    );
    correctionIds.push(...written.ids);
    affected = written.ids.length;
    skippedWrongSign = written.wrongSign;
    preservedHandFiled = written.preserved;
    renamed = written.renamed;
    taxTagged = written.taxTagged;
    taxAlreadyTagged = written.taxAlreadyTagged;
    spendClassStamped = written.spendClassStamped;
    spendClassExtras = written.spendClassExtras;
    if (affected > 0 || renamed > 0 || taxTagged > 0 || spendClassStamped > 0) {
      await auditLog(userId, 'rule.batch-apply', {
        ruleId: rule.id,
        categoryId: input.categoryId,
        affected,
        renamed,
        taxTagged,
        spendClassStamped,
        spendClassExtras,
      });
    }
  }

  // '/rules' renders the list this write just changed and is where the reader is
  // standing; omitting it served him the pre-write payload.
  revalidatePath('/rules');
  revalidatePath('/transactions');
  revalidatePath('/triage');
  revalidatePath('/spending-plan');
  return {
    ruleId: rule.id,
    groups: conditions.groups,
    affected,
    correctionIds,
    skippedWrongSign,
    preservedHandFiled,
    renamed,
    taxTagged,
    taxAlreadyTagged,
    spendClassStamped,
    spendClassExtras,
    renameTo,
    setTaxClass,
    setSpendClass,
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
  const setTaxClass = normalizeSetTaxClass(input.setTaxClass);
  const setSpendClass = normalizeSetSpendClass(input.setSpendClass);
  await ensureCategories();

  await prisma.categorizationRule.update({
    where: { id: existing.id },
    data: {
      categoryId: input.categoryId,
      ...keywordColumns(conditions.groups),
      renameTo,
      setTaxClass,
      setSpendClass,
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
    // The CLASS, never a count of rows: it is a closed-set slug, not the reader's text.
    taxClass: setTaxClass,
    spendClass: setSpendClass,
  });

  let affected = 0;
  let skippedWrongSign = 0;
  let preservedHandFiled = 0;
  let renamed = 0;
  let taxTagged = 0;
  let taxAlreadyTagged = 0;
  let spendClassStamped = 0;
  let spendClassExtras = 0;
  const correctionIds: string[] = [];
  if (input.applyToExisting) {
    const written = await applyRuleToHistory(
      userId,
      { id: existing.id, categoryId: input.categoryId, renameTo, setTaxClass, setSpendClass },
      conditions,
      // The rule PRE-EXISTED this edit, so undoing the re-apply must put the
      // transactions back WITHOUT deleting a rule the reader only changed (P1-1).
      { claimLineage: false },
    );
    correctionIds.push(...written.ids);
    affected = written.ids.length;
    skippedWrongSign = written.wrongSign;
    preservedHandFiled = written.preserved;
    renamed = written.renamed;
    taxTagged = written.taxTagged;
    taxAlreadyTagged = written.taxAlreadyTagged;
    spendClassStamped = written.spendClassStamped;
    spendClassExtras = written.spendClassExtras;
    if (affected > 0 || renamed > 0 || taxTagged > 0 || spendClassStamped > 0) {
      await auditLog(userId, 'rule.batch-apply', {
        ruleId: existing.id,
        categoryId: input.categoryId,
        affected,
        renamed,
        taxTagged,
        spendClassStamped,
        spendClassExtras,
      });
    }
  }

  revalidatePath('/rules');
  revalidatePath('/transactions');
  revalidatePath('/triage');
  revalidatePath('/spending-plan');
  return {
    ruleId: existing.id,
    groups: conditions.groups,
    affected,
    correctionIds,
    skippedWrongSign,
    preservedHandFiled,
    renamed,
    taxTagged,
    taxAlreadyTagged,
    spendClassStamped,
    spendClassExtras,
    renameTo,
    setTaxClass,
    setSpendClass,
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
  /** Tag-for-taxes THEN action (O.15 slice 6). Null when the rule tags nothing. */
  setTaxClass: string | null;
  /** Fixed/Discretionary THEN action. Null when the rule sets no spend class. */
  setSpendClass: string | null;
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
      setTaxClass: true,
      setSpendClass: true,
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
      // Re-validated on the READ path, never trusted from the column: an
      // unrecognized slug must render as "no tag action" on the list for exactly
      // the same reason `resolveRuleTaxStamp` refuses to write one.
      setTaxClass: isTaxClass(r.setTaxClass) ? r.setTaxClass : null,
      setSpendClass: isSpendClassChoice(r.setSpendClass) ? r.setSpendClass : null,
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
      accountId: true,
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
  // Plus the H.8 reconciliation keep, which `matchableHistory` now applies
  // post-fetch: a disowned duplicate row is in no register, so the only door here
  // is a stale or hand-typed /rules?from= link — but a silent exclusion is still
  // a contradiction, so it gets its sentence like the rest.
  const keepsReconciled = await getReconciliationTxnKeep(userId);
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
              ? 'Rules apply to your U.S.-dollar accounts.'
              : !keepsReconciled(t.accountId, t.date)
                ? // Worded for BOTH disowned shapes (H.8 critic P3): the successor's
                  // duplicate copy AND a superseded predecessor's own post-cutover row,
                  // which may have no surviving copy at all — so the sentence claims
                  // absence from the register, never that a counted twin exists.
                  'This row is on a connection you combined, so it does not appear in your activity or totals — a rule cannot count or file it.'
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
