import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_CLEANUP_HEADING,
  connectionMattersSummary,
  visibleBlockedReasons,
  type ConnectionMattersCounts,
} from '@/components/finance/connection-matters-view';
import {
  bankIdentityRefreshedFlash,
  combineSuccessFlash,
  duplicateReconsideredFlash,
} from '@/components/finance/combine-connections-copy';
import { linkedForHistoryFlash } from '@/components/finance/plaid-update-copy';

const none: ConnectionMattersCounts = {
  combineOffers: 0,
  duplicateEntries: 0,
  candidates: 0,
  combined: 0,
  ambiguities: 0,
  blockedReasons: 0,
};

describe('O.18 — the Account cleanup summary line', () => {
  it('renders nothing at all when there is nothing to clean up', () => {
    // The five cards each returned null when empty; collapsing them must not put an empty
    // disclosure on a tidy reader's page.
    expect(connectionMattersSummary(none)).toBeNull();
  });

  it('every kind that describes a double count SAYS the double count', () => {
    // Critic P0-1: the first cut gave the money sentence to the advisory pairs and a purely
    // procedural "can be combined" to the PROVEN case, so a reader whose net worth was $2,000
    // for $1,000 of real money saw the word "twice" nowhere on the page.
    for (const c of [
      { ...none, combineOffers: 1 },
      { ...none, duplicateEntries: 2 },
      { ...none, candidates: 1 },
    ]) {
      expect(connectionMattersSummary(c)!.detail).toMatch(/twice/);
    }
    expect(connectionMattersSummary({ ...none, combineOffers: 1 })!.detail).toBe(
      '1 duplicate connection counting a balance twice',
    );
  });

  it('leads with the PROVEN double count, not the advisory one', () => {
    // The two are mutually exclusive per pair (`transactions.ts:1352` filters any pair with an
    // offer out of `duplicates`), so the advisory set is the residue — the pairs with no proven
    // remedy. Certainty runs offers > advisory, so the lead does too.
    const s = connectionMattersSummary({ ...none, duplicateEntries: 2, combineOffers: 1 })!;
    expect(s.detail).toBe('1 duplicate connection counting a balance twice · 2 more');
  });

  it('counts ENTRIES, never pairs — three copies of one account are not three balances', () => {
    // Critic P1-1: `detectDuplicateAccounts` is an all-pairs loop with no transitive collapse,
    // so three copies emit THREE pairs. Fed pair counts, this line said "3 balances" while the
    // card behind the tap said "One account may be counted twice".
    expect(connectionMattersSummary({ ...none, duplicateEntries: 3 })!.detail).toBe(
      '3 entries that may be the same account, counted twice',
    );
  });

  it('drops the "more" clause when one kind is all there is', () => {
    expect(connectionMattersSummary({ ...none, blockedReasons: 2 })!.detail).toBe('2 connection notes');
  });

  it('falls through the order kind by kind', () => {
    expect(connectionMattersSummary({ ...none, candidates: 2 })!.detail).toBe(
      '2 accounts that may be continuing an old one, counted twice',
    );
    expect(connectionMattersSummary({ ...none, ambiguities: 2 })!.detail).toBe('2 unclear matches');
  });

  it('says one of each thing in the singular', () => {
    expect(connectionMattersSummary({ ...none, duplicateEntries: 1 })!.detail).toBe(
      '1 entry that may be the same account, counted twice',
    );
    expect(connectionMattersSummary({ ...none, ambiguities: 1 })!.detail).toBe('1 unclear match');
    expect(connectionMattersSummary({ ...none, blockedReasons: 1 })!.detail).toBe('1 connection note');
  });

  it('an account MISSING from the list is named however loud the rest is', () => {
    // Critic P1-3, executed on all three reachable mixes. The predecessor row is removed from the
    // groups below, so this card is the only explanation for an account the reader connected and
    // can no longer see. It is exclusive with whatever leads — owed either way — so it gets its
    // own clause instead of a place in the queue (`deleting-a-surface-…` rule 2).
    expect(connectionMattersSummary({ ...none, combineOffers: 1, combined: 1 })!.detail).toBe(
      '1 duplicate connection counting a balance twice · 1 account folded into another',
    );
    expect(connectionMattersSummary({ ...none, duplicateEntries: 2, combined: 1 })!.detail).toBe(
      '2 entries that may be the same account, counted twice · 1 account folded into another',
    );
    expect(connectionMattersSummary({ ...none, candidates: 1, combined: 2 })!.detail).toBe(
      '1 account that may be continuing an old one, counted twice · 2 accounts folded into another',
    );
  });

  it('stands alone when a fold is the only thing that happened', () => {
    expect(connectionMattersSummary({ ...none, combined: 1 })!.detail).toBe('1 account folded into another');
  });

  it('counts the rest without double-counting either named clause', () => {
    const s = connectionMattersSummary({
      combineOffers: 3,
      duplicateEntries: 2,
      candidates: 1,
      combined: 1,
      ambiguities: 1,
      blockedReasons: 4,
    })!;
    expect(s.total).toBe(12);
    // 12 total − 3 lead − 1 folded = 8 unnamed.
    expect(s.detail).toBe(
      '3 duplicate connections counting a balance twice · 1 account folded into another · 8 more',
    );
  });

  it('always names the section, so other copy can point a reader at it', () => {
    expect(connectionMattersSummary({ ...none, combined: 1 })!.heading).toBe(ACCOUNT_CLEANUP_HEADING);
  });
});

