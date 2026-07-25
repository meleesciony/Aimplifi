/**
 * link-collision.ts — Layer 2 of the account-identity design
 * (`docs/ACCOUNT_IDENTITY_ARCHITECTURE.md` §4): decide, BEFORE any account row is written,
 * whether a fresh Plaid link is really a re-pull of a connection the user already has.
 *
 * THE OWNER'S ACTUAL COMPLAINT, verbatim (2026-07-24): *"Why in the heck are you allowed to make
 * 2 of the same accounts… When I try to link same account again, it just refreshes."* He is right,
 * and everything shipped before this — telling the copies apart (#296/#297/#298), disclosing the
 * double-count (#299, #306), combining an existing pair (#304) — treats the symptom. This module
 * is the half that stops it happening.
 *
 * Layer 1 (#301, "Add or fix accounts" → Plaid Link update mode) already makes the common path
 * structurally incapable of duplicating: existing accounts come back with their existing
 * `account_id`s and take the update branch. This is the BACKSTOP for the user who takes the
 * "Connect a new bank" door anyway, which is the door most people will take.
 *
 * PURE. No Plaid client, no Prisma, no I/O — the caller fetches, this decides. That matters here
 * more than usual, because the action this licenses (`/item/remove` on the item just created) is
 * irreversible from the app's side, and a rule that can be executed in a unit test is a rule that
 * can be argued with.
 *
 * WHAT IT WILL NOT DO. It never merges, never rewrites an existing row, and never decides that two
 * accounts are the same on anything softer than the identity ladder's PROVEN verdict — which means
 * Plaid's `persistent_account_id`, or a matching last-4 with matching type, subtype and currency
 * (`identity.ts` tiers P and A). A shared name, a shared balance, or a shared institution alone
 * decides nothing. The spouse's card at the same bank, and a Roth beside a Traditional, are both
 * "not proven" and both keep their own connection — invariant D3/D8.
 */
import { compareAccountIdentity, type IdentityAccount } from '@/lib/engine/account/identity';

/** One live connection the user already has, with the accounts it currently carries. */
export interface ExistingConnection {
  /** Plaid's `item_id` for the connection. */
  readonly itemId: string;
  /** Human name for the copy ("Chase"); may be null on a connection linked before #288. */
  readonly institutionName: string | null;
  readonly accounts: readonly IdentityAccount[];
}

/** One account the NEW link returned, keyed so the caller can report which ones matched. */
export interface IncomingAccount {
  /** Plaid's `account_id` for this row in the NEW item — the caller's handle, never compared. */
  readonly ref: string;
  readonly identity: IdentityAccount;
}

/** A proven pairing, kept for disclosure: the app must be able to say WHY it refused to duplicate. */
export interface CollisionMatch {
  readonly incomingRef: string;
  readonly existingRef: string;
  /** The ladder's own words ('same persistent account id', 'same last-4 …'). */
  readonly reasons: readonly string[];
}

export type LinkCollision =
  /**
   * Nothing proven. Either the user has no other connection at this bank, or this really is a
   * different login (personal vs business) — the design's case B. Keep both, say nothing.
   */
  | { readonly kind: 'none' }
  /**
   * At least one account in the new link is PROVEN to be an account the user already has through
   * another live connection. The new item is redundant: discard it and refresh the existing one.
   */
  | {
      readonly kind: 'already-connected';
      readonly itemId: string;
      readonly institutionName: string | null;
      readonly matches: readonly CollisionMatch[];
      /** Incoming accounts NOT proven to exist already — what a refresh still needs to pick up. */
      readonly unmatchedIncomingRefs: readonly string[];
    };

/**
 * Decide what a just-exchanged Plaid item actually is.
 *
 * `existing` must contain only the user's OTHER LIVE connections — never the item just created
 * (the ladder would veto it anyway on the same-connection rule, but relying on that would be
 * relying on a veto to do a caller's job), and never a disconnected one, whose accounts are no
 * longer being pulled and therefore cannot be double-counting anything.
 *
 * Selection when more than one existing connection matches: the one with the MOST proven matches,
 * ties broken by `itemId` so the answer is deterministic rather than dependent on query order. A
 * user in that state already has a duplicate among their existing connections; refreshing the
 * fullest match is the choice that leaves the least behind, and L.6/#304's combine path is what
 * resolves the rest.
 */
export function detectLinkCollision(
  incoming: readonly IncomingAccount[],
  existing: readonly ExistingConnection[],
): LinkCollision {
  const candidates = existing
    .map((conn) => {
      const matches: CollisionMatch[] = [];
      const claimed = new Set<string>();
      for (const inc of incoming) {
        for (const have of conn.accounts) {
          // One incoming row may prove-match at most ONE existing row, and an existing row may be
          // claimed once. Without this a single account could inflate the match count against a
          // connection carrying near-identical rows, and the count is what picks the winner.
          const haveRef = identityKey(have);
          if (claimed.has(haveRef)) continue;
          const verdict = compareAccountIdentity(inc.identity, have);
          if (verdict.verdict !== 'same') continue;
          claimed.add(haveRef);
          matches.push({ incomingRef: inc.ref, existingRef: haveRef, reasons: verdict.reasons });
          break;
        }
      }
      return { conn, matches };
    })
    .filter((c) => c.matches.length > 0)
    .sort((a, b) => b.matches.length - a.matches.length || a.conn.itemId.localeCompare(b.conn.itemId));

  const best = candidates[0];
  if (!best) return { kind: 'none' };

  const matchedIncoming = new Set(best.matches.map((m) => m.incomingRef));
  return {
    kind: 'already-connected',
    itemId: best.conn.itemId,
    institutionName: best.conn.institutionName,
    matches: best.matches,
    unmatchedIncomingRefs: incoming.map((i) => i.ref).filter((r) => !matchedIncoming.has(r)),
  };
}

/**
 * A stable handle for an existing account row inside this decision. `persistentAccountId` is the
 * only cross-Item stable id Plaid offers and is absent at most institutions, so this falls back to
 * the connection + last-4 + type. It is used ONLY to stop one row being claimed twice within a
 * single call — never persisted, never compared for identity, never shown to a user.
 */
function identityKey(a: IdentityAccount): string {
  return a.persistentAccountId ?? `${a.connectionId ?? '?'}:${a.mask ?? '?'}:${a.type}`;
}
