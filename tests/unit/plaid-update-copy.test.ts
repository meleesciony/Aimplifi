/**
 * The update-mode flow's user-facing sentences (TASKS L.10 layer 1).
 *
 * Every case here came from a fresh-context critic that read the first version and found
 * the sentence false in some state. They are locked because each one, when wrong, pushes
 * the reader toward connecting a bank they already have — the single action this whole
 * feature exists to make unnecessary.
 */
import { describe, expect, it } from 'vitest';
import {
  UPDATE_PULL_FAILED_AWAY,
  alreadyConnectedFlash,
  cannotReopenMessage,
  linkedForHistoryFlash,
  linkedWithOverlapFlash,
  updatePullFailedMessage,
  updateSuccessFlash,
} from '@/components/finance/plaid-update-copy';

describe('updateSuccessFlash', () => {
  it('never reports a failed pull as a clean result', () => {
    // The #277 class: "0 new transactions" to someone whose bank just refused them reads
    // as a green all-clear over the exact staleness this control was meant to fix.
    const failed = updateSuccessFlash({ bank: 'Chase', added: 0, transactionsFailed: true });
    expect(failed).not.toMatch(/0 new transaction/);
    expect(failed).toMatch(/didn’t return new transactions/);

    const clean = updateSuccessFlash({ bank: 'Chase', added: 0 });
    expect(clean).toMatch(/0 new transactions\./);
  });

  it('scopes its refresh claim to the bank that was actually synced', () => {
    // The flash renders above EVERY account group — other Plaid banks, SimpleFIN, manual
    // rows. The sync touched one item. An unscoped "anything already here was refreshed"
    // told a reader with three connections that the whole page was current
    // (docs/lessons/second-person-copy-scope.md).
    const msg = updateSuccessFlash({ bank: 'Chase', added: 3 });
    expect(msg).toMatch(/Anything already on Chase was refreshed/);
    expect(msg).not.toMatch(/anything already here/i);
  });

  it('instructs rather than asserts about what arrived', () => {
    // An added account can be withheld (unsupported currency), skipped (unmappable type),
    // or never fetched at all (a swallowed /accounts/get failure). "Check the list" is
    // true in every one of those states; "your accounts are listed below" is not.
    const msg = updateSuccessFlash({ bank: 'Chase', added: 1 });
    expect(msg).toMatch(/Check the list below/);
    expect(msg).not.toMatch(/are listed below/);
  });

  it('discloses that a REMOVED account keeps counting, and names a remedy that cannot duplicate', () => {
    // Account selection unticks as well as ticks, and the app never prunes a row whose
    // feed stops returning it: it keeps its last balance, keeps counting, and goes on
    // reading as freshly synced because a Plaid row's freshness comes from its BANK's
    // sync date (#293). The remedy must be the re-tick — "disconnect it and delete it"
    // ends in a second copy of the bank, which is the thing being prevented.
    const msg = updateSuccessFlash({ bank: 'Chase', added: 0 });
    expect(msg).toMatch(/If you removed an account from sharing/);
    expect(msg).toMatch(/keeps counting|stops updating/);
    expect(msg).toMatch(/tick it again/);
    expect(msg).not.toMatch(/disconnect this bank and delete/i);
  });

  it('pluralises honestly', () => {
    expect(updateSuccessFlash({ bank: 'X', added: 1 })).toMatch(/1 new transaction\./);
    expect(updateSuccessFlash({ bank: 'X', added: 2 })).toMatch(/2 new transactions\./);
    expect(updateSuccessFlash({ bank: 'X' })).toMatch(/0 new transactions\./);
  });
});

describe('updatePullFailedMessage', () => {
  it('never says the UPDATE failed — by the time it can render, the update is done', () => {
    const msg = updatePullFailedMessage('Chase');
    expect(msg).toMatch(/Chase was updated/);
    expect(msg).toMatch(/pulling the new data didn’t finish/);
  });

  it('always steers away from reconnecting, which is the duplicate-creating move', () => {
    for (const msg of [updatePullFailedMessage('Chase'), updatePullFailedMessage('Chase', 'Too many syncs — give it a minute and try again.')]) {
      expect(msg).toMatch(/no need to connect the bank again/);
    }
    expect(UPDATE_PULL_FAILED_AWAY).toMatch(/no need to connect it again/);
  });

  it('lets a known reason carry its own remedy instead of contradicting it', () => {
    // "Too many syncs — give it a minute" followed by "tap Sync to bring it in" told the
    // user to do the thing that had just been refused. And after a disconnect in another
    // tab the reason is "that bank isn't connected", where the named control is gone.
    const rateLimited = updatePullFailedMessage('Chase', 'Too many syncs — give it a minute and try again.');
    expect(rateLimited).toMatch(/give it a minute/);
    expect(rateLimited).not.toMatch(/Tap Sync/);

    // With nothing better to say, the generic instruction is still offered.
    expect(updatePullFailedMessage('Chase')).toMatch(/Tap Sync on that bank/);
  });
});

