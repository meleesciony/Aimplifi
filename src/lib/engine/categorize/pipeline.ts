/**
 * Categorization pipeline (Phase 2):
 *   rawDescriptor → normalize() → applyRules() → suggest → route()
 *
 * Confidence routing (thresholds in one place, tuned against the seed until
 * the <5% review-rate target holds — tuned by improving normalization first):
 *   ≥ AUTO_SILENT  : auto-apply silently
 *   ≥ AUTO_FLAGGED : auto-apply with a subtle "AI" badge
 *   <  AUTO_FLAGGED: needsReview → triage inbox
 *
 * User rule beats merchant default beats suggestion (priority ordering).
 */

import { dayOfWeek, isoDate } from '@/lib/dates';
import { CATEGORY_BY_ID } from './categories';
import { keywordSpecificity, keywordsMatch } from './keyword-rule';
import { normalizeMerchant } from './normalize';
import { computeDescriptorSignature } from './signature';
import { resolveRuleTaxStamp } from './tax-action';
import { TRANSFER_CONFIDENCE_BPS } from './transfers';

export const AUTO_SILENT_BPS = 9000;
export const AUTO_FLAGGED_BPS = 7000;
export const RULE_CONFIDENCE_BPS = 9900;
/**
 * A LEARNED rule (categorize/learn.ts) auto-files in the FLAGGED band, not the
 * silent band an explicit "Always" earns: it is inferred from repetition, not a
 * deliberate click, so it carries the visible "AI" badge and stays correctable.
 * This is the durable backstop for any over-broad learned signature — a wrong
 * learned filing is a visible guess, never a silent mis-file (DECISIONS #161,
 * hostile-critic cycle 3).
 */
export const LEARNED_RULE_CONFIDENCE_BPS = 8500;

export interface RuleLike {
  id: string;
  /** Canonical merchant the rule targets (null = any merchant). */
  merchantCanonical: string | null;
  /**
   * Optional descriptor-signature key (DECISIONS #161, categorize/signature.ts).
   * When set, the rule matches ONLY transactions whose raw descriptor reduces to
   * this signature — the key learned rules use for date-fragmented descriptors
   * and aggregate payees, which `merchantCanonical` cannot express. Absent/null
   * on every stored rule, so existing behavior is byte-identical.
   */
  descriptorSignature?: string | null;
  /**
   * The reader's own TYPED match key (TASKS O.13a, categorize/keyword-rule.ts):
   * every keyword must appear literally (case-insensitive) in the raw statement
   * text. This is the key a derived one cannot express — `tjmaxx 0181 0966` where
   * the store and sequence numbers change every visit.
   *
   * Absent/null on every rule stored before O.13a, so existing behavior is
   * byte-identical. An EMPTY array is NOT absent: it matches nothing, because a
   * keyword rule carries `merchantCanonical: null` ("any merchant") and would
   * otherwise file everything.
   */
  matchKeywords?: readonly string[] | null;
  /**
   * True for a synthetic LEARNED rule (categorize/learn.ts), false/absent for an
   * explicit user rule. Learned rules pass a match-time sign check (a future
   * same-signature row can flip sign — e.g. an income-learned "PAYPAL UPWORK"
   * meeting a later refund/fee); explicit rules are deliberate and always apply.
   */
  isLearned?: boolean;
  /**
   * Rename-payee action (TASKS O.13c, Simplifi parity: "Rename Payee"). When the
   * rule files a transaction, the row's merchant canonical becomes THIS name
   * instead of whatever the normalizer derived — which is how `costco whse 1084`,
   * `COSTCO WHSE #0981`, and every future variant group under one payee the
   * reader named. Ingest upserts the Merchant row from the pipeline's returned
   * canonical, so the rename is an identity-level grouping (register, merchant
   * lens, recurring), not a cosmetic label. Absent/null on every rule stored
   * before O.13c and on learned rules, so existing behavior is byte-identical.
   */
  renameTo?: string | null;
  /**
   * Tag-for-taxes action (O.15 slice 6, Simplifi parity row 2). When the rule FILES
   * a transaction, the row's `taxClass` becomes this slug — unless the row already
   * carries one, which is never overwritten (categorize/tax-action.ts holds the
   * whole decision and the reasoning for it). Absent/null on every rule stored
   * before this slice and on learned rules, so existing behavior is byte-identical.
   */
  setTaxClass?: string | null;
  minAmountCents: number | null;
  maxAmountCents: number | null;
  weekendOnly: boolean | null;
  weekdayOnly: boolean | null;
  accountId: string | null;
  categoryId: string;
  priority: number; // higher wins; user rules ≥ 100
}

