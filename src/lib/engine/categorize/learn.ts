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
 * There are TWO learning keys, because a user's corrections demonstrate an
 * intent about an identity, and this app already holds two different notions of
 * "the same counterparty":
 *
 * 1. the DESCRIPTOR SIGNATURE (categorize/signature.ts) — the raw descriptor
 *    with only dates + amounts stripped and every identity number KEPT, so it
 *    stays scoped to one specific recurring counterparty (priority 50); and
 * 2. the MERCHANT CANONICAL (normalize.ts `cleanDescriptor`) — the same
 *    collapse an explicit "Always" already rules on, which additionally strips
 *    store numbers, long digit runs, processor prefixes and a CITY ST suffix
 *    (priority 40).
 *
 * The canonical tier is DECISIONS #331, and it exists because the signature
 * tier alone could not learn the owner's actual feed. Measured on real
 * descriptor shapes: three visits to one restaurant ("SQ *JOES PIZZA #221 …",
 * "#443", no store number) are three distinct signatures and ONE canonical, so
 * three corrections taught the app nothing. Same for a utility whose REF number
 * moves and a gym whose auth code moves. The owner's report — "I've already
 * inputed many and the system still doesn't recognize that the others are the
 * same, perhaps by small differences in how it's notated" — is exactly this.
 *
 * The original header argued a canonical tier was redundant with "Always". It
 * is not: "Always" needs a CLICK the user may never make, and two consistent
 * corrections are STRONGER evidence than that one click, which mints a
 * merchant-wide rule at priority 100 today. So the canonical tier is strictly
 * narrower than the affordance it complements — lower priority, an AI badge
 * (never silent), sign-guarded at match time, and refused outright for every
 * canonical that stands for MANY payees rather than one. `canonicalIsLearnable`
 * below is the whole guard and states each refusal; the four classes it turns
 * away are aggregates ('Venmo'/'Zelle'/'Check'), the unnameable residue,
 * glue-only names ('Web Pay', 'Direct Debit'), and table BUCKET labels
 * ('Airport Dining', 'Electric Bill', 'Store Card Purchase').
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
import { cleanDescriptor, normalizeMerchant } from './normalize';
import type { RuleLike } from './pipeline';
import { computeDescriptorSignature, hasDistinguishingToken } from './signature';

/** Distinct consistent corrections required before a key becomes a rule. */
export const LEARN_THRESHOLD = 2;
/** Below an explicit user "Always" (priority 100), above any merchant default. */
export const LEARNED_PRIORITY = 50;
/**
 * The canonical tier sits BELOW the signature tier: when both fire, the more
 * specific descriptor-scoped rule should win. Still far above a merchant
 * default, which is not a rule at all (pipeline tier 4).
 */
export const LEARNED_CANONICAL_PRIORITY = 40;

/**
 * The `cleanDescriptor` residue for a descriptor that kept no nameable words.
 * It is a placeholder, not an identity — many unrelated payees share it — so it
 * can never carry a learned rule.
 */
const UNNAMEABLE_CANONICAL = 'Unknown Merchant';

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

function makeRule(
  id: string,
  key: { descriptorSignature?: string; merchantCanonical?: string },
  categoryId: string,
  priority: number,
): RuleLike {
  return {
    id,
    merchantCanonical: key.merchantCanonical ?? null,
    descriptorSignature: key.descriptorSignature ?? null,
    isLearned: true,
    minAmountCents: null,
    maxAmountCents: null,
    weekendOnly: null,
    weekdayOnly: null,
    accountId: null,
    categoryId,
    priority,
  };
}