describe('the blocked-reason filter is one predicate, not two', () => {
  it('drops already-linked, which the combined card says better', () => {
    const blocked = [{ kind: 'already-linked' }, { kind: 'dismissed' }, { kind: 'bank-id-missing' }];
    expect(visibleBlockedReasons(blocked).map((b) => b.kind)).toEqual(['dismissed', 'bank-id-missing']);
  });

  it('counts nothing when every reason is the silent one', () => {
    // The regression this guards: the summary line offering "2 connection notes" over a card that
    // renders none, sending the reader to look for something not behind the tap.
    expect(visibleBlockedReasons([{ kind: 'already-linked' }, { kind: 'already-linked' }])).toHaveLength(0);
  });
});

describe('every sentence that sends a reader back to the Combine control names the section', () => {
  // `deleting-a-surface-deletes-the-claims-it-carried`: a remedy that names a control the reader
  // cannot find is the L.14 F-4 defect. These sentences were written when the card was the first
  // thing on the page; behind a tap, "on this page" alone is a scavenger hunt. Locked by the
  // CONSTANT, so renaming the section cannot leave a stale instruction behind.
  it('the partial-combine flashes point at it', () => {
    expect(combineSuccessFlash(0, ['a bank refused'])).toContain(ACCOUNT_CLEANUP_HEADING);
    expect(combineSuccessFlash(2, ['a bank refused'])).toContain(ACCOUNT_CLEANUP_HEADING);
  });

  it('the bank-identity flash points at it', () => {
    expect(bankIdentityRefreshedFlash(1)).toContain(ACCOUNT_CLEANUP_HEADING);
  });

  it('the deepen flow’s CLOSING instruction points at it, in both its branches', () => {
    // H.6's whole point is the last step: a second connection is only worth having once the two
    // are combined. Both branches end by sending the reader to that control, so both must name
    // where it is — the branch that says "combining isn't offered yet" included, because its
    // instruction resumes there after the reader shares the rest.
    const combinable = linkedForHistoryFlash({ bank: 'Chase', matchedAccountCount: 2, combinable: true });
    const blocked = linkedForHistoryFlash({ bank: 'Chase', matchedAccountCount: 2, combinable: false });
    expect(combinable).toContain(ACCOUNT_CLEANUP_HEADING);
    expect(blocked).toContain(ACCOUNT_CLEANUP_HEADING);
  });

  it('the un-dismiss flash points at it', () => {
    // This one lived inline in the page's JSX, outside every copy lock, which is how it would
    // have been the one sentence left naming a control the reader can no longer find.
    expect(duplicateReconsideredFlash()).toContain(ACCOUNT_CLEANUP_HEADING);
  });

  it('a clean combine does NOT — there is nothing left to go back to', () => {
    // The failure direction that matters here is the false errand: a finished combine that sent
    // the reader to open a section holding no offer for them.
    expect(combineSuccessFlash(2, [])).not.toContain(ACCOUNT_CLEANUP_HEADING);
  });
});
