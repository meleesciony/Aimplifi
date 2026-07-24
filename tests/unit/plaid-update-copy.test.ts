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
  cannotReopenMessage,
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
