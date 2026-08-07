/**
 * O.19 — the /accounts "Account cleanup" disclosure.
 *
 * Five cards used to stack above the reader's actual accounts: the combine
 * offers and their blocked reasons, the "continue this account?" candidates,
 * the ambiguous matches, the already-combined disclosure with its Undo, and the
 * #192 advisory duplicate warning. Each is correct on its own; together, on a
 * corpus with several connections at one bank, they are a wall — the owner's
 * report was "looks like a beta website … hide it".
 *
 * HIDE, NEVER DELETE (owner-explicit), and the hiding is bounded by one rule
 * taken from `deleting-a-surface-deletes-the-claims-it-carried.md`: putting a
 * surface behind a tap removes every claim it was the only renderer of. Two of
 * those five carry a claim about a figure printed on this very page — a balance
 * that may be counted twice, and an account that is missing from the list
 * because it was folded into another. So the machinery goes behind the tap and
 * the CLAIM stays on the page, compressed into this one line.
 *
 * Hence the shape below: a constant heading other copy can point a reader at by
 * name, plus a detail clause chosen by MONEY CONSEQUENCE — the strongest thing
 * true of the reader's data leads, and everything else is a count. The order is
 * the failure direction, not the data model's order (L.30's idiom).
 */

/**
 * The section's name. Any copy that sends a reader here must use this string. Defined in
 * `src/lib/engine/account/account-cleanup.ts` and re-exported here, because the copy that needs
 * it lives on both sides of the lib/components boundary — see that file.
 */
export { ACCOUNT_CLEANUP_HEADING } from '@/lib/engine/account/account-cleanup';
import { ACCOUNT_CLEANUP_HEADING } from '@/lib/engine/account/account-cleanup';

/**
 * The blocked reasons that REACH the screen.
 *
 * `already-linked` is deliberately silent — the already-combined card in this
 * same section says it better. The card applies this filter to decide what to
 * render, so the summary line has to apply the SAME one to decide what to
 * count: two filters would let the line promise a block that is not there
 * (`a-guard-must-read-what-it-guards`).
 */
export function visibleBlockedReasons<T extends { kind: string }>(blocked: readonly T[]): T[] {
  return blocked.filter((b) => b.kind !== 'already-linked');
}

export interface ConnectionMattersCounts {
  /**
   * Both-live duplicate connections with an offered direction — the PROVEN double count.
   * `combineEvidence` states it outright: the balance "counts twice everywhere this app adds
   * your accounts up".
   */
  combineOffers: number;
  /**
   * DISTINCT ACCOUNT ROWS across the #192 advisory pairs — never the pair count. The detector
   * is an all-pairs loop with no transitive collapse (`duplicates.ts:268`), so three copies of
   * one account emit THREE pairs; printing that as a money figure would say "3" where the card
   * behind the tap says "One account may be counted twice" (critic P1-1, executed).
   */
  duplicateEntries: number;
  /** "Continue this account?" — a stale row whose balance stops counting twice when confirmed. */
  candidates: number;
  /** Active reconciliations, each with an Undo: an account MISSING from the list below. */
  combined: number;
  /** Stale rows matching more than one live account — no action exists. */
  ambiguities: number;
  /** Already filtered through `visibleBlockedReasons`. */
  blockedReasons: number;
}

export interface ConnectionMattersSummary {
  total: number;
  /** Constant, so other copy can name this control and still be true. */
  heading: string;
  /** The strongest claim true of this reader, plus a count of the rest. */
  detail: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The one line that stays visible. `null` when there is nothing at all — an
 * empty section renders nothing, exactly as the five cards individually did.
 */
export function connectionMattersSummary(c: ConnectionMattersCounts): ConnectionMattersSummary | null {
  // Ordered by EVIDENCE STRENGTH, and every kind that describes a double count SAYS SO.
  //
  // The first cut ordered by "which array is scariest" and gave the money sentence to the
  // advisory pairs — which `transactions.ts:1352` defines as the RESIDUE, the pairs with no
  // offered remedy — while the proven case, two live connections pulling one account, got a
  // procedural "can be combined" with no consequence in it (critic P0-1, executed on the
  // owner's own fixture: net worth $2,000 for $1,000 of real money, and the word "twice"
  // nowhere on the page). Certainty runs offers > advisory, so the lead does too, and none of
  // the three drops the consequence.
  const clauses: readonly [number, string][] = [
    [c.combineOffers, `${plural(c.combineOffers, 'duplicate connection', 'duplicate connections')} counting a balance twice`],
    [c.duplicateEntries, `${plural(c.duplicateEntries, 'entry', 'entries')} that may be the same account, counted twice`],
    [c.candidates, `${plural(c.candidates, 'account', 'accounts')} that may be continuing an old one, counted twice`],
    [c.ambiguities, `${plural(c.ambiguities, 'unclear match', 'unclear matches')}`],
    [c.blockedReasons, `${plural(c.blockedReasons, 'connection note', 'connection notes')}`],
  ];

  const total = clauses.reduce((sum, [n]) => sum + n, 0) + c.combined;
  if (total === 0) return null;

  const lead = clauses.find(([n]) => n > 0);

  // `combined` gets its OWN clause rather than a place in the queue. It is the only explanation
  // for an account the reader connected that is no longer in the list below (the predecessor row
  // is removed, `accounts-list.tsx`), and that claim is EXCLUSIVE with whatever leads — it is
  // owed whether or not anything louder is also true. Folding it into "· N more" is precisely
  // the shape `deleting-a-surface-deletes-the-claims-it-carried` rule 2 forbids (critic P1-3).
  const combinedClause =
    c.combined > 0 ? `${plural(c.combined, 'account', 'accounts')} folded into another` : null;

  const named = (lead?.[0] ?? 0) + c.combined;
  const rest = total - named;
  const parts = [lead?.[1], combinedClause].filter((p): p is string => p !== null && p !== undefined);
  if (rest > 0) parts.push(`${rest} more`);

  return { total, heading: ACCOUNT_CLEANUP_HEADING, detail: parts.join(' · ') };
}
