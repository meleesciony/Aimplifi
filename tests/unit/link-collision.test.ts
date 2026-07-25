/**
 * `detectLinkCollision` — Layer 2 of the account-identity design (TASKS L.10 slice 3, second half).
 *
 * The owner, 2026-07-24: *"Why in the heck are you allowed to make 2 of the same accounts… When I
 * try to link same account again, it just refreshes."* Every prior slice made the duplicate
 * legible or removable; this is the one that refuses to create it.
 *
 * ABSTENTION FIRST, and in the majority — the lesson from every context-carrying feature in this
 * repo. What this function licenses is `/item/remove` on a connection the user just authorised, so
 * a wrong 'already-connected' is worse than a missed one: a missed one leaves a duplicate the app
 * already knows how to disclose (#306) and combine (#304), while a wrong one throws away a real
 * connection the user meant to add. Every test below that ends in `kind: 'none'` is therefore
 * load-bearing, not filler.
 *
 * The two cases that MUST survive, both owner-stated: a spouse's card at the same bank with a
 * different last-4, and a Roth beside a Traditional at the same broker.
 */
import { describe, expect, it } from 'vitest';

import { detectLinkCollision, type ExistingConnection, type IncomingAccount } from '@/lib/engine/account/link-collision';
import type { IdentityAccount } from '@/lib/engine/account/identity';

const CHASE = 'ins_56';

function acct(over: Partial<IdentityAccount> = {}): IdentityAccount {
  return {
    provider: 'plaid',
    institutionId: CHASE,
    institutionName: 'Chase',
    mask: '0977',
    type: 'CREDIT',
    subtype: 'credit card',
    currency: 'USD',
    persistentAccountId: null,
    connectionId: 'item-old',
    ...over,
  };
}

/** The new item's rows always carry the NEW connection id — never the one being compared against. */
function incoming(ref: string, over: Partial<IdentityAccount> = {}): IncomingAccount {
  return { ref, identity: acct({ connectionId: 'item-new', ...over }) };
}

function connection(itemId: string, accounts: IdentityAccount[]): ExistingConnection {
  return { itemId, institutionName: 'Chase', accounts };
}