/** Canonical → the token shape `hasDistinguishingToken` expects. */
function canonicalTokens(canonical: string): string {
  return canonical
    .toUpperCase()
    .replace(/[^A-Z0-9&]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Shared floor for BOTH canonical tiers: a canonical that is a channel, a
 * placeholder, or pure bank glue names no counterparty at all.
 *   - an AGGREGATE ('Venmo', 'Zelle', 'Check', 'Cash App', 'PayPal Transfer',
 *     'ATM') — the channel, not the payee. `normalizeMerchant` flags these, and
 *     the register blocks "Always" on them for the same reason; nothing derived
 *     here may sneak past that block.
 *   - the unnameable `cleanDescriptor` residue, which is a placeholder.
 *   - a canonical built only from payment-channel roots and glue
 *     ('Web Pay', 'Ach Debit Ppd', 'Direct Debit', 'Automatic Payment',
 *     'Online Banking Transfer To') — the SAME structural test the signature
 *     tier already applies, reused rather than re-derived, because a canonical
 *     is just as capable of being payee-less as a signature is.
 */
function canonicalNamesACounterparty(canonical: string, aggregate: boolean): boolean {
  if (aggregate) return false;
  const trimmed = canonical.trim();
  if (trimmed.length === 0) return false;
  if (trimmed === UNNAMEABLE_CANONICAL) return false;
  return hasDistinguishingToken(canonicalTokens(trimmed));
}

/**
 * May this canonical carry a learned RULE — something that FILES money with no
 * further confirmation? Adds one guard on top of the shared floor:
 *
 *   the canonical must BE the reader's own descriptor, cleaned.
 *
 * `normalizeMerchant` has two kinds of output. For most rows the canonical is
 * literally `cleanDescriptor(raw)` — the reader's own words with the store
 * number, ref number, digit runs and CITY ST suffix removed. But a
 * KNOWN_MERCHANTS hit can substitute a label of the TABLE'S choosing, and some
 * of those labels name a CLASS, not a business: 'Airport Dining' covers every
 * HMSHOST outlet (a Starbucks, a Peet's and a steakhouse), 'Electric Bill'
 * covers every utility, 'Store Card Purchase' every store card. Learning on one
 * of those would file a third, unrelated payee — the exact over-generalization
 * three hostile-critic cycles locked out of the signature tier (#161 P0/P1).
 *
 * Requiring `canonical === cleanDescriptor(raw)` refuses all of them
 * STRUCTURALLY, with no hand-audit of the 300+ table patterns and no list to
 * keep complete: an identity derived from the reader's own descriptor can never
 * be broader than the descriptor they were looking at when they filed it.
 *
 * DELIBERATE non-support, recorded: a table BRAND whose label is an expansion
 * of the descriptor ('Amazon' from 'AMZN Mktp …', 'Blue Bottle Coffee' from
 * 'SQ *BLUE BOTTLE') fails this test too and gets no canonical rule. Those are
 * high-confidence auto-filed merchants whose descriptors repeat, so the
 * signature tier and an explicit "Always" already cover them — and the cost of
 * the refusal is only that a row stays reviewable.
 */
export function canonicalIsLearnable(
  canonical: string,
  aggregate: boolean,
  rawDescriptor: string,
): boolean {
  if (!canonicalNamesACounterparty(canonical, aggregate)) return false;
  return canonical === cleanDescriptor(rawDescriptor);
}

/**
 * May this canonical carry a PROPOSAL — a category shown to the reader for a
 * one-tap confirm, which files nothing on its own?
 *
 * Deliberately looser than `canonicalIsLearnable`: it keeps the shared floor
 * but drops the "must be the reader's own descriptor" guard, so a table label
 * ('Electric Bill' for a utility whose REF number moves every month) can still
 * offer the category the reader last chose for it.
 *
 * The asymmetry is the point, and it is the whole reason the two exist: a wrong
 * RULE mis-files money silently, while a wrong PROPOSAL costs one tap to
 * reject. A bucket label that would be unsafe to file on is perfectly safe to
 * ask about.
 */
export function canonicalIsProposable(canonical: string, aggregate: boolean): boolean {
  return canonicalNamesACounterparty(canonical, aggregate);
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
  //    In parallel, bucket the SAME intents under the merchant CANONICAL, which
  //    collapses the notation drift the signature deliberately keeps (store
  //    number, ref/auth number, CITY ST suffix, processor prefix) — DECISIONS
  //    #331. The two buckets are independent: a group that earns one key and not
  //    the other simply emits one rule.
  const bySignature = new Map<string, Intent[]>();
  const byCanonical = new Map<string, Intent[]>();
  for (const c of latestByTxn.values()) {
    if (c.isUndo) continue; // reverted → no demonstrated intent
    if (c.toCategoryId === 'uncategorized') continue; // "un-file" is not a category choice
    const intent: Intent = { category: c.toCategoryId, amountCents: c.amountCents };
    const signature = computeDescriptorSignature(c.rawDescriptor);
    if (signature) {
      // all-noise descriptor → unkeyable
      bySignature.set(signature, [...(bySignature.get(signature) ?? []), intent]);
    }
    const merchant = normalizeMerchant(c.rawDescriptor);
    if (canonicalIsLearnable(merchant.canonical, merchant.aggregate, c.rawDescriptor)) {
      byCanonical.set(merchant.canonical, [...(byCanonical.get(merchant.canonical) ?? []), intent]);
    }
  }

  // 3) Emit a rule per group that clears every guard.
  const rules: RuleLike[] = [];
  for (const [signature, items] of bySignature) {
    const category = learnableCategory(items);
    if (category === null) continue;
    // Secondary guard: the signature must carry a real merchant/payee word, not
    // just payment-channel roots + glue — refuses a payee-less descriptor that
    // recurs verbatim ("CHECK PAID <date>", "CARD PAYMENT", "ONLINE BANKING
    // TRANSFER" with no account number).
    if (!hasDistinguishingToken(signature)) continue;
    rules.push(
      makeRule(`learned:sig:${signature}:${category}`, { descriptorSignature: signature }, category, LEARNED_PRIORITY),
    );
  }
  for (const [canonical, items] of byCanonical) {
    const category = learnableCategory(items);
    if (category === null) continue;
    rules.push(
      makeRule(
        `learned:canon:${canonical}:${category}`,
        { merchantCanonical: canonical },
        category,
        LEARNED_CANONICAL_PRIORITY,
      ),
    );
  }
  return rules;
}

/**
 * Soft hints for triage swipe-left alternatives (TASKS 1.7 / DECISIONS #207).
 *
 * Same identity model as `deriveLearnedRules` (latest-wins + sign guard) over
 * BOTH keys — signature first, merchant canonical as the fallback (#331) — but
 * threshold = 1: a single consistent correction is enough to surface that
 * category early in `suggestAlternatives`. Conflicting categories for the
 * matched key yield no hint (same as learnableCategory).
 *
 * A hint is a PROPOSAL the reader confirms with one tap, never a filing, so it
 * may key on the looser canonical at a lower bar than a rule: the cost of a
 * wrong hint is one rejected suggestion, the cost of a wrong rule is mis-filed
 * money. That asymmetry is the whole reason the two thresholds differ.
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
  const sigUsable = targetSig !== '' && hasDistinguishingToken(targetSig);
  const targetMerchant = normalizeMerchant(txn.rawDescriptor);
  const canonUsable = canonicalIsProposable(targetMerchant.canonical, targetMerchant.aggregate);
  if (!sigUsable && !canonUsable) return [];

  const latestByTxn = new Map<string, LearnedCorrectionInput>();
  for (const c of corrections) {
    const cur = latestByTxn.get(c.transactionId);
    if (!cur || c.seq > cur.seq) latestByTxn.set(c.transactionId, c);
  }

  // Matching intents, newest first. The signature is tried first because it is
  // the more specific identity; the canonical only answers when no correction
  // shares this exact descriptor fingerprint.
  const live: LearnedCorrectionInput[] = [];
  for (const c of latestByTxn.values()) {
    if (c.isUndo) continue;
    if (c.toCategoryId === 'uncategorized') continue;
    live.push(c);
  }
  let matches = sigUsable
    ? live.filter((c) => computeDescriptorSignature(c.rawDescriptor) === targetSig)
    : [];
  if (matches.length === 0 && canonUsable) {
    matches = live.filter((c) => {
      const m = normalizeMerchant(c.rawDescriptor);
      return canonicalIsProposable(m.canonical, m.aggregate) && m.canonical === targetMerchant.canonical;
    });
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