export interface TxnInput {
  rawDescriptor: string;
  /** Signed cents; rules match on absolute value (spend magnitude). */
  amountCents: number;
  date: string; // YYYY-MM-DD
  accountId: string;
  isTransfer?: boolean;
  /**
   * An optional, ALREADY-MAPPED-TO-OUR-TAXONOMY category hint from the ingest
   * provider — today, Plaid's `personal_finance_category` mapped in plaid-map.ts.
   * It is consulted ONLY to rescue a row our own normalization would otherwise send
   * to review: it never overrides a user rule, a transfer, or a confident merchant
   * match, and never a deliberate aggregate (Zelle/checks). Absent for demo / CSV /
   * SimpleFIN, so their categorization stays byte-identical (DECISIONS #22 — one
   * categorize path for every ingest source; this keeps it golden-safe).
   */
  providerCategoryHint?: { categoryId: string; confidenceBps: number } | null;
  /**
   * The tax tag the row ALREADY carries, for the rule tax-stamp decision (O.15
   * slice 6). Absent/undefined means untagged, which is true by construction of
   * every NEW row an ingest writer is about to create — so only the paths that
   * re-categorize an EXISTING row (the backfill) need to pass it, and the ones
   * that don't keep their exact prior behaviour.
   *
   * It is passed IN rather than the decision being made at each writer because
   * "may this rule tag this row" is one question with one answer; asking it at six
   * write sites is the fence-by-call-site anti-pattern DECISIONS #345(c) refused a
   * per-category flag over in the first place.
   */
  currentTaxClass?: string | null;
}

export type CategorySource =
  | 'transfer'
  | 'user-rule'
  | 'merchant-default'
  | 'fallback'
  | 'provider-category';

/**
 * Is `hint` usable to auto-file a transaction of `amountCents`? A provider hint
 * only ever RESCUES a row headed for review, so it must clear the same bars the
 * ingest/backfill auto-file path clears:
 *  - CONFIDENT enough to auto-file (≥ the effective AUTO_FLAGGED boundary: the
 *    global constant, or the user's tuned value when threshold tuning is active,
 *    DECISIONS #190) — a low-confidence hint leaves the row in review, exactly
 *    as our own low-confidence merchant match would;
 *  - a REAL, concrete system category — never `transfer` (mislabeling spend as a
 *    transfer silently erases it — critic F4; our tested transfer detection owns
 *    that call) and never `uncategorized` (that IS review), and never a bogus id;
 *  - SIGN-APPROPRIATE (#44): an inflow (positive) may only take an Income-group
 *    category; an outflow (negative) may never be booked as income. A $0 amount is
 *    never rescued.
 */
function isUsableProviderHint(
  hint: { categoryId: string; confidenceBps: number },
  amountCents: number,
  flaggedBps: number,
): boolean {
  if (hint.confidenceBps < flaggedBps) return false;
  if (hint.categoryId === 'transfer' || hint.categoryId === 'uncategorized') return false;
  const cat = CATEGORY_BY_ID.get(hint.categoryId);
  if (!cat) return false; // unknown / garbage id — never file to a category that doesn't exist
  const isIncome = cat.group === 'Income';
  if (amountCents > 0) return isIncome;
  if (amountCents < 0) return !isIncome;
  return false;
}

