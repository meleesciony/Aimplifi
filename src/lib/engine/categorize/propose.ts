/**
 * Category PROPOSAL engine (DECISIONS #331) — "propose it and ask for
 * confirmation".
 *
 * The owner, live, on the categorization surfaces:
 *
 *   "for venmo and other checks that are repetitive in value, there should be a
 *    guess at category and ask for confirmation … any time you can help
 *    categorize, propose it and ask for confirmation. It's very dumb right now."
 *
 * WHY THIS IS A SEPARATE ENGINE FROM THE LEARNER
 *
 * `learn.ts` derives RULES, which file money with no further confirmation, so
 * every key it may use has to survive the question "could this identity stand
 * for a payee other than the one the user filed?". That question is why
 * aggregate channels — Venmo, Zelle, checks, Cash App — are refused outright
 * there and refused for "Always" in the register: one canonical, many unrelated
 * payees. It is the correct answer for a rule, and it is the reason those rows
 * are exactly the ones the owner re-files forever.
 *
 * A PROPOSAL is a different object. It files nothing. It renders a category the
 * reader confirms or replaces with one tap, and it always states the evidence it
 * rests on, so the reader can judge it rather than trust it. Being wrong costs
 * one tap. That asymmetry — a wrong rule mis-files money silently, a wrong
 * proposal costs a tap — is what licenses evidence here that would be
 * unacceptable in `learn.ts`, and it is the whole reason this module exists
 * rather than a loosened threshold over there.
 *
 * WHAT IT WILL AND WILL NOT SAY
 *
 * Three bases, tried in descending order of how specific the evidence is:
 *
 *   1. `payee`  — prior corrections naming the SAME counterparty, compared by
 *                 the descriptor's distinguishing tokens rather than its
 *                 signature. This is what rescues an aggregate: two Venmo rows
 *                 to JOHN SMITH carry different transaction ids (so different
 *                 signatures) but the same payee tokens.
 *   2. `amount` — the owner's literal case: same channel, IDENTICAL amount in
 *                 cents, seen at least twice before and filed the same way each
 *                 time. A recurring check or transfer for exactly $450.00 is a
 *                 standing obligation; the amount is the identity.
 *   3. `merchant` — prior corrections on the same merchant canonical, which is
 *                 the looser `canonicalIsProposable` key (a table bucket label
 *                 like 'Electric Bill' is allowed here and refused in learn.ts).
 *
 * Every basis requires UNANIMITY across the matching history: one contradicting
 * correction and the proposal is withheld entirely. A proposal is never
 * assembled from a majority — with evidence this thin, disagreement means the
 * reader is the only one who knows, which is the honest answer and also the one
 * the app is already able to render (the row simply stays unproposed).
 *
 * THE AMOUNT BASIS HAS ONE EXTRA GUARD, and it is load-bearing. Amount evidence
 * is used only when the payees do NOT contradict each other: if the historical
 * rows name a counterparty and this row names a DIFFERENT one, the shared amount
 * is a coincidence, not an identity — a $450.00 Venmo to a landlord must not
 * propose 'rent' for a $450.00 Venmo to a contractor. When neither side names
 * anybody (a bare check number), the amount stands alone, which is precisely the
 * case the owner described.
 *
 * Pure and deterministic: no dates, no clock, no I/O. The reason string is
 * assembled from values carried VERBATIM out of the history — this engine never
 * computes a new money figure, it only repeats one it was given.
 */
import { CATEGORY_BY_ID } from './categories';
import { canonicalIsProposable } from './learn';
import type { LearnedCorrectionInput } from './learn';
import { normalizeMerchant } from './normalize';
import { computeDescriptorSignature, distinguishingTokens } from './signature';

/** Which evidence a proposal rests on — rendered to the reader, never hidden. */
export type ProposalBasis = 'payee' | 'amount' | 'merchant';

export interface CategoryProposal {
  categoryId: string;
  basis: ProposalBasis;
  /** How many prior corrections support it (always >= the basis threshold). */
  supportCount: number;
  /**
   * The identity the evidence was grouped by, for the UI's explanation: the
   * payee tokens, the merchant canonical, or the repeated amount in cents.
   */
  subject: string;
  /** Amount the `amount` basis matched on, in integer cents. Null otherwise. */
  matchedAmountCents: number | null;
}

/** A proposal on a payee or merchant needs one demonstration; an amount needs two. */
export const PROPOSE_THRESHOLD = 1;
export const PROPOSE_AMOUNT_THRESHOLD = 2;

/**
 * The sentence shown under a proposal, naming the evidence it rests on so the
 * reader can judge it rather than trust it — a proposal that cannot be checked
 * is just a guess wearing a confident face.
 *
 * Money is NOT formatted here. Per the project convention, cents become a
 * string at the UI boundary through the one `formatCents` helper, so the caller
 * passes the already-formatted amount; likewise the category LABEL, which only
 * the per-user resolver can produce for a custom category. This function owns
 * the sentence, not the values in it, and every value it prints is one it was
 * handed verbatim.
 */
export function proposalReason(
  proposal: CategoryProposal,
  opts: { categoryLabel: string; amount: string | null },
): string {
  const n = proposal.supportCount;
  const times = n === 1 ? 'once' : `${n} times`;
  switch (proposal.basis) {
    case 'payee':
      return n === 1
        ? `You filed an earlier payment to ${proposal.subject} as ${opts.categoryLabel}.`
        : `You filed ${n} earlier payments to ${proposal.subject} as ${opts.categoryLabel}.`;
    case 'amount':
      return opts.amount === null
        ? `You filed ${times} for this same amount as ${opts.categoryLabel}.`
        : `Your last ${n} ${proposal.subject} rows for ${opts.amount} were ${opts.categoryLabel}.`;
    case 'merchant':
      return n === 1
        ? `You filed an earlier ${proposal.subject} row as ${opts.categoryLabel}.`
        : `You filed ${n} earlier ${proposal.subject} rows as ${opts.categoryLabel}.`;
  }
}

