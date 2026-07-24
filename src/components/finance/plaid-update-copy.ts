/**
 * Every sentence the update-mode flow shows a user (TASKS L.10 layer 1).
 *
 * A pure module owns these rather than the component, for the reason
 * `card-duplicate-view.ts` and `continued-accounts-view.ts` do: two of them make claims
 * about money that can be wrong in a state nobody rendered by hand — one says a balance
 * "keeps counting", another says what did and didn't happen after a Link session — and a
 * claim that can be wrong is a claim that needs a test.
 */

/** What the /accounts flash says after an update-mode session that pulled successfully. */
export function updateSuccessFlash(opts: {
  /** The bank's display name, or a neutral stand-in when it has none. */
  bank: string;
  added?: number;
  transactionsFailed?: boolean;
}): string {
  const added = opts.added ?? 0;
  return [
    `Updated ${opts.bank}.`,
    // NOT "any accounts you added are listed below" — that asserts an outcome this code
    // cannot see. An account in an unsupported currency is withheld from the groups, one
    // with a type the mapper can't read is skipped and audited, and a failed /accounts/get
    // is swallowed upstream. An instruction is true in all of those states; a claim is not.
    `Check the list below for anything you added. Anything already on ${opts.bank} was refreshed, not copied.`,
    // Account selection REMOVES as well as adds, and removal is not symmetric. The app
    // never deletes a row whose feed stops returning it, so it keeps its last balance and
    // keeps counting toward every total — and, because a Plaid row's freshness is graded
    // from its BANK's last sync (#293), it goes on reading as recently synced. Silence
    // would leave someone believing they had taken an account out of their totals when
    // they had only stopped its updates: a stale figure vouched for as a live one.
    // The remedy named here is deliberately the RE-TICK, not "disconnect and delete":
    // disconnecting to delete one row is the move that ends in a second copy of the bank.
    `If you removed an account from sharing, its row stays here with the balance it last had and stops updating — reopen Add or fix accounts on ${opts.bank} and tick it again to bring it back.`,
    // A failed pull is NOT zero transactions and must never read as a clean result — the
    // same rule the Sync button follows.
    opts.transactionsFailed
      ? 'Your bank didn’t return new transactions this time, so anything new is still missing.'
      : `${added} new transaction${added === 1 ? '' : 's'}.`,
  ].join(' ');
}

/**
 * What to say when the link token could not be minted at all — an expired or revoked
 * item, a Plaid outage, a network failure. Names the connection, because two at one bank
 * are indistinguishable otherwise (#296), and always ends with a way forward: the previous
 * version stopped at "could not", on a control the hint had just called the remedy.
 *
 * The escape it offers is safe: disconnecting DELETES the item row while keeping the
 * accounts and their history, so reconnecting afterwards leaves one live side and one
 * dead one — which the reconciliation flow can combine. It is not the both-live duplicate
 * that connecting on TOP of a working bank produces.
 */
export function cannotReopenMessage(bank: string, which: string, reason?: string): string {
  return [
    `Couldn’t reopen ${bank}${which}.`,
    reason,
    'If it keeps failing, disconnect that bank and connect it again — your accounts and their history stay.',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * What to say when the follow-on data pull fails.
 *
 * The distinction this sentence exists to preserve: by the time it can be shown, the Link
 * session has already finished at the bank, so the UPDATE succeeded and only the pull did
 * not. Calling it a failed update would be false — and would push the reader toward
 * connecting the bank a second time, which is the one action that creates the duplicate
 * this whole feature exists to prevent.
 */
export function updatePullFailedMessage(bank: string, reason?: string): string {
  return [
    `${bank} was updated, but pulling the new data didn’t finish.`,
    // When there is a reason it carries its own remedy ("give it a minute and try again",
    // "that bank isn't connected"), and appending "tap Sync" on top of those produced
    // advice that contradicted the reason — including pointing at a control that had just
    // been removed. So the generic instruction appears only when nothing better is known.
    reason ?? 'Tap Sync on that bank to bring it in.',
    'Nothing was duplicated, and there’s no need to connect the bank again.',
  ].join(' ');
}

/**
 * The same message on the OAuth return page, which knows an item id but not the bank's
 * name, and where the user is not standing next to the Sync control.
 */
export const UPDATE_PULL_FAILED_AWAY =
  'Your bank connection was updated, but pulling the new data didn’t finish. Open Accounts and tap Sync on that bank. Nothing was duplicated, and there’s no need to connect it again.';