/**
 * May a LEARNED rule for `categoryId` file a transaction of `amountCents`? The
 * #44 sign check applied at MATCH time: transfer is sign-neutral; an inflow may
 * only take an Income category; an outflow may never be booked as income. An
 * unknown/custom category group can't be judged, so it is allowed (the
 * derive-time consistency + distinguishing-token guards already gated it). A $0
 * amount is neutral.
 */
function learnedSignOk(categoryId: string, amountCents: number): boolean {
  if (categoryId === 'transfer') return true;
  const cat = CATEGORY_BY_ID.get(categoryId);
  if (!cat) return true;
  const isIncome = cat.group === 'Income';
  if (amountCents > 0) return isIncome;
  if (amountCents < 0) return !isIncome;
  return true;
}

/**
 * The sign guard for a TYPED keyword rule (O.13a). Asymmetric on purpose, and the
 * asymmetry is the whole point:
 *
 *  - an OUTFLOW into an Income-group category is REFUSED. `isSpendRow` drops
 *    Income-group rows, so such a filing deletes real spending from reports,
 *    trends and budgets while `monthlyFlows` still counts it as an expense — two
 *    surfaces disagreeing by the amount, with no badge and no review. A keyword
 *    key is a SUBSTRING, so it generalises to rows the reader never saw when he
 *    wrote it ("cardone" written for deposits will meet a management fee).
 *  - an INFLOW into a spend category is ALLOWED, because that is the documented
 *    refund convention: a return files back to the category it reverses.
 *
 * A refused rule falls through to review, which is what every other auto-file path
 * here does with a wrong-signed answer. Mirrored by `signWouldErase` in
 * server/keyword-rules.ts so the preview promises exactly this.
 */
export function keywordRuleSignOk(categoryId: string, amountCents: number): boolean {
  const cat = CATEGORY_BY_ID.get(categoryId);
  if (!cat) return true; // custom category — group unknown, so no claim is made
  return !(cat.group === 'Income' && amountCents < 0);
}

export interface CategorizedTxn {
  merchantCanonical: string;
  merchantKnown: boolean;
  categoryId: string;
  confidenceBps: number;
  needsReview: boolean;
  /** True when auto-applied in the 7000–8999 band (subtle AI badge in UI). */
  aiBadge: boolean;
  source: CategorySource;
  matchedRuleId: string | null;
  /**
   * The tax tag to WRITE onto this row, or null for "leave `taxClass` exactly as
   * it is" (O.15 slice 6). Non-null only when a rule that actually FILED this row
   * carries the action AND the row is untagged — the whole decision lives in
   * `resolveRuleTaxStamp`, so a writer's only job is `if (taxClassStamp) write it`.
   *
   * It is null on every path that is not a user-rule match, which is what keeps
   * every non-rule filing byte-identical: a transfer, a merchant default, a
   * provider-category rescue and a fallback all tag nothing, exactly as before.
   */
  taxClassStamp: string | null;
}

export function ruleMatches(rule: RuleLike, txn: TxnInput, merchantCanonical: string): boolean {
  if (rule.merchantCanonical !== null && rule.merchantCanonical !== merchantCanonical) return false;
  // Signature-keyed (learned) rules match on the descriptor fingerprint, not the
  // canonical. The `!= null` guard means the signature is only ever computed for
  // a signature-mode rule — the ordinary stored-rule path pays nothing.
  if (rule.descriptorSignature != null && rule.descriptorSignature !== computeDescriptorSignature(txn.rawDescriptor))
    return false;
  // The reader's TYPED key (O.13a). `!= null` deliberately lets an EMPTY array
  // through to `keywordsMatch`, which refuses it — a keyword rule that lost its
  // keywords must match nothing, never everything (keyword-rule.ts header).
  if (rule.matchKeywords != null && !keywordsMatch(rule.matchKeywords, txn.rawDescriptor)) return false;
  const magnitude = Math.abs(txn.amountCents);
  if (rule.minAmountCents !== null && magnitude < rule.minAmountCents) return false;
  if (rule.maxAmountCents !== null && magnitude > rule.maxAmountCents) return false;
  if (rule.accountId !== null && rule.accountId !== txn.accountId) return false;
  const dow = dayOfWeek(isoDate(txn.date));
  const weekend = dow === 0 || dow === 6;
  if (rule.weekendOnly && !weekend) return false;
  if (rule.weekdayOnly && weekend) return false;
  return true;
}

