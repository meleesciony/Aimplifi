/**
 * Learn-from-corrections engine (DECISIONS #161) — the passive learning the
 * owner asked for: "the categorization should learn from users' inputs; the user
 * shouldn't have to recreate the wheel each time."
 *
 * Today a `Correction` is per-transaction and consulted by NOTHING at
 * categorization time; it only helps future rows if the user manually promotes
 * it to an "Always" rule — a step that is easy to miss and BLOCKED outright for
 * aggregates. So a descriptor the user re-files every sync ("credit card paid",
 * "check paid" → transfer) never sticks.
 *
 * This pure function turns a user's correction HISTORY into synthetic
 * `RuleLike[]` ("learned rules") that are appended — in the server loader
 * (src/server/rules.ts) — to the same `rules[]` array `categorize()` already
 * applies at every ingest and re-run path. `categorize()` itself is unchanged.
 *
 * Every learned rule keys on a DESCRIPTOR SIGNATURE (categorize/signature.ts):
 * the raw descriptor with only dates + amounts stripped, so it stays scoped to
 * one specific recurring counterparty. It never keys on the collapsed
 * merchant CANONICAL — that is what an explicit "Always" (register, priority
 * 100, merchant-wide) already does; the learned path is the conservative,
 * per-descriptor complement that catches what the user never clicked "Always"
 * on (aggregates, date-fragmented descriptors).
 *
 * Safety is EARNED BY REPETITION, never a single click, and rests on the
 * signature's structure rather than any word list:
 *   - a signature must be corrected to the SAME category >= LEARN_THRESHOLD
 *     times across DISTINCT transactions, with ZERO conflicting corrections;
 *   - because the signature keeps account/phone/check numbers, two DIFFERENT
 *     payees never share one — so one "Zelle → rent" can never file every Zelle
 *     as rent (a different payee's number is a different signature);
 *   - a genuinely payee-less signature that recurs verbatim ("CHECK PAID",
 *     "CARD PAYMENT") is refused by hasDistinguishingToken;
 *   - the #44 sign guard holds at derive time AND at match time (pipeline.ts).
 *
 * Learned rules are computed on the fly from the (undoable, user-visible)
 * Correction rows — no schema change, no DB writes, and the demo seed (zero
 * corrections) derives zero learned rules, so every golden value is byte-
 * identical. Undo is automatic: it changes the history, so the derived rule
 * updates or disappears on the next read.
 */
import { CATEGORY_BY_ID } from './categories';
import type { RuleLike } from './pipeline';
import { computeDescriptorSignature, hasDistinguishingToken } from './signature';

/** Distinct consistent corrections required before a key becomes a rule. */
export const LEARN_THRESHOLD = 2;
/** Below an explicit user "Always" (priority 100), above any merchant default. */
export const LEARNED_PRIORITY = 50;

/**
 * One row of correction history, already joined to its transaction by the
 * server. Kept flat + primitive so the whole learner is a pure unit test.
 */
export interface LearnedCorrectionInput {
  transactionId: string;
  toCategoryId: string;
  /** true when this row is an inverse/undo (Correction.undoesId is set). */
  isUndo: boolean;
  /** Monotonic order key (Correction.createdAt ascending index) — latest wins. */
  seq: number;
  rawDescriptor: string;
  amountCents: number;
}

function isIncomeCategory(categoryId: string): boolean {
  return CATEGORY_BY_ID.get(categoryId)?.group === 'Income';
}
/** Spend = a real category that is neither transfer nor an Income-group bucket. */
function isSpendCategory(categoryId: string): boolean {
  if (categoryId === 'transfer') return false;
  const cat = CATEGORY_BY_ID.get(categoryId);
  return cat ? cat.group !== 'Income' : false;
}

interface Intent {
  category: string;
  amountCents: number;
}

function makeRule(id: string, descriptorSignature: string, categoryId: string): RuleLike {
  return {
    id,
    merchantCanonical: null,
    descriptorSignature,
    isLearned: true,
    minAmountCents: null,
    maxAmountCents: null,
    weekendOnly: null,
    weekdayOnly: null,
    accountId: null,
    categoryId,
    priority: LEARNED_PRIORITY,
  };
}

