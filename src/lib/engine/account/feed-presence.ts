import type { ISODate } from '@/lib/dates';

/**
 * Feed presence — deciding when a bank has STOPPED sharing an account we store.
 *
 * Plaid Link's update mode ships with `account_selection_enabled`, so a user can untick an
 * account and the bank simply stops returning it. Nothing in the app ever pruned such a row:
 * it kept its last balance, kept counting toward net worth / cash-needed / /cards, and — because
 * a Plaid row's freshness is graded from its BANK's last sync (#293) — went on reading as
 * recently synced. A permanently frozen figure, vouched for as a live one (TASKS L.14).
 *
 * This module answers ONE question and nothing else: given the rows we hold for a single
 * connection and the account ids that connection just returned, which rows should be stamped
 * as dropped, and which previously-dropped rows have come back?
 *
 * It is deliberately paranoid about what counts as evidence, because the failure directions are
 * wildly asymmetric. A MISSED drop leaves the status quo — a stale row the app has always kept
 * (bad, but the bug we already have). A FALSE drop pulls a real account out of the user's totals
 * on the strength of a garbled HTTP response. So absence is read as evidence only from a
 * payload that is complete and wholly readable — the same "prune only on a clean run" discipline
 * the holdings sweep learned the hard way in #290, where a truncated securities list pruned
 * positions the user still held.
 *
 * Two rules that are NOT obvious and are locked by tests:
 *   • An empty account list never drops anything. "The bank returned nothing" is far more likely
 *     to be an error state than "every account was unticked at once", and mass-dropping a user's
 *     whole net worth on one bad response is the most expensive mistake available here.
 *   • A drop date is stamped ONCE and never re-stamped. The date is the disclosure's factual
 *     claim about WHEN sharing stopped; letting each later sync move it forward would make the
 *     sentence a rolling lie about a fixed past event.
 */

/** One stored row for the connection being reconciled, as the presence check sees it. */
export type FeedPresenceRow = {
  readonly id: string;
  /** The provider's own account id. Null = a row that can never be matched against a feed. */
  readonly providerRef: string | null;
  /** YYYY-MM-DD the feed was first observed to omit this row; null = currently present. */
  readonly feedDroppedAt: string | null;
};

export type FeedPresenceSkipReason =
  /** The response carried no account array at all (garbled/truncated body, schema drift). */
  | 'payload-not-an-array'
  /** A well-formed but empty list. Never read as "everything was unshared". */
  | 'payload-empty'
  /** At least one entry yielded no usable id, so the list cannot be trusted as complete. */
  | 'payload-unreadable-entry';

export type FeedPresenceDecision =
  | { readonly kind: 'skip'; readonly reason: FeedPresenceSkipReason }
  | {
      readonly kind: 'reconcile';
      /** Row ids to stamp with `today` — the feed no longer returns them. */
      readonly drop: readonly string[];
      /** Row ids whose `feedDroppedAt` must be cleared — the feed returns them again. */
      readonly restore: readonly string[];
      /** The date to stamp on every `drop` id. */
      readonly droppedAt: ISODate;
    };

/**
 * @param rows        every row we hold for THIS connection (caller scopes it; a row we cannot
 *                    prove belongs to this connection must not be passed in)
 * @param payloadRefs the account ids the connection just returned, exactly as extracted from the
 *                    response — passed as `unknown` on purpose so the shape guard lives here,
 *                    under test, rather than in the network layer where it cannot be exercised
 * @param today       the calendar date to stamp
 */
export function reconcileFeedPresence(
  rows: readonly FeedPresenceRow[],
  payloadRefs: unknown,
  today: ISODate,
): FeedPresenceDecision {
  if (!Array.isArray(payloadRefs)) return { kind: 'skip', reason: 'payload-not-an-array' };
  if (payloadRefs.length === 0) return { kind: 'skip', reason: 'payload-empty' };

  const present = new Set<string>();
  for (const ref of payloadRefs) {
    // One unreadable entry means the list is not a complete census of the connection, so no
    // absence in it is evidence of anything. Refuse the whole run rather than dropping the rows
    // that happen to sit next to the damage.
    if (typeof ref !== 'string' || ref.length === 0) {
      return { kind: 'skip', reason: 'payload-unreadable-entry' };
    }
    present.add(ref);
  }

  const drop: string[] = [];
  const restore: string[] = [];
  for (const row of rows) {
    // No provider id = nothing to look for in the payload. Its absence from the list is a fact
    // about our own row, not about the bank, so it is never evidence of a drop.
    if (row.providerRef === null || row.providerRef.length === 0) continue;
    if (present.has(row.providerRef)) {
      if (row.feedDroppedAt !== null) restore.push(row.id);
      continue;
    }
    // Absent. Stamp only the first time: the existing date is the truthful one.
    if (row.feedDroppedAt === null) drop.push(row.id);
  }

  return { kind: 'reconcile', drop, restore, droppedAt: today };
}