export interface CategorizeOptions {
  /**
   * Per-user AUTO_FLAGGED (auto-file vs review) boundary from bounded threshold
   * tuning (categorize/tuning.ts, DECISIONS #190) — omitted/undefined means the
   * global AUTO_FLAGGED_BPS, so every existing call site is byte-identical.
   * SAFETY INVARIANT: only the flagged/review boundary moves. The aiBadge
   * checks below compare against the global AUTO_SILENT_BPS constant, so no
   * flaggedBps value — however wrong — can produce a new SILENT filing: a
   * tuned-in row is always a visible, correctable guess.
   */
  flaggedBps?: number;
}

export function categorize(
  txn: TxnInput,
  rules: readonly RuleLike[] = [],
  opts?: CategorizeOptions,
): CategorizedTxn {
  const flaggedBps = opts?.flaggedBps ?? AUTO_FLAGGED_BPS;
  const merchant = normalizeMerchant(txn.rawDescriptor);

  // Transfers between own accounts are never income or expense.
  if (txn.isTransfer || merchant.categoryId === 'transfer') {
    return {
      merchantCanonical: merchant.canonical,
      merchantKnown: merchant.known,
      categoryId: 'transfer',
      confidenceBps: TRANSFER_CONFIDENCE_BPS,
      needsReview: false,
      aiBadge: false,
      source: 'transfer',
      matchedRuleId: null,
      // A transfer returns BEFORE rules are consulted, so no rule can tag it —
      // which is also why `matchableWhere` excludes transfers from a rule's apply
      // set. The two paths agree by construction.
      taxClassStamp: null,
    };
  }

  // User rules first — highest priority match wins. A LEARNED rule is skipped
  // when its category disagrees with THIS transaction's sign (#44 at match
  // time): the derive-time guard only saw the corrected rows, so a later
  // opposite-sign row sharing the signature (an income-learned merchant issuing
  // a refund/fee) must fall through to review rather than auto-file wrong.
  const matching = rules
    .filter((r) => ruleMatches(r, txn, merchant.canonical))
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      // Between two TYPED keyword rules that both match, the more specific key
      // wins (O.13a): "costco gas" beats "costco" rather than depending on which
      // row the database returned first.
      const bySpecificity =
        keywordSpecificity(b.matchKeywords ?? []) - keywordSpecificity(a.matchKeywords ?? []);
      if (bySpecificity !== 0) return bySpecificity;
      // Last resort, and ONLY between keyword rules: a stable id order, so two
      // equally-specific typed keys never resolve by query order. Merchant-keyed
      // rules deliberately keep the insertion-order tie-break that
      // `ensureUnconditionalRule`'s supersede logic is written against — widening
      // this to them would change behaviour that another module depends on.
      if (a.matchKeywords && b.matchKeywords) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      return 0;
    });
  // A TYPED keyword rule takes the same #44 sign check a learned rule takes, and
  // for a stronger reason: its key is a substring, so it generalises to rows the
  // reader never saw when he wrote it. A `cardone -> income` rule meeting next
  // month's `CARDONE MGMT FEE -$125.00` filed an OUTFLOW as income — and an
  // Income-group row is dropped by `isSpendRow`, so $125 of real spending vanished
  // from reports, trends and budgets while the flows engine still counted it as an
  // expense: two surfaces disagreeing by the amount, silently, with no badge and
  // no review (critic P0-1, reproduced). Falling through to review is what every
  // other auto-file path in this file already does with a wrong-signed answer.
  //
  // An explicit MERCHANT rule is deliberately still exempt: its key is an exact
  // identity the reader attached to one payee, not a pattern.
  // Two different sign guards, deliberately, because the two rule kinds fail
  // differently. A LEARNED rule keeps its symmetric check (unchanged). A TYPED
  // keyword rule takes the ASYMMETRIC one: reusing `learnedSignOk` for it was
  // wrong, because that also refuses a POSITIVE row in a spend category — the
  // refund/return case this file documents as correct by convention (a return
  // offsets the spend it reverses), and this slice's own lock caught it. Only the
  // erasing direction is refused, which is exactly what the rule builder's preview
  // counts and skips, so engine and preview share one rule.
  const rule = matching.find((r) => {
    if (r.isLearned === true && !learnedSignOk(r.categoryId, txn.amountCents)) return false;
    if (r.matchKeywords != null && !keywordRuleSignOk(r.categoryId, txn.amountCents)) return false;
    return true;
  });
  if (rule) {
    const learned = rule.isLearned === true;
    // Rename-payee action (O.13c): the rule's name wins over the derived
    // canonical, and a renamed payee is KNOWN by definition — the reader named
    // it. Only an explicit rule can carry `renameTo` (learn.ts never sets it),
    // and only a rule that actually FILES renames: a sign-refused rule above
    // fell through, so a wrong-signed row keeps its derived identity and lands
    // in review under the name the reader can still recognize.
    const renamed = !learned && rule.renameTo != null && rule.renameTo !== '';
    return {
      merchantCanonical: renamed ? rule.renameTo! : merchant.canonical,
      merchantKnown: renamed ? true : merchant.known,
      categoryId: rule.categoryId,
      confidenceBps: learned ? LEARNED_RULE_CONFIDENCE_BPS : RULE_CONFIDENCE_BPS,
      needsReview: false,
      aiBadge: learned, // a learned rule is a visible, correctable guess
      source: 'user-rule',
      matchedRuleId: rule.id,
      // Tag-for-taxes (O.15 slice 6). Gated on `!learned` for the same reason the
      // rename is: a learned rule is the app's own inference, and a tax tag is a
      // claim about a deduction — only an instruction the reader typed may make it.
      // `learn.ts` never sets the column, so this is defence in depth rather than
      // the only guard. And it sits INSIDE the branch that files, so a rule the
      // sign check refused above tags nothing either: the row keeps its identity,
      // its category and its blank tag, and lands in review where it can be seen.
      taxClassStamp: learned
        ? null
        : resolveRuleTaxStamp({
            ruleTaxClass: rule.setTaxClass,
            currentTaxClass: txn.currentTaxClass,
          }),
    };
  }

  // If the user has amount-banded rules for this merchant — whose OTHER
  // conditions (account, weekday/weekend) also apply to this transaction —
  // and the amount falls outside every band, the user has declared this
  // context ambiguous → review (EDGE_CASES §Categorization). Rules scoped to
  // a different account or day must NOT poison unrelated transactions
  // (Hostile Critic finding F5).
  const amountBanded = rules.filter(
    (r) =>
      r.merchantCanonical === merchant.canonical &&
      (r.minAmountCents !== null || r.maxAmountCents !== null) &&
      ruleMatches({ ...r, minAmountCents: null, maxAmountCents: null }, txn, merchant.canonical),
  );
  if (amountBanded.length > 0) {
    return {
      merchantCanonical: merchant.canonical,
      merchantKnown: merchant.known,
      categoryId: 'uncategorized',
      confidenceBps: 5000,
      needsReview: true,
      aiBadge: false,
      source: 'fallback',
      matchedRuleId: null,
      // No rule filed this row (the reader declared the amount context ambiguous),
      // so no rule tags it either.
      taxClassStamp: null,
    };
  }

  // Merchant default / generic fallback.
  const needsReview = merchant.confidenceBps < flaggedBps;

  // Provider-category rescue (DECISIONS #155): our own normalization is about to send
  // this row to review (an unknown / low-confidence merchant). If the ingest provider
  // (Plaid's personal_finance_category) supplied a confident category for it — already
  // mapped to our taxonomy — auto-file THAT instead of dumping the row in the triage
  // pile. Guardrails: only when the merchant is genuinely uncertain (a confident merchant
  // match never reaches here, so this can only IMPROVE an otherwise-unreviewed row —
  // never override one); NEVER for a deliberate aggregate (Zelle/checks — one canonical
  // hides many payees); and only for a sign-appropriate, real, non-transfer category
  // (isUsableProviderHint). The hint's confidence is capped below AUTO_SILENT upstream,
  // so it carries the visible "AI" badge — a correctable guess, never a silent one.
  const hint = txn.providerCategoryHint;
  if (needsReview && !merchant.aggregate && hint && isUsableProviderHint(hint, txn.amountCents, flaggedBps)) {
    return {
      merchantCanonical: merchant.canonical,
      merchantKnown: merchant.known,
      categoryId: hint.categoryId,
      confidenceBps: hint.confidenceBps,
      needsReview: false,
      aiBadge: hint.confidenceBps < AUTO_SILENT_BPS,
      source: 'provider-category',
      matchedRuleId: null,
      // The provider's guess is not the reader's instruction, so it tags nothing.
      taxClassStamp: null,
    };
  }

  // #44 sign guard on the MERCHANT-DEFAULT path (#163 hostile-critic P1-1): an
  // OUTFLOW must never auto-file into an Income-group leaf — a Stripe balance
  // debit sharing the payout descriptor, a tenant PAYING rent through Buildium,
  // or a Gusto/ADP service fee would otherwise be silently booked as income
  // (inflating income AND erasing spend — the income-side analog of the F4
  // transfer-erasure class). Such a row is genuinely anomalous → review. The
  // INFLOW direction is deliberately NOT guarded here: a positive amount on a
  // spend category is the refund/return case, which files back to the original
  // category by convention (returns offset spend). User rules stay deliberate
  // (always apply); learned rules, provider hints, and backfill/LLM assist all
  // carry their own #44 checks already.
  const cat = CATEGORY_BY_ID.get(merchant.categoryId);
  if (!needsReview && txn.amountCents < 0 && cat?.group === 'Income') {
    return {
      merchantCanonical: merchant.canonical,
      merchantKnown: merchant.known,
      categoryId: 'uncategorized',
      confidenceBps: 5000,
      needsReview: true,
      aiBadge: false,
      source: 'fallback',
      matchedRuleId: null,
      taxClassStamp: null,
    };
  }

  return {
    merchantCanonical: merchant.canonical,
    merchantKnown: merchant.known,
    categoryId: needsReview ? 'uncategorized' : merchant.categoryId,
    confidenceBps: merchant.confidenceBps,
    needsReview,
    aiBadge: !needsReview && merchant.confidenceBps < AUTO_SILENT_BPS,
    source: merchant.known ? 'merchant-default' : 'fallback',
    matchedRuleId: null,
    // A merchant default is the app's own inference about an identity, not an
    // instruction — the same line the rename action draws.
    taxClassStamp: null,
  };
}

/** Top-3 alternative categories for the triage inbox's swipe-left flow. */
export function suggestAlternatives(
  txn: TxnInput,
  opts?: { personalized?: readonly string[] },
): string[] {
  const merchant = normalizeMerchant(txn.rawDescriptor);
  const base =
    merchant.categoryId !== 'uncategorized'
      ? [merchant.categoryId]
      : txn.amountCents > 0
        ? ['income']
        : [];
  const personalized = opts?.personalized ?? [];
  const generic =
    txn.amountCents > 0
      ? ['income', 'transfer', 'shopping']
      : ['shopping', 'dining', 'household', 'groceries'];
  const out: string[] = [];
  for (const c of [...base, ...personalized, ...generic]) {
    if (!out.includes(c)) out.push(c);
    if (out.length === 3) break;
  }
  return out;
}
