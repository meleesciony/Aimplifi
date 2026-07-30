/**
 * The rule INVENTORY (TASKS O.13d, shipped as O.15 slice 3) — the pure function
 * behind "show me every rule that files my money."
 *
 * THE DEFECT IT EXISTS FOR, measured before it was written. Two queries answered
 * "what are my rules" and they disagreed:
 *
 *   - the engine (`loadExplicitUserRules`) loads EVERY `CategorizationRule` row;
 *   - the /rules page listed only rows with a typed key (`NOT matchKeywords null`).
 *
 * So a rule minted by the inbox's "Always" button — merchant-keyed, priority 100,
 * no keywords — filed the reader's money for as long as the account existed while
 * appearing on no screen, and the delete action was scoped to that same narrow
 * subset, so it could not be removed from any surface either. The builder's empty
 * state said "You haven't written any rules yet" to a reader whose money was being
 * filed by rules he made. An authored rule the reader cannot see or delete is worse
 * than no rule: it accumulates.
 *
 * This module takes the rows the ENGINE loads and returns what the page renders, so
 * there is one set, not two. Everything it reports it reads from the shared mapper
 * (`rule-mapping.ts`) — including the refusals — because a page that decided for
 * itself which rules are live would be a second opinion about the reader's money.
 *
 * Pure: no database, no session, no clock.
 */
import { keywordSpecificity } from './keyword-rule';
import { mapStoredRule, type RuleRefusal, type RuleRow } from './rule-mapping';

export type { RuleRefusal };

/**
 * How the rule came to exist. Not cosmetic — it is the answer to "why is this
 * filing my money", and the two kinds are authored by different gestures:
 *  - `typed`: written on /rules, with words the reader chose (O.13a).
 *  - `always`: minted by tapping "Always" on a transaction, or by filing a whole
 *    merchant from the register — keyed to one payee identity the app derived.
 */
export type RuleOrigin = 'typed' | 'always';

export interface InventoryConditions {
  minAmountCents: number | null;
  maxAmountCents: number | null;
  weekendOnly: boolean | null;
  weekdayOnly: boolean | null;
  accountId: string | null;
}

export interface InventoryEntry {
  /** The stored row's id — what a delete acts on, and what `matchedRuleId` names. */
  id: string;
  origin: RuleOrigin;
  /** The payee this rule is pinned to, for an `always` rule. Null for a typed key. */
  merchantCanonical: string | null;
  /**
   * The payee a REFUSED rule points at, when one was resolvable (an aggregate like
   * Venmo). Null for an orphan, which has no name left, and for a typed rule, which
   * never had one. Display only — a refused rule matches nothing.
   */
  refusedCanonical: string | null;
  /**
   * True when the rule carries NO identity at all — no payee, no typed words — so
   * every transaction that clears its remaining conditions matches it.
   *
   * The engine runs such a row (`ruleMatches` skips both key checks when both are
   * null), and the page must therefore say so out loud. Naming it is the whole point:
   * described as "a payee that is no longer here", the broadest rule in the account
   * would read as the most harmless one. No creation path in the app produces this
   * shape today — the builder requires a key and "Always" requires a payee — so it is
   * displayed honestly rather than refused, because refusing it would change what the
   * categorizer does, which is not this slice's licence.
   */
  matchesEverything: boolean;
  /** OR-groups of typed words: the rule fires when all words in ANY group appear. */
  keywordGroups: string[][];
  categoryId: string;
  renameTo: string | null;
  conditions: InventoryConditions;
  priority: number;
  /**
   * Whether the engine currently runs this row at all. `false` is a REAL state of
   * rows already in the database (a deleted payee, an aggregate payee, a key that
   * decoded to nothing) which no screen could show before this slice — and which
   * no screen could delete either, because it was invisible.
   */
  active: boolean;
  /** Why the engine ignores it, when `active` is false. Null when it runs. */
  refusal: RuleRefusal | null;
}

/**
 * Build the inventory in a STABLE listing order — strongest-looking rule first,
 * inactive rules last.
 *
 * It borrows `pipeline.ts`'s keys (priority desc, then keyword specificity, then id)
 * because that is the most useful order to read a rule list in, but it is NOT a
 * prediction of which rule wins a given transaction and nothing here or on the page
 * says it is. The engine's answer depends on the transaction: the sign guards at
 * `pipeline.ts`'s `matching.find()` can skip the top-sorted rule entirely (a
 * `cardone -> Income` keyword rule is refused on an OUTFLOW, and a lower-priority
 * merchant rule then wins), and learned rules — which have no stored row and are not
 * listed here — sit in the same sorted set at match time. A list that promised the
 * winner would be wrong for exactly those rows (critic P3-6).
 *
 * The id tie-break is applied only between TYPED entries, mirroring the pipeline's
 * own restriction: merchant-keyed rules keep insertion order there because
 * `ensureUnconditionalRule`'s supersede logic is written against it. Equal-priority
 * merchant rules therefore keep the order the query returned, which for a stored-row
 * list is the order they were created in.
 *
 * Inactive rows sort last, whatever their priority: ranking a rule that never runs
 * among the ones that do would be a sentence about nothing.
 */
