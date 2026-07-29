/**
 * Register suggestion ladder (TASKS O.9d, DECISIONS #333) — the inbox's
 * suggestion precedence, mirrored per ROW for the transaction register.
 *
 * The owner's report, live, with screenshots of the register: rows he calls
 * "self explanatory" sitting bare as "Uncategorized", while every proposal the
 * app could make waited in the triage inbox — a tab he was not looking at.
 * O.9b wired the inbox; the register is where he browses.
 *
 * PARITY IS THE LADDER, NOT THE SCOPE. Both surfaces answer the same question —
 * "what does the app think this unfiled row is?" — from the same rungs in the
 * same order, with the same per-rung guards, or a deep link from one to the
 * other becomes a contradiction (docs/lessons/one-question-one-basis…):
 *
 *   1. our pipeline's verdict (rules, learned tiers, keywords) when it has one;
 *   2. else the provider's own persisted guess (L.12, "Plaid's guess") —
 *      NEVER for an aggregate row (the inbox's own rule, group.ts: Zelle /
 *      checks / Venmo group many payees under one canonical, and Plaid's guess
 *      about the channel says nothing about THIS payee — while the history
 *      proposal below is payee/amount-specific by construction, which is
 *      exactly why it may speak where the provider may not);
 *   3. else a proposal from the reader's OWN correction history (#331).
 *
 * The inbox computes the proposal only when 1 and 2 are both empty
 * (server/triage.ts getTriageGroups) — this helper keeps that gate per row.
 * The scopes legitimately differ: the inbox judges a GROUP (unanimity across
 * rows, because one tap there files all of them), the register judges ONE row
 * on its own evidence. A mixed group can therefore show "you decide" on the
 * card while individual rows carry chips — different questions (file N vs file
 * 1), each answered honestly; never two different one-tap categories for the
 * same single row.
 *
 * WHO GETS A CHIP. Only a row still sitting in the 'uncategorized' placeholder:
 * a row that already HAS a category answers the question itself, and the
 * ai-guess provenance confirm (§3.1) is the affordance for blessing those.
 * Transfers are skipped under the inbox's own rule (#165: excluded unless
 * review-pinned), so a row the inbox refuses to ask about is not asked about
 * here either.
 *
 * Pure and deterministic: no I/O, no clock. The caller supplies the pipeline
 * verdict (it owns the rules/tuning) and this module owns only the precedence.
 */
import type { LearnedCorrectionInput } from './learn';
import { normalizeMerchant } from './normalize';
import { type CategoryProposal, type ProposalTxn, proposeCategory } from './propose';

/** Which rung of the ladder produced the chip — rendered to the reader, never hidden. */
export type RegisterSuggestionKind = 'ruleset' | 'provider' | 'history';

export interface RegisterSuggestion {
  kind: RegisterSuggestionKind;
  categoryId: string;
  /** Present only for kind 'history' — the proposal whose evidence sentence the UI renders. */
  proposal: CategoryProposal | null;
}

export interface RegisterSuggestionInput {
  /** The row's stored category, normalized ('uncategorized' when unfiled). */
  currentCategoryId: string;
  isTransfer: boolean;
  /** Inbox parity (#148): a review-pinned transfer still gets asked. */
  reviewPinned: boolean;
  /**
   * The live pipeline verdict for this row — `categorize(...).categoryId`,
   * which is 'uncategorized' when the pipeline abstains. Computed by the
   * caller, who owns the rules + tuning this module must not load.
   */
  pipelineCategoryId: string;
  /** Plaid's persisted own-category guess (L.12), or null. */
  providerCategoryId: string | null;
  txn: ProposalTxn;
}

/**
 * The chip for one register row, or null to leave the row bare. Callers render
 * the result as a suggestion the reader confirms with one tap; it must never be
 * written to the transaction without that confirmation.
 */
export function registerSuggestionFor(
  input: RegisterSuggestionInput,
  corrections: readonly LearnedCorrectionInput[],
): RegisterSuggestion | null {
  if (input.currentCategoryId !== 'uncategorized') return null;
  if (input.isTransfer && !input.reviewPinned) return null;

  if (input.pipelineCategoryId !== 'uncategorized') {
    return { kind: 'ruleset', categoryId: input.pipelineCategoryId, proposal: null };
  }
  // The provider's guess is about the CHANNEL string, so an aggregate row
  // (Venmo/Zelle/check — many payees, one canonical) never shows it: the inbox
  // suppresses it for exactly this reason (group.ts providerUnanimous), and a
  // register chip that filed it would contradict the inbox's history proposal
  // for the same row with a second one-tap category (critic F1).
  const aggregate = normalizeMerchant(input.txn.rawDescriptor).aggregate;
  if (input.providerCategoryId !== null && !aggregate) {
    return { kind: 'provider', categoryId: input.providerCategoryId, proposal: null };
  }
  const proposal = proposeCategory(input.txn, corrections);
  if (proposal !== null) {
    return { kind: 'history', categoryId: proposal.categoryId, proposal };
  }
  return null;
}
