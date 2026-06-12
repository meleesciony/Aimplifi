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
import { normalizeMerchant } from './normalize';

export const AUTO_SILENT_BPS = 9000;
export const AUTO_FLAGGED_BPS = 7000;
export const RULE_CONFIDENCE_BPS = 9900;

export interface RuleLike {
  id: string;
  /** Canonical merchant the rule targets (null = any merchant). */
  merchantCanonical: string | null;
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
}

export type CategorySource = 'transfer' | 'user-rule' | 'merchant-default' | 'fallback';

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

export function categorize(txn: TxnInput, rules: readonly RuleLike[] = []): CategorizedTxn {
  const merchant = normalizeMerchant(txn.rawDescriptor);

  // Transfers between own accounts are never income or expense.
  if (txn.isTransfer || merchant.categoryId === 'transfer') {
    return {
      merchantCanonical: merchant.canonical,
      merchantKnown: merchant.known,
      categoryId: 'transfer',
      confidenceBps: 9900,
      needsReview: false,
      aiBadge: false,
      source: 'transfer',
      matchedRuleId: null,
    };
  }

  // User rules first — highest priority match wins.
  const matching = rules
    .filter((r) => ruleMatches(r, txn, merchant.canonical))
    .sort((a, b) => b.priority - a.priority);
  if (matching.length > 0) {
    const rule = matching[0];
    return {
      merchantCanonical: merchant.canonical,
      merchantKnown: merchant.known,
      categoryId: rule.categoryId,
      confidenceBps: RULE_CONFIDENCE_BPS,
      needsReview: false,
      aiBadge: false,
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
  const needsReview = merchant.confidenceBps < AUTO_FLAGGED_BPS;
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
export function suggestAlternatives(txn: TxnInput): string[] {
  const merchant = normalizeMerchant(txn.rawDescriptor);
  const base =
    merchant.categoryId !== 'uncategorized'
      ? [merchant.categoryId]
      : txn.amountCents > 0
        ? ['income']
        : [];
  const generic =
    txn.amountCents > 0
      ? ['income', 'transfer', 'shopping']
      : ['shopping', 'dining', 'household', 'groceries'];
  const out: string[] = [];
  for (const c of [...base, ...generic]) {
    if (!out.includes(c)) out.push(c);
    if (out.length === 3) break;
  }
  return out;
}
