/**
 * Every sentence the Plaid link flow shows a user when a connection is reopened (layer 1) or
 * refused as redundant (layer 2) — TASKS L.10.
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
 * What the /accounts flash says when a fresh link was REFUSED as redundant (layer 2): every
 * account that login shares is already here, so the new connection was handed back to Plaid
 * and the existing one refreshed instead.
 *
 * Three things this has to do at once, and the third is the one that is easy to forget:
 * say plainly what happened (D9 — no structural change is silent); leave no impression that
 * something was lost; and give a way out to the user for whom the app is simply WRONG. The
 * ladder proves sameness from a shared last-4 plus type, subtype and currency, which is
 * strong evidence and not a certainty, so the last sentence names the escape — and it works:
 * disconnecting removes the connection row, after which the same login is no longer redundant
 * and links normally.
 */
export function alreadyConnectedFlash(opts: {
  /** The bank's display name, or a neutral stand-in when it has none. */
  bank: string;
  /** How many accounts were PROVEN to be ones the user already has. Always ≥ 1 here. */
  matchedAccountCount: number;
}): string {
  const n = opts.matchedAccountCount;
  return [
    `You already have ${opts.bank} connected, so we refreshed that connection instead of adding a second copy of it.`,
    // The reassurance is specific rather than "don't worry": it names the number, because the
    // reader's actual fear is that the accounts they just ticked went nowhere.
    n === 1
      ? `The account that login shares is already here, so nothing was added and nothing was lost.`
      : `All ${n} accounts that login shares are already here, so nothing was added and nothing was lost.`,
    // No positional word ("below", "above"). This sentence renders inline under the Connect
    // button, which mounts on /cards, /settings and the dashboard onboarding panel as well as
    // /accounts — pages with no connection list on them at all — and on /accounts itself the
    // inline copy sits UNDER that list, so "below" pointed upwards
    // (docs/lessons/second-person-copy-scope.md). Naming the page works from everywhere.
    `If ${opts.bank} has an account you don’t see yet, open Accounts and use “Add or fix accounts” on that connection.`,
    `If these aren’t the accounts you just signed in to, open Accounts, disconnect ${opts.bank} and connect it again — your accounts and their history stay.`,
  ].join(' ');
}

/**
 * What the /accounts flash says when the new connection OVERLAPS one the user already has but
 * is not redundant — the joint account visible from two logins, which is exactly the case the
 * refusal above must never fire on.
 *
 * Both connections are kept, so this is a disclosure, not a decision. It states the overlap at
 * the moment it is created rather than leaving the user to find one card listed twice later
 * (#299/#306), and it never claims a total is wrong — the dashboard makes its own disclosure
 * from its own data.
 */
export function linkedWithOverlapFlash(opts: {
  bank: string;
  matchedAccountCount: number;
  newAccountCount: number;
}): string {
  const dupes = opts.matchedAccountCount;
  const fresh = opts.newAccountCount;
  return [
    `Connected ${opts.bank}.`,
    `Both ${opts.bank} connections were kept, because this login reaches ${fresh === 1 ? 'an account' : 'accounts'} the other one can’t.`,
    // NOT "until you combine them", and NOT "open Accounts to combine the two connections".
    // Combining is offered only when dropping one side strands nothing
    // (combine-connections.ts), and the case this sentence exists for — two logins that each
    // reach an account the other cannot — is precisely a state where BOTH directions strand,
    // so /accounts renders a card explaining it cannot combine. Promising the remedy that the
    // triggering state guarantees will refuse is worse than promising nothing.
    dupes === 1
      ? `One account is on both, so it may be listed — and counted — twice.`
      : `${dupes} accounts are on both, so they may be listed — and counted — twice.`,
    `Open Accounts to see which accounts overlap and what you can do about it.`,
  ].join(' ');
}