export function deriveLearnedRules(corrections: readonly LearnedCorrectionInput[]): RuleLike[] {
  // 1) Net intent per transaction — the LATEST correction wins. This folds away
  //    change-your-mind sequences and undos in one step (an undo is just the
  //    latest row for that txn, and it is flagged isUndo → dropped below).
  const latestByTxn = new Map<string, LearnedCorrectionInput>();
  for (const c of corrections) {
    const cur = latestByTxn.get(c.transactionId);
    if (!cur || c.seq > cur.seq) latestByTxn.set(c.transactionId, c);
  }

  // 2) Bucket each demonstrated intent under its identity-preserving SIGNATURE.
  //    Two corrections group ONLY if they are the same recurring counterparty
  //    (identical modulo date/amount) — different payees carry different
  //    account/phone/check numbers, so they land in different groups and can
  //    never be blanketed by one rule.
  const bySignature = new Map<string, Intent[]>();
  for (const c of latestByTxn.values()) {
    if (c.isUndo) continue; // reverted → no demonstrated intent
    if (c.toCategoryId === 'uncategorized') continue; // "un-file" is not a category choice
    const signature = computeDescriptorSignature(c.rawDescriptor);
    if (!signature) continue; // all-noise descriptor → unkeyable
    const list = bySignature.get(signature) ?? [];
    list.push({ category: c.toCategoryId, amountCents: c.amountCents });
    bySignature.set(signature, list);
  }

  // 3) Emit a rule per signature group that clears every guard.
  const rules: RuleLike[] = [];
  for (const [signature, items] of bySignature) {
    const category = learnableCategory(items);
    if (category === null) continue;
    // Secondary guard: the signature must carry a real merchant/payee word, not
    // just payment-channel roots + glue — refuses a payee-less descriptor that
    // recurs verbatim ("CHECK PAID <date>", "CARD PAYMENT", "ONLINE BANKING
    // TRANSFER" with no account number).
    if (!hasDistinguishingToken(signature)) continue;
    rules.push(makeRule(`learned:sig:${signature}:${category}`, signature, category));
  }
  return rules;
}

/**
 * Soft hints for triage swipe-left alternatives (TASKS 1.7 / DECISIONS #207).
 *
 * Same identity model as `deriveLearnedRules` (signature + latest-wins + sign
 * guard), but threshold = 1: a single consistent correction is enough to
 * surface that category early in `suggestAlternatives`. Conflicting categories
 * for the same signature yield no hint (same as learnableCategory).
 *
 * Returns category ids ordered most-recent `seq` first. Empty when history
 * does not support a hint for this txn — callers fall through to generics.
 */
export function deriveCorrectionHints(
  txn: { rawDescriptor: string; amountCents: number },
  corrections: readonly LearnedCorrectionInput[],
): string[] {
  if (corrections.length === 0) return [];
  const targetSig = computeDescriptorSignature(txn.rawDescriptor);
  if (!targetSig || !hasDistinguishingToken(targetSig)) return [];

  const latestByTxn = new Map<string, LearnedCorrectionInput>();
  for (const c of corrections) {
    const cur = latestByTxn.get(c.transactionId);
    if (!cur || c.seq > cur.seq) latestByTxn.set(c.transactionId, c);
  }

  // Matching intents for this signature, newest first.
  const matches: LearnedCorrectionInput[] = [];
  for (const c of latestByTxn.values()) {
    if (c.isUndo) continue;
    if (c.toCategoryId === 'uncategorized') continue;
    if (computeDescriptorSignature(c.rawDescriptor) !== targetSig) continue;
    matches.push(c);
  }
  matches.sort((a, b) => b.seq - a.seq);

  if (matches.length === 0) return [];

  const categories = new Set(matches.map((m) => m.toCategoryId));
  if (categories.size !== 1) return []; // conflict → no preferred hint
  const category = matches[0]!.toCategoryId;

  // #44 sign guard against THIS txn (not the historical amounts).
  if (isSpendCategory(category) && txn.amountCents > 0) return [];
  if (isIncomeCategory(category) && txn.amountCents < 0) return [];

  return [category];
}

/**
 * The category a group has EARNED, or null. Requires: exactly one target
 * category (a conflicting correction blocks learning), at least LEARN_THRESHOLD
 * distinct transactions, and the #44 sign guard (never learn an inflow into a
 * spend category, nor an outflow into income).
 */
function learnableCategory(items: readonly Intent[]): string | null {
  const categories = new Set(items.map((i) => i.category));
  if (categories.size !== 1) return null;
  if (items.length < LEARN_THRESHOLD) return null;
  const category = items[0].category;
  if (isSpendCategory(category) && items.some((i) => i.amountCents > 0)) return null;
  if (isIncomeCategory(category) && items.some((i) => i.amountCents < 0)) return null;
  return category;
}
