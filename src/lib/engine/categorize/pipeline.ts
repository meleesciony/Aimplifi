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
import { keywordsMatch } from './keyword-rule';
import { normalizeMerchant } from './normalize';
import { computeDescriptorSignature } from './signature';
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
    };
  }

  // User rules first — highest priority match wins. A LEARNED rule is skipped
  // when its category disagrees with THIS transaction's sign (#44 at match
  // time): the derive-time guard only saw the corrected rows, so a later
  // opposite-sign row sharing the signature (an income-learned merchant issuing
  // a refund/fee) must fall through to review rather than auto-file wrong.
  const matching = rules
    .filter((r) => ruleMatches(r, txn, merchant.canonical))
    .sort((a, b) => b.priority - a.priority);
  const rule = matching.find((r) => !r.isLearned || learnedSignOk(r.categoryId, txn.amountCents));
  if (rule) {
    const learned = rule.isLearned === true;
    return {
      merchantCanonical: merchant.canonical,
      merchantKnown: merchant.known,
      categoryId: rule.categoryId,
      confidenceBps: learned ? LEARNED_RULE_CONFIDENCE_BPS : RULE_CONFIDENCE_BPS,
      needsReview: false,
      aiBadge: learned, // a learned rule is a visible, correctable guess
      source: 'user-rule',
      matchedRuleId: rule.id,
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
