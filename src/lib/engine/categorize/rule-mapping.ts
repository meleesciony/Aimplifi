/**
 * The stored-rule -> RuleLike mapper (extracted from `src/server/rules.ts`,
 * O.15 slice 3), and the ONE place that decides a stored rule files nothing.
 *
 * It moved into the engine for a reason that is the whole point of the slice: the
 * /rules page must be able to say "this rule matches nothing, and here is why"
 * without re-deriving the refusal. A second implementation of "the engine ignores
 * this row" is two screens disagreeing about which of the reader's rules are
 * live — the same failure class as two money surfaces disagreeing about a total.
 * So `mapStoredRule` returns EITHER the RuleLikes the pipeline consumes OR a
 * refusal reason, and both callers read that one answer.
 *
 * Pure: no database, no session. `toRuleLike`/`toRuleLikes` keep their exact
 * pre-extraction behaviour and are re-exported from `src/server/rules.ts`, so every
 * existing importer and unit test is untouched.
 */
import { storedKeywordGroups } from './keyword-rule';
import { isAggregateCanonical } from './normalize';
import type { RuleLike } from './pipeline';

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
  /**
   * Space-joined typed keywords, pure AND (O.13a). Null on every pre-O.13a row,
   * and non-null on every typed rule — which is what makes it the discriminator.
   */
  matchKeywords?: string | null;
  /** `|`-joined OR-groups (O.13c). Null on every pre-O.13c row. Authoritative when set. */
  matchKeywordGroups?: string | null;
  /** Rename-payee action (O.13c). Null on every pre-O.13c row. */
  renameTo?: string | null;
  /** Tag-for-taxes action (O.15 slice 6). Null on every row written before it. */
  setTaxClass?: string | null;
}

/**
 * Why the engine refuses to run a stored rule — a row that is stored, loaded, and
 * files nothing. Each of these was invisible on every screen before O.15 slice 3,
 * because the page listed the rules it could render rather than the rules that run.
 *
 * `orphan-merchant` is reachable today (nothing deletes a rule when its Merchant row
 * goes) and `aggregate-merchant` protects rows that predate the creation-time guard.
 * `empty-keyword-key` has no writer this repo could name — the creation path's
 * `assertUsableKey` and the read path's floor are the same rule — so treat it as a
 * guard against a shape the mapper must survive, NOT as evidence that such rows
 * exist. Confirming would take a count against production, which nothing here has
 * run.
 */
export type RuleRefusal =
  /** `merchantId` points at a Merchant row that is no longer there. */
  | 'orphan-merchant'
  /**
   * The merchant canonical is an aggregate pseudo-payee (Venmo/Zelle/checks): one
   * canonical hides many real counterparties, so a rule keyed on it would file
   * strangers' payments alike.
   */
  | 'aggregate-merchant'
  /**
   * The row DECLARES a typed key (`matchKeywords` non-null) that decodes to no
   * usable words. `merchantCanonical: null` means "ANY merchant" downstream, so
   * running it would file every transaction in the app.
   */
  | 'empty-keyword-key';

export type MappedRule =
  | { readonly ok: true; readonly likes: RuleLike[] }
  | {
      readonly ok: false;
      readonly refusal: RuleRefusal;
      /**
       * The payee name the row POINTS AT, when we resolved one and then refused it
       * (`aggregate-merchant`). Null when there was nothing to resolve — an orphan
       * has no name by definition, and a keyword rule never had one.
       *
       * It is carried because refusing to FILE on a name is not a reason to refuse to
       * SHOW it: a reader who cannot see which rule this is cannot delete it, which
       * is the exact dead end this slice exists to close. Nothing downstream may use
       * it to match a transaction — `likes` is absent, so there is nothing to match
       * with.
       */
      readonly refusedCanonical: string | null;
    };

/**
 * Map one stored rule, naming the refusal instead of returning an empty array.
 *
 * Every `return { ok: false }` below is a guard that predates this extraction and
 * kept its original comment: the behaviour is byte-identical, only the reason is
 * now legible to a caller.
 */