export interface ProposalTxn {
  rawDescriptor: string;
  amountCents: number;
}

function isIncomeCategory(categoryId: string): boolean {
  return CATEGORY_BY_ID.get(categoryId)?.group === 'Income';
}
function isSpendCategory(categoryId: string): boolean {
  if (categoryId === 'transfer') return false;
  const cat = CATEGORY_BY_ID.get(categoryId);
  return cat ? cat.group !== 'Income' : false;
}

/**
 * #44 sign guard, against THIS row's sign rather than the history's: an outflow
 * is never proposed into an Income bucket, nor an inflow into a spend bucket.
 */
function signOk(categoryId: string, amountCents: number): boolean {
  if (isSpendCategory(categoryId) && amountCents > 0) return false;
  if (isIncomeCategory(categoryId) && amountCents < 0) return false;
  return true;
}

/** Sorted, de-duplicated payee tokens — a bank may reorder a name's parts. */
function payeeKey(rawDescriptor: string): string {
  const tokens = distinguishingTokens(computeDescriptorSignature(rawDescriptor));
  return [...new Set(tokens)].sort().join(' ');
}

/**
 * The payment CHANNEL a row travelled on ('Venmo', 'Zelle', 'Check', …), or
 * null when the row is an ordinary merchant purchase. Only aggregates have one,
 * which is what scopes the amount basis: an identical amount is evidence about
 * a standing obligation paid through a channel, not about two unrelated shops
 * that happen to charge the same price.
 */
function channelOf(rawDescriptor: string): string | null {
  const m = normalizeMerchant(rawDescriptor);
  return m.aggregate ? m.canonical : null;
}

/** Net intent per transaction, newest first — latest correction wins, undos drop. */
function liveIntents(corrections: readonly LearnedCorrectionInput[]): LearnedCorrectionInput[] {
  const latestByTxn = new Map<string, LearnedCorrectionInput>();
  for (const c of corrections) {
    const cur = latestByTxn.get(c.transactionId);
    if (!cur || c.seq > cur.seq) latestByTxn.set(c.transactionId, c);
  }
  return [...latestByTxn.values()]
    .filter((c) => !c.isUndo && c.toCategoryId !== 'uncategorized')
    .sort((a, b) => b.seq - a.seq);
}

/** The single category a match set agrees on, or null if it does not agree. */
function unanimous(matches: readonly LearnedCorrectionInput[], min: number): string | null {
  if (matches.length < min) return null;
  const categories = new Set(matches.map((m) => m.toCategoryId));
  if (categories.size !== 1) return null;
  return matches[0]!.toCategoryId;
}

/**
 * The category to PROPOSE for this transaction, or null to leave it unproposed.
 *
 * Callers render the result as a suggestion the reader confirms. It must never
 * be written to a transaction without that confirmation — the whole safety
 * argument above depends on a human seeing it first.
 */
export function proposeCategory(
  txn: ProposalTxn,
  corrections: readonly LearnedCorrectionInput[],
): CategoryProposal | null {
  const live = liveIntents(corrections);
  if (live.length === 0) return null;

  // 1) SAME PAYEE — the most specific evidence, and the one that rescues an
  //    aggregate whose transaction id moves every month.
  const targetPayee = payeeKey(txn.rawDescriptor);
  if (targetPayee !== '') {
    const matches = live.filter((c) => payeeKey(c.rawDescriptor) === targetPayee);
    const category = unanimous(matches, PROPOSE_THRESHOLD);
    if (category !== null && signOk(category, txn.amountCents)) {
      return {
        categoryId: category,
        basis: 'payee',
        supportCount: matches.length,
        subject: targetPayee,
        matchedAmountCents: null,
      };
    }
  }

  // 2) REPETITIVE VALUE on the same channel — the owner's literal request.
  const channel = channelOf(txn.rawDescriptor);
  if (channel !== null) {
    const matches = live.filter(
      (c) => c.amountCents === txn.amountCents && channelOf(c.rawDescriptor) === channel,
    );
    // A shared amount is only an identity while the payees do not contradict.
    // A row that names nobody (a bare check number) contradicts nothing.
    const contradicted = matches.some((c) => {
      const theirs = payeeKey(c.rawDescriptor);
      return theirs !== '' && targetPayee !== '' && theirs !== targetPayee;
    });
    const category = contradicted ? null : unanimous(matches, PROPOSE_AMOUNT_THRESHOLD);
    if (category !== null && signOk(category, txn.amountCents)) {
      return {
        categoryId: category,
        basis: 'amount',
        supportCount: matches.length,
        subject: channel,
        matchedAmountCents: txn.amountCents,
      };
    }
  }

  // 3) SAME MERCHANT — the looser canonical key, bucket labels allowed.
  const merchant = normalizeMerchant(txn.rawDescriptor);
  if (canonicalIsProposable(merchant.canonical, merchant.aggregate)) {
    const matches = live.filter((c) => {
      const m = normalizeMerchant(c.rawDescriptor);
      return canonicalIsProposable(m.canonical, m.aggregate) && m.canonical === merchant.canonical;
    });
    const category = unanimous(matches, PROPOSE_THRESHOLD);
    if (category !== null && signOk(category, txn.amountCents)) {
      return {
        categoryId: category,
        basis: 'merchant',
        supportCount: matches.length,
        subject: merchant.canonical,
        matchedAmountCents: null,
      };
    }
  }

  return null;
}