/**
 * The outcome of a deliberate "get the full two years" link (TASKS H.6, DECISIONS #424):
 * the new connection reaches exactly the same accounts as one the user already has, and was
 * kept anyway, because only a brand-new Item can carry Plaid's 730-day window.
 *
 * Three things have to be said and none can be dropped. That the duplicate is DELIBERATE —
 * the app has spent a month telling this owner it refuses to duplicate his accounts, so a
 * silent second Chase would read as the bug he reported. That the accounts count twice UNTIL
 * he combines them, which is a wrong figure he is owed a warning about (invariant D9). And
 * WHICH ONE TO KEEP: the new connection is the one holding the history, so combining the
 * wrong way round throws away everything this link was for.
 *
 * Unlike `linkedWithOverlapFlash` this one does promise the remedy, because here the remedy is
 * guaranteed to be offered rather than guaranteed to refuse: `combineDuplicateConnections`
 * offers a direction when dropping that side strands nothing, and the old connection reaching
 * nothing the new one cannot is precisely what "wholly redundant" established.
 */
export function linkedForHistoryFlash(opts: {
  bank: string;
  matchedAccountCount: number;
  /** Whether combine will offer the direction that KEEPS this connection — see LinkOutcome. */
  combinable: boolean;
}): string {
  const n = opts.matchedAccountCount;
  const noun = n === 1 ? 'account' : 'accounts';
  return [
    `Connected ${opts.bank} a second time — on purpose.`,
    `Plaid fixes how far back a connection can see when it is created, so the only way to reach two years of history is a new connection, and it comes back with the same ${noun} as the old one.`,
    n === 1
      ? `That account is now on both connections, so it will be listed — and counted — twice until you combine them.`
      : `Those ${n} accounts are now on both connections, so they will be listed — and counted — twice until you combine them.`,
    // Plaid delivers the deep window in the BACKGROUND — the initial historical pull lands over
    // later syncs, not in the round-trip the user just watched — and combining revokes the
    // connection that is fetching it. Telling someone to combine immediately is telling them to
    // hang up mid-download, which is the one way to finish this flow with less history than they
    // started the day with.
    `Give it a little while first: the older transactions arrive in the background, so wait until you can see them before finishing.`,
    // NAMES THE CONTROL. H.6c gave `keepRank` a depth rule, so once the deeper history has
    // LANDED, the card's prominent button proposes keeping this connection. But depth is
    // measured on STORED feed rows — deliberately, never on a promise about what a feed might
    // deliver — so before the background pull finishes, the depth rule ITSELF prefers the old
    // side (the new side's stored floor is recent, or nothing at all; a critic executed both
    // states) and the default points at the old connection. The card now carries its own
    // depth note beside that button (`combineDepthNote`), and this sentence stays specific
    // enough to override the default too, naming the ordinal rather than saying "the new one"
    // and trusting the reader to map that onto two near-identical buttons. /accounts orders
    // connections oldest-first, so the one just added is always the highest number.
    opts.combinable
      ? `Then open Accounts and combine the two — choosing the option that KEEPS the connection you just added, which is the highest-numbered one at ${opts.bank}. The other option would drop it and lose the extra history.`
      : // Combine offers a direction only when dropping that side strands nothing, and the old
        // connection is still reaching something this login did not share — so the only
        // direction on offer would drop the connection the history is on. Naming the repair
        // (share the rest through the new connection) beats sending the reader to a control
        // that will either refuse or quietly undo their afternoon.
        `One thing first: the old connection still reaches an account you didn’t share this time, so combining isn’t offered yet. Use Add or fix accounts on the NEW connection to share the rest, then combine the two — keeping the NEW one.`,
  ].join(' ');
}

/**
 * The same message on the OAuth return page, which knows an item id but not the bank's
 * name, and where the user is not standing next to the Sync control.
 */
export const UPDATE_PULL_FAILED_AWAY =
  'Your bank connection was updated, but pulling the new data didn’t finish. Open Accounts and tap Sync on that bank. Nothing was duplicated, and there’s no need to connect it again.';
