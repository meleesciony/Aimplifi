/**
 * Who owns a transaction row: the feed that delivered it, or the reader who
 * typed it. One basis, because two surfaces already need this answer and a
 * second derivation is how they come to disagree.
 *
 * Extracted in O.15 slice 7 from `getTransactionDetail` (server/transactions.ts),
 * where it had been reasoned about once already and correctly:
 *
 *   The ROW decides, not the account. The first cut asked
 *   `account.provider === 'manual'`, but `addManualTransaction` and the CSV
 *   import both accept ANY account the reader owns — so a hand-typed row on a
 *   Plaid-linked card was attributed to the bank (O.13b critic cycle 2, F3).
 *   `providerRef` is the row-level fact: a feed delivered this row and gave it
 *   an id, or nobody did.
 *
 * The demo dataset is the one deliberate exception: its rows carry no
 * `providerRef` (they are seeded, not fetched) while presenting themselves as a
 * bank feed, and the demo account is fenced against manual entry (#244), so no
 * hand-typed row can exist there to be mislabelled.
 *
 * Two consumers today, and they want the same fact for different reasons:
 *   - the provenance line ("Appears on your … statement as …"), which is a claim
 *     about where the text came from, and
 *   - the status control (O.13g), which asks whether the reader may write
 *     `status` at all — see `actions.ts`. A feed that delivered a row is the
 *     authority on whether its charge has cleared, so an 'entered' row is the set
 *     the reader may answer for.
 *
 * Both readings are "did a feed put this here", which is why they share a basis
 * rather than each testing their own field.
 *
 * NOT a claim about overwriting. An earlier draft justified the status refusal by
 * saying a feed "re-asserts status on every sync"; a critic falsified it, and the
 * correction is worth keeping because the intuition is so natural. Plaid's
 * `/transactions/sync` is a CURSOR DELTA — an unmodified settled row is never
 * re-sent (plaid.ts) — and SimpleFIN refetches only a ~5-day window
 * (simplefin.ts), so for the commonest bank row (settled, older than a week)
 * nothing would come along and overwrite a local edit. The refusal stands on
 * AUTHORITY, not on a re-assertion loop: the bank knows whether its charge
 * cleared and we do not. (The one place a feed really does overwrite is a split
 * PIECE, whose status is pushed from its parent on every sync — which is why
 * `actions.ts` refuses pieces outright rather than reading their own origin.)
 */

/** 'bank' — a feed delivered this row and keeps re-asserting it. 'entered' — the app owns it. */
export type RowOrigin = 'bank' | 'entered';

/** The stored facts the answer is derived from. Both required: a defaulted
 *  `providerRef` would read as 'entered' and hand the reader a write on a row
 *  the feed will overwrite, which is the direction that produces a silent
 *  no-op instead of an honest refusal. */
export interface RowOriginFacts {
  /** The feed's own id for this row; null when no feed delivered it. */
  providerRef: string | null;
  /** The owning account's provider slug ('plaid' | 'simplefin' | 'manual' | 'demo' | …). */
  accountProvider: string;
}

export function rowOrigin(t: RowOriginFacts): RowOrigin {
  return t.providerRef !== null || t.accountProvider === 'demo' ? 'bank' : 'entered';
}