describe('detectLinkCollision — refuses to create the duplicate (TASKS L.10 layer 2)', () => {
  it('THE reported case: the same card re-linked through a second Link session', () => {
    // Plaid mints a new account_id per Item, so the row is new BY CONSTRUCTION. Tier A proves it
    // is the same real card: same last-4, type, subtype and currency at one institution.
    const result = detectLinkCollision(
      [incoming('new-1')],
      [connection('item-old', [acct()])],
    );
    expect(result.kind).toBe('already-connected');
    if (result.kind !== 'already-connected') throw new Error('unreachable');
    expect(result.itemId).toBe('item-old');
    expect(result.institutionName).toBe('Chase');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].incomingRef).toBe('new-1');
    // The evidence is carried out, because the app has to be able to say WHY it refused.
    expect(result.matches[0].reasons.join(' ')).toMatch(/0977|last-4/i);
    expect(result.unmatchedIncomingRefs).toEqual([]);
  });

  it("a SPOUSE'S card at the same bank is not a duplicate — different last-4 vetoes", () => {
    // The owner's own distinction: "husband and wife sharing a card with diff numbers" must both
    // keep existing. Within one provider AND one institution, a differing last-4 is a hard veto.
    const result = detectLinkCollision(
      [incoming('new-1', { mask: '4412' })],
      [connection('item-old', [acct({ mask: '0977' })])],
    );
    expect(result).toEqual({ kind: 'none' });
  });

  it('a Roth is never proven to be a Traditional at the same broker', () => {
    const result = detectLinkCollision(
      [incoming('new-1', { type: 'INVESTMENT', subtype: 'roth', mask: '5351' })],
      [connection('item-old', [acct({ type: 'INVESTMENT', subtype: 'traditional', mask: '5351' })])],
    );
    expect(result).toEqual({ kind: 'none' });
  });

  it('a retirement account with an UNKNOWN subtype abstains rather than guessing', () => {
    // identity.ts refuses to prove an INVESTMENT pair whose subtype it cannot read — the exact
    // rung L.9 was missing when it offered to fold a Roth into a Traditional.
    const result = detectLinkCollision(
      [incoming('new-1', { type: 'INVESTMENT', subtype: null, mask: '5351' })],
      [connection('item-old', [acct({ type: 'INVESTMENT', subtype: null, mask: '5351' })])],
    );
    expect(result).toEqual({ kind: 'none' });
  });

  it('a different bank is never a collision, whatever the numbers look like', () => {
    const result = detectLinkCollision(
      [incoming('new-1', { institutionId: 'ins_127989', institutionName: 'Bank of America' })],
      [connection('item-old', [acct()])],
    );
    expect(result).toEqual({ kind: 'none' });
  });

  it('no existing connections at all — the ordinary first link', () => {
    expect(detectLinkCollision([incoming('new-1')], [])).toEqual({ kind: 'none' });
  });

  it('an empty new link decides nothing', () => {
    expect(detectLinkCollision([], [connection('item-old', [acct()])])).toEqual({ kind: 'none' });
  });

  it('a missing last-4 on either side proves nothing — absence is not evidence', () => {
    expect(
      detectLinkCollision([incoming('new-1', { mask: null })], [connection('item-old', [acct()])]),
    ).toEqual({ kind: 'none' });
    expect(
      detectLinkCollision([incoming('new-1')], [connection('item-old', [acct({ mask: null })])]),
    ).toEqual({ kind: 'none' });
  });

  it("Plaid's persistent id proves it even when the last-4 is absent", () => {
    const result = detectLinkCollision(
      [incoming('new-1', { mask: null, persistentAccountId: 'pai-xyz' })],
      [connection('item-old', [acct({ mask: null, persistentAccountId: 'pai-xyz' })])],
    );
    expect(result.kind).toBe('already-connected');
  });

  it('reports what the refresh still has to pick up — a genuinely new account in the same link', () => {
    // The "select all" case: one account already connected, one the user is adding for the first
    // time. It is still a re-pull — update mode returns BOTH — and the caller needs to know the
    // second one is not yet held.
    const result = detectLinkCollision(
      [incoming('new-1'), incoming('new-2', { mask: '8123', type: 'CHECKING', subtype: 'checking' })],
      [connection('item-old', [acct()])],
    );
    expect(result.kind).toBe('already-connected');
    if (result.kind !== 'already-connected') throw new Error('unreachable');
    expect(result.matches.map((m) => m.incomingRef)).toEqual(['new-1']);
    expect(result.unmatchedIncomingRefs).toEqual(['new-2']);
  });

  it('one incoming row can never claim two existing rows, nor two rows claim one', () => {
    // The match COUNT picks which connection to refresh, so an unbounded pairing could let a
    // single account outvote a connection that genuinely holds more of them.
    const result = detectLinkCollision(
      [incoming('new-1')],
      [connection('item-old', [acct(), acct()])],
    );
    expect(result.kind).toBe('already-connected');
    if (result.kind !== 'already-connected') throw new Error('unreachable');
    expect(result.matches).toHaveLength(1);
  });

  it('picks the connection with the MOST proven matches', () => {
    const shared = { mask: '8123', type: 'CHECKING', subtype: 'checking' } as const;
    const result = detectLinkCollision(
      [incoming('new-1'), incoming('new-2', shared)],
      [
        connection('item-thin', [acct()]),
        connection('item-fat', [acct({ connectionId: 'item-fat' }), acct({ connectionId: 'item-fat', ...shared })]),
      ],
    );
    expect(result.kind).toBe('already-connected');
    if (result.kind !== 'already-connected') throw new Error('unreachable');
    expect(result.itemId).toBe('item-fat');
    expect(result.matches).toHaveLength(2);
  });

  it('breaks a tie deterministically, so the same input never picks a different connection', () => {
    const a = detectLinkCollision(
      [incoming('new-1')],
      [connection('item-b', [acct({ connectionId: 'item-b' })]), connection('item-a', [acct({ connectionId: 'item-a' })])],
    );
    const b = detectLinkCollision(
      [incoming('new-1')],
      [connection('item-a', [acct({ connectionId: 'item-a' })]), connection('item-b', [acct({ connectionId: 'item-b' })])],
    );
    expect(a).toEqual(b);
    if (a.kind !== 'already-connected') throw new Error('unreachable');
    expect(a.itemId).toBe('item-a');
  });

  it('never touches a demo or manual row — invariant D8', () => {
    expect(
      detectLinkCollision(
        [incoming('new-1', { provider: 'demo' })],
        [connection('item-old', [acct({ provider: 'demo' })])],
      ),
    ).toEqual({ kind: 'none' });
  });

  it('a differing currency is not the same account', () => {
    expect(
      detectLinkCollision(
        [incoming('new-1', { currency: 'CAD' })],
        [connection('item-old', [acct({ currency: 'USD' })])],
      ),
    ).toEqual({ kind: 'none' });
  });
});