export function buildRuleInventory(
  rows: readonly RuleRow[],
  canonicalByMerchantId: ReadonlyMap<string, string>,
): InventoryEntry[] {
  // `sort` is stable in every runtime this app targets, so entries the comparator
  // calls equal keep the order `loadStoredRuleRows` returned them in.
  const entries = rows.map((row) => toEntry(row, canonicalByMerchantId));
  return entries.sort(compareEntries);
}

/**
 * THE PARTITION between the two lists /rules renders, in one place because a page
 * that shows a rule twice and a page that shows it zero times are the same bug with
 * different symptoms.
 *
 * The builder's own list has rendered the reader's ACTIVE TYPED rules since O.13a,
 * with edit and delete wired to the form beside it. This predicate names exactly
 * that set; its complement is everything that had no screen at all before O.15
 * slice 3 — every "Always" rule, and every rule the engine refuses (whose key
 * decoded to nothing, so the builder's list dropped it silently).
 *
 * Together they are the whole inventory, which is the whole set the engine runs. An
 * integration test asserts both halves of that against a real database rather than
 * trusting this comment.
 */
export function isBuilderListed(entry: InventoryEntry): boolean {
  // Derived from the SAME two conditions the builder's own query and filter apply —
  // a declared typed key (`matchKeywords != null`, which is `origin`) AND a key that
  // still decodes to words (`listKeywordRules`'s `.filter(groups.length > 0)`).
  //
  // Stated honestly, because a test cannot show it: this is EQUIVALENT to the
  // `active && origin === 'typed'` it replaced, over every entry `mapStoredRule` can
  // produce — an inactive typed rule always has an empty key and an active one never
  // does — so no fixture distinguishes them and none pretends to (cycle-2 F4). The
  // reason to write it this way is the next change: `active` also moves when a
  // MERCHANT refusal is added or removed, and the builder's list would not move with
  // it, which is how a row ends up rendered twice or not at all.
  return entry.origin === 'typed' && entry.keywordGroups.length > 0;
}

/** The complement: rules with no home before this slice. */
export function isInventoryListed(entry: InventoryEntry): boolean {
  return !isBuilderListed(entry);
}

function toEntry(row: RuleRow, canonicalByMerchantId: ReadonlyMap<string, string>): InventoryEntry {
  const mapped = mapStoredRule(row, canonicalByMerchantId);
  // The typed/always split reads the SAME discriminator the mapper and the engine
  // read (`matchKeywords != null` — a declared key, even one that decoded to
  // nothing), never the decoded words: a typed rule whose key is now empty is still
  // a rule the reader typed, and calling it an "Always" rule would misname the
  // gesture that made it.
  const origin: RuleOrigin = row.matchKeywords != null ? 'typed' : 'always';
  const conditions: InventoryConditions = {
    minAmountCents: row.minAmountCents,
    maxAmountCents: row.maxAmountCents,
    weekendOnly: row.weekendOnly,
    weekdayOnly: row.weekdayOnly,
    accountId: row.accountId,
  };
  if (!mapped.ok) {
    return {
      id: row.id,
      origin,
      // Never a MATCHING identity — the engine refused this row, and
      // `merchantCanonical` is the field the rest of the app matches on.
      merchantCanonical: null,
      // …but the name it points at, when there is one, travels separately so the
      // page can tell the reader WHICH rule to delete. Suppressing it produced a row
      // that called itself a missing payee directly above a sentence explaining it
      // was Venmo — two contradictory claims about one rule (critic P1-3).
      refusedCanonical: mapped.refusedCanonical,
      matchesEverything: false,
      keywordGroups: [],
      categoryId: row.categoryId,
      renameTo: row.renameTo ?? null,
      conditions,
      priority: row.priority,
      active: false,
      refusal: mapped.refusal,
    };
  }
  const first = mapped.likes[0];
  return {
    id: row.id,
    origin,
    merchantCanonical: first.merchantCanonical,
    refusedCanonical: null,
    matchesEverything: first.merchantCanonical === null && first.matchKeywords === null,
    // One RuleLike per OR-group is how the pipeline consumes a multi-group rule;
    // the inventory re-collapses them into the one stored row the reader can see
    // and delete, which is what `matchedRuleId` already names.
    keywordGroups: origin === 'typed' ? mapped.likes.map((l) => [...(l.matchKeywords ?? [])]) : [],
    categoryId: first.categoryId,
    renameTo: first.renameTo ?? null,
    conditions,
    priority: first.priority,
    active: true,
    refusal: null,
  };
}

function compareEntries(a: InventoryEntry, b: InventoryEntry): number {
  if (a.active !== b.active) return a.active ? -1 : 1;
  if (b.priority !== a.priority) return b.priority - a.priority;
  const bySpecificity = entrySpecificity(b) - entrySpecificity(a);
  if (bySpecificity !== 0) return bySpecificity;
  // Typed entries only — see the docblock: widening this to merchant-keyed rules
  // would assert an order the engine deliberately does not use.
  if (a.origin === 'typed' && b.origin === 'typed') return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return 0;
}

/**
 * A multi-group rule's strength against a given row is the group that matched, and
 * the inventory does not have a row in front of it. It reports the group that would
 * win MOST often — the most specific one — which is the same number
 * `pipeline.ts` would use for that group.
 */
function entrySpecificity(entry: InventoryEntry): number {
  if (entry.keywordGroups.length === 0) return keywordSpecificity([]);
  return Math.max(...entry.keywordGroups.map((g) => keywordSpecificity(g)));
}