describe('cannotReopenMessage', () => {
  it('names the connection, because two at one bank are otherwise identical', () => {
    const msg = cannotReopenMessage('U.S. Bank', ', connection 2 of 2');
    expect(msg).toMatch(/U\.S\. Bank, connection 2 of 2/);
  });

  it('always ends with a way forward', () => {
    // The previous version stopped at "could not" — on the control the hint had just
    // called the remedy. The escape offered is safe: disconnecting deletes the item row
    // and keeps the accounts, so a later reconnect leaves one live side and one dead one,
    // which the reconciliation flow can combine. It is not a both-live duplicate.
    const msg = cannotReopenMessage('Chase', '');
    expect(msg).toMatch(/disconnect that bank and connect it again/);
    expect(msg).toMatch(/history stay/);
  });

  it('carries a specific reason when there is one', () => {
    expect(cannotReopenMessage('Chase', '', 'Give it a minute and try again.')).toMatch(
      /Give it a minute/,
    );
  });
});

describe('alreadyConnectedFlash — the sentence shown when a link was REFUSED as redundant', () => {
  const chase = { bank: 'Chase', matchedAccountCount: 3 };

  it('says plainly what happened to the connection the user just made', () => {
    // Invariant D9: no structural change is silent, and handing a just-made connection back
    // to Plaid is the most structural thing this app does on its own.
    expect(alreadyConnectedFlash(chase)).toMatch(
      /already have Chase connected.*refreshed that connection instead of adding a second copy/i,
    );
  });

  it('answers the fear the user actually has — that the accounts they ticked went nowhere', () => {
    const msg = alreadyConnectedFlash(chase);
    expect(msg).toMatch(/All 3 accounts that login shares are already here/);
    expect(msg).toMatch(/nothing was added and nothing was lost/);
  });

  it('reads correctly for a single account rather than "1 accounts"', () => {
    const msg = alreadyConnectedFlash({ bank: 'Chase', matchedAccountCount: 1 });
    expect(msg).toMatch(/The account that login shares is already here/);
    expect(msg).not.toMatch(/1 accounts/);
  });

  it('offers the way to share an account the bank has not shown yet', () => {
    // Deliberately the update-mode control, NOT "connect it again" — connecting again is the
    // move that produces the duplicate, and now the move that gets silently refused.
    expect(alreadyConnectedFlash(chase)).toMatch(/Add or fix accounts/);
  });

  it('uses no positional word, because it renders on pages with no connection list at all', () => {
    // The Connect button mounts on /cards, /settings and the dashboard onboarding panel as
    // well as /accounts, and even on /accounts the inline notice sits UNDER the connection
    // list — so "below" named a control that was either absent or above
    // (docs/lessons/second-person-copy-scope.md). Found by a fresh-context critic.
    const msg = alreadyConnectedFlash(chase);
    expect(msg).not.toMatch(/below|above/i);
    expect(msg).toMatch(/open Accounts and use “Add or fix accounts”/);
  });

  it('names an escape for the user the ladder is simply WRONG about', () => {
    // Tier A proves sameness from a shared last-4 plus type, subtype and currency: strong
    // evidence, not certainty. Someone whose real accounts were refused must have a way
    // through, and this one works — disconnecting removes the connection row, after which
    // the same login is no longer redundant and links normally.
    const msg = alreadyConnectedFlash(chase);
    expect(msg).toMatch(/If these aren’t the accounts you just signed in to, open Accounts, disconnect Chase/);
    expect(msg).toMatch(/history stay/);
  });

  it('falls back to a neutral stand-in when the bank never resolved a name', () => {
    expect(alreadyConnectedFlash({ bank: 'that bank', matchedAccountCount: 2 })).toMatch(
      /You already have that bank connected/,
    );
  });
});