export function mapStoredRule(
  rule: RuleRow,
  canonicalByMerchantId: ReadonlyMap<string, string>,
): MappedRule {
  let merchantCanonical: string | null = null;
  if (rule.merchantId) {
    const canonical = canonicalByMerchantId.get(rule.merchantId);
    // In RuleLike, `merchantCanonical: null` means "ANY merchant", so mapping an
    // orphan to null would silently turn it into a match-everything rule. Orphans
    // must match NOTHING.
    if (!canonical) return { ok: false, refusal: 'orphan-merchant', refusedCanonical: null };
    // defense in depth: aggregate pseudo-merchants never steer suggestions,
    // even if a rule row predates the creation-time guard
    if (isAggregateCanonical(canonical)) {
      return { ok: false, refusal: 'aggregate-merchant', refusedCanonical: canonical };
    }
    merchantCanonical = canonical;
  }
  // A TYPED key (O.13a). Two things are deliberate here and both are the opposite
  // of how a DERIVED key is treated:
  //
  //  - it may target an aggregate. The guard above refuses a merchant-keyed rule on
  //    Venmo/Zelle/checks because the normalizer INFERRED that identity and one
  //    canonical hides many payees. A keyword the reader typed is not an inference —
  //    he named it, he can see it in the rule list, and he can delete it — which is
  //    the same asymmetry that licenses propose.ts to use evidence learn.ts refuses.
  //    A keyword rule carries no merchantId, so it never reaches that guard, and that
  //    is correct rather than an oversight.
  //  - a DECLARED but EMPTY key matches nothing. Same trap as the orphan, same answer:
  //    refuse the row.
  //  - the two keyword columns are read through ONE shared basis
  //    (`storedKeywordGroups`), the same function the rules LIST decodes with, so
  //    the page can never show the reader a key the engine does not execute. That
  //    basis is also where the pre-O.13c column keeps its original AND meaning and
  //    where the per-group length floor is re-applied on the read path.
  const declaresKeywordKey = rule.matchKeywords != null;
  const groups = storedKeywordGroups(rule);
  if (declaresKeywordKey && groups.length === 0) {
    return { ok: false, refusal: 'empty-keyword-key', refusedCanonical: null };
  }
  const base = {
    id: rule.id,
    merchantCanonical,
    // Only a TYPED keyword rule may rename (pipeline.ts refuses it for learned
    // rules; merchant-keyed rules never store one today).
    renameTo: rule.renameTo ?? null,
    // Carried for the same reason and on the same terms as the rename: the
    // pipeline decides whether it may be USED (only an explicit rule that files),
    // and every OR-group of one stored rule shares the same THEN actions.
    setTaxClass: rule.setTaxClass ?? null,
    minAmountCents: rule.minAmountCents,
    maxAmountCents: rule.maxAmountCents,
    weekendOnly: rule.weekendOnly,
    weekdayOnly: rule.weekdayOnly,
    accountId: rule.accountId,
    categoryId: rule.categoryId,
    priority: rule.priority,
  };
  if (!declaresKeywordKey) return { ok: true, likes: [{ ...base, matchKeywords: null }] };
  return { ok: true, likes: groups.map((g) => ({ ...base, matchKeywords: g })) };
}

/**
 * Expand one stored rule into the RuleLike entries the pipeline consumes. A
 * multi-group keyword rule (O.13c — `cardone eq | cardone equity`) expands to
 * ONE RuleLike per OR-group, all sharing the stored rule's id, priority, and
 * actions: the pipeline's existing AND-matcher and per-group specificity
 * ordering then work unchanged, and `matchedRuleId` still names the one stored
 * row the reader can see and delete. Single-group and merchant-keyed rules
 * expand to exactly one entry.
 */
export function toRuleLikes(
  rule: RuleRow,
  canonicalByMerchantId: ReadonlyMap<string, string>,
): RuleLike[] {
  const mapped = mapStoredRule(rule, canonicalByMerchantId);
  return mapped.ok ? mapped.likes : [];
}

/**
 * Pure mapper — unit-tested without a database. Returns null for a rule the engine
 * refuses (see `RuleRefusal`).
 */
export function toRuleLike(
  rule: RuleRow,
  canonicalByMerchantId: ReadonlyMap<string, string>,
): RuleLike | null {
  const expanded = toRuleLikes(rule, canonicalByMerchantId);
  return expanded.length > 0 ? expanded[0] : null;
}