describe('linkedWithOverlapFlash — both connections kept, and the overlap said out loud', () => {
  const both = { bank: 'Chase', matchedAccountCount: 1, newAccountCount: 2 };

  it('never reads as a refusal: it states that BOTH connections were kept, and why', () => {
    const msg = linkedWithOverlapFlash(both);
    expect(msg).toMatch(/Both Chase connections were kept/);
    expect(msg).toMatch(/reaches accounts the other one can’t/);
    expect(msg).not.toMatch(/instead of adding/);
  });

  it('discloses the double-count without claiming a total is wrong', () => {
    // The dashboard makes its own disclosure from its own data (#306). This one states the
    // overlap at the moment it is created — it does not assert what any figure now says.
    const msg = linkedWithOverlapFlash(both);
    expect(msg).toMatch(/One account is on both/);
    expect(msg).toMatch(/counted — twice/);
  });

  it('never promises combining, which the state that triggers this message makes impossible', () => {
    // Found by a fresh-context critic: a direction is offerable only when dropping one side
    // strands nothing (combine-connections.ts), and this message renders precisely when two
    // logins each reach an account the other cannot — so BOTH directions strand and /accounts
    // renders a card saying it cannot combine. Ending on that remedy sent the reader to a
    // guaranteed refusal.
    const msg = linkedWithOverlapFlash(both);
    expect(msg).not.toMatch(/combine/i);
    expect(msg).toMatch(/Open Accounts to see which accounts overlap/);
  });

  it('pluralises the overlap', () => {
    const msg = linkedWithOverlapFlash({ bank: 'Chase', matchedAccountCount: 2, newAccountCount: 1 });
    expect(msg).toMatch(/2 accounts are on both/);
    expect(msg).toMatch(/Open Accounts/);
  });

  it('reads correctly when this login reaches exactly one new account', () => {
    const msg = linkedWithOverlapFlash({ bank: 'Chase', matchedAccountCount: 1, newAccountCount: 1 });
    expect(msg).toMatch(/reaches an account the other one can’t/);
  });

  // ---- H.6 / DECISIONS #424 — the deliberate second connection ---------------------------

  describe('linkedForHistoryFlash', () => {
    const one = { bank: 'Chase', matchedAccountCount: 1, combinable: true };

    it('names the duplicate as DELIBERATE — the app has spent a month promising it refuses these', () => {
      // The owner reported duplicate accounts as a bug and this app answered by refusing to
      // create them. A silent second Chase now reads as that bug coming back, so the very
      // first thing this says is that it was asked for.
      expect(linkedForHistoryFlash(one)).toMatch(/on purpose/i);
    });

    it('discloses the double-count, because a wrong figure is never allowed to be silent', () => {
      const msg = linkedForHistoryFlash(one);
      expect(msg).toMatch(/counted — twice/);
    });

    it('test_regression__names_the_control_because_the_cards_default_points_the_other_way', () => {
      // The expensive mistake this sentence prevents: combining the other way round drops the
      // NEW connection and with it every extra month this exercise bought — irreversibly, since
      // combine revokes the dropped Item. H.6c re-ranked `keepRank` on stored depth, so once
      // the background pull lands the prominent button points the right way — but before it
      // lands, depth ties and the default still falls to "linked first wins". This copy is the
      // reader's protection in that window, so it stays specific enough to override a wrong
      // default: "the new one" is not enough; it has to name which button that IS.
      const msg = linkedForHistoryFlash(one);
      expect(msg).toMatch(/combine/i);
      expect(msg).toMatch(/KEEPS the connection you just added/);
      expect(msg).toMatch(/highest-numbered one/);
      // And it must say what the wrong choice costs, not merely which is right.
      expect(msg).toMatch(/would drop it and lose the extra history/);
    });

    it('test_regression__waits_for_the_history_before_sending_anyone_to_combine', () => {
      // Plaid delivers the deep window in the BACKGROUND, and combining revokes the connection
      // fetching it. Both branches must say so, or the instruction is "hang up mid-download".
      for (const combinable of [true, false]) {
        const msg = linkedForHistoryFlash({ ...one, combinable });
        expect(msg).toMatch(/arrive in the background/);
        expect(msg).toMatch(/wait until you can see them/);
      }
    });

    it('test_regression__does_not_promise_combining_when_combining_will_not_be_offered', () => {
      // The old connection still reaches an account this login did not share, so dropping it
      // would strand that account and `combineDuplicateConnections` will not offer the
      // direction. The ONLY direction left drops the connection holding the history — so this
      // branch must send the reader to share the missing accounts first, never to combine now.
      const msg = linkedForHistoryFlash({ ...one, combinable: false });
      expect(msg).toMatch(/combining isn’t offered yet/);
      expect(msg).toMatch(/Add or fix accounts on the NEW connection/);
      // And it must still not lose the instruction that matters if they get there later.
      expect(msg).toMatch(/keeping the NEW one/);
    });

    it('pluralises the accounts that now appear on both connections', () => {
      const msg = linkedForHistoryFlash({ bank: 'Chase', matchedAccountCount: 3, combinable: true });
      expect(msg).toMatch(/Those 3 accounts are now on both/);
    });
  });
});
