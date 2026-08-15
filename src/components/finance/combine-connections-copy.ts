/**
 * Every user-facing sentence for the "two connections are pulling the same account" card
 * (TASKS L.6 / L.10). Pure + separately tested, like `plaid-update-copy.ts`, because these
 * sentences describe a MONEY change (a balance stops counting) and a step that cannot be undone
 * from inside the app (a bank disconnect). A wrong sentence here either understates what the
 * user is about to do or overstates what the app fixed.
 *
 * The rules these strings hold to:
 *   * Name each connection with the EXACT label the page paints beside it, so "the one I tapped"
 *     is never ambiguous (the #299 finding: copy must quote the heading the reader can see).
 *   * Say what is kept, not just what changes. Nothing here deletes a transaction, and a reader
 *     who fears losing history will not tap.
 *   * Separate the reversible half from the irreversible half explicitly. Combining is undoable;
 *     reconnecting a disconnected bank means going through Link again.
 *   * Never claim a total was corrected. State what stops counting; the figures on the page are
 *     what they are once it does.
 *   * Any sentence that sends the reader BACK to the Combine control names the collapsed section
 *     it now lives in, by importing the heading rather than retyping it (O.19). "on this page"
 *     was true while the card was the first thing on the page and became a scavenger hunt the
 *     moment it went behind a tap — the L.14 F-4 defect, where a remedy named a control the
 *     reader could not find.
 */

import { ACCOUNT_CLEANUP_HEADING } from '@/lib/engine/account/account-cleanup';
import { formatISODate, isoDate } from '@/lib/dates';

export interface CombineAccountLabel {
  name: string;
  mask: string | null;
}

/** "CREDIT CARD ····0977" — the same shape /cards and /accounts paint. */
export function accountLabel(a: CombineAccountLabel): string {
  return a.mask ? `${a.name} ····${a.mask}` : a.name;
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

/**
 * The connection's name as the page paints it beside the Sync / Disconnect buttons — "Chase ·
 * connection 1 of 4". Built from the SAME `connectionOrdinals` the connection list uses, so the
 * label in this card is verifiable a few inches down the page rather than being card-local
 * jargon (the #296 rule). Falls back to the bank alone when there is only one connection to it.
 */
export function connectionLabel(
  institution: string | null,
  ordinal: { ordinal: number; sameBankCount: number } | undefined,
): string {
  const bank = (institution ?? '').trim() || 'this bank';
  if (!ordinal || ordinal.sameBankCount <= 1) return bank;
  return `${bank} · connection ${ordinal.ordinal} of ${ordinal.sameBankCount}`;
}

/** The card's own title. Bank-agnostic: each proposal names its own bank underneath, because two
 *  proposals can sit at two different banks (critic P2-7). */
export function combineCardTitle(count: number): string {
  return count === 1 ? 'Two connections are pulling the same account' : 'Connections pulling the same accounts';
}

export function combineHeading(institution: string | null): string {
  return institution
    ? `Two ${institution} connections are pulling the same account`
    : 'Two connections are pulling the same account';
}

/** What the two connections have in common, and why the app believes it. */
export function combineEvidence(accounts: CombineAccountLabel[], reasons: readonly string[]): string {
  const which = joinList(accounts.map(accountLabel));
  const why = reasons.length > 0 ? ` Matched on ${joinList([...reasons])}.` : '';
  // Two precision rules, both from critics: "any transactions both connections pulled" rather
  // than "every transaction total" (a connection linked minutes ago may have pulled nothing yet),
  // and no claim about "what's due" — nothing is due on a duplicated CHECKING account.
  return `${which} ${accounts.length === 1 ? 'arrives' : 'arrive'} through both connections, so ${
    accounts.length === 1 ? 'its balance counts' : 'their balances count'
  } twice everywhere this app adds your accounts up, and again in any transactions both connections pulled.${why}`;
}

/** Exactly what the button does, in the order it happens. */
export function combineOutcome(keepLabel: string, dropLabel: string, accounts: CombineAccountLabel[]): string {
  const which = joinList(accounts.map(accountLabel));
  // What this may NOT claim (critic P0-1, executed): that nothing is lost. The two rows are split
  // by a date, so one side's copy of a shared day is dropped — that is how the double-count ends.
  // The handover is placed just before the surviving connection's own history begins, so what
  // falls away is the OLD connection's copies of days the live one also has. Say that, rather
  // than the flat "nothing is deleted" the first version claimed.
  // U.13 / U.17: the split is no longer total. A day neither side can be
  // shown to have covered in full is released to both. This author has no
  // claimEnd (labels only), so it must not locate that day at last-used,
  // at a "changeover", or at "the day keep started pulling" (H.6's cutover
  // is the day BEFORE successor-start; the overlap is not in "those days").
  // The keep-rule stands as its own sentence.
  return `Combining disconnects ${dropLabel} and continues ${which} on ${keepLabel}. The old account and its history stay on this page — from the day ${keepLabel} started pulling, that connection is the one counted, so the old copies of those days stop being counted twice. Separately, both connections keep any day neither can be shown to have covered in full, so something from that day can appear twice.`;
}

/** The two-step confirm. Names the irreversible half in the prompt itself. */
export function combineConfirmPrompt(keepLabel: string, dropLabel: string): string {
  return `Disconnect ${dropLabel} and continue on ${keepLabel}? Disconnecting can’t be undone from this page.`;
}

/**
 * The depth caveat, rendered beside the button it describes (TASKS H.6c critic P1). The ranking
 * prefers the deeper feed once its history has LANDED, but it cannot know that a just-created
 * 730-day connection is still mid-pull — at that moment its stored floor is recent (or nothing),
 * the tie legitimately resolves toward the old side, and the prominent button proposes revoking
 * the connection that is still downloading. Only the reader knows why they created the second
 * connection, so the card states what each side has actually pulled and lets that reader stop.
 * Null when the choice carries no depth risk: dropping the shallower side, or two sides with
 * nothing stored on either.
 */
export function combineDepthNote(
  keepLabel: string,
  dropLabel: string,
  keepEarliestTxnDate: string | null,
  dropEarliestTxnDate: string | null,
): string | null {
  const fmt = (d: string) => formatISODate(isoDate(d), 'long');
  if (dropEarliestTxnDate === null) {
    if (keepEarliestTxnDate === null) return null; // nothing stored on either side — no depth claim to make
    return `${dropLabel} hasn’t stored any transactions yet. If you added it on purpose — for example to pull more history — wait until its transactions appear before combining, because this option would disconnect it before they arrive.`;
  }
  if (keepEarliestTxnDate === null || dropEarliestTxnDate < keepEarliestTxnDate) {
    return `${dropLabel} has pulled transactions back to ${fmt(dropEarliestTxnDate)}${
      keepEarliestTxnDate === null
        ? `, while ${keepLabel} hasn’t stored any yet`
        : `, while ${keepLabel} only reaches back to ${fmt(keepEarliestTxnDate)}`
    }. This option disconnects the connection holding the older history — if you re-linked this bank to get more history, pick the other option instead.`;
  }
  return null;
}

/** The half that cannot be undone from inside the app — stated before the tap, never after. */
export function combineReversibilityNote(dropLabel: string): string {
  return `You can undo the combine here afterwards, which puts both rows back to counting separately. Reconnecting ${dropLabel} is not something this page can undo — you would add that bank again from “Connect a bank”.`;
}

/** Why the other direction isn't offered: it would freeze accounts that are not duplicates. */
export function combineStrandedNote(dropLabel: string, strandedAccountNames: readonly string[]): string {
  return `Keeping ${dropLabel} instead isn’t offered here, because disconnecting the other connection would stop ${joinList(
    [...strandedAccountNames],
  )} from updating, and ${strandedAccountNames.length === 1 ? 'that account isn’t' : 'those accounts aren’t'} a duplicate of anything.`;
}

/** The flash after the action. Never reports a partial result as a clean one. */
/** Appended when the bank was removed here but Plaid never confirmed the revoke. */
export function combineRevokeWarning(dropLabel: string): string {
  return ` ${dropLabel} was removed from Aimplifi, but the bank didn’t confirm it revoked access — check your connections in that bank’s app if you want to be sure.`;
}

export function combineSuccessFlash(combined: number, failures: readonly string[]): string {
  const noun = combined === 1 ? 'account' : 'accounts';
  if (failures.length === 0) {
    // U.13: "counts once" is about the ACCOUNT, so it inherits the transaction claim, and
    // that is no longer true on the one changeover day the boundary keeps on both sides.
    // The balance half is unconditionally true, so the flash says that and points at the
    // card, where the fuller explanation already lives — a flash is not the place to teach
    // the exception, but it may not deny it either.
    return `Done — ${combined} ${noun} now ${combined === 1 ? 'has' : 'have'} one balance instead of two, and the duplicate connection is disconnected.`;
  }
  if (combined === 0) {
    return `The duplicate connection was disconnected, but combining didn’t finish, so nothing has been linked yet. You’ll see a “Combine” offer for the pair under “${ACCOUNT_CLEANUP_HEADING}” on this page — try it there. (${failures.join(
      ' ',
    )})`;
  }
  // U.16 (critic): the success branch above was requalified by U.13 and this one
  // was not, so the same function made opposite claims about the same rule — and
  // this is the branch a reader reaches when something already went wrong. Same
  // wording as the success branch: the BALANCE half is unconditionally true, the
  // "counts once" half is not, on the one changeover day.
  return `Partly done: ${combined} ${noun} now ${
    combined === 1 ? 'has' : 'have'
  } one balance instead of two, and the duplicate connection is disconnected — but ${failures.length} didn’t link. You’ll see a “Combine” offer for the rest under “${ACCOUNT_CLEANUP_HEADING}” on this page. (${failures.join(
    ' ',
  )})`;
}

// ---------------------------------------------------------------------------
// Why there is NO Combine button (owner-reported 2026-07-24: "Not there").
// ---------------------------------------------------------------------------

/**
 * The reader is looking at two rows that plainly look like one card. If the app will not offer to
 * merge them, silence is the wrong answer — it reads as "nothing shipped", which is exactly what
 * the owner concluded. Each sentence below says what the app concluded and, where there is one,
 * what would change it.
 */
export function combineBlockedHeading(institution: string | null, lookalike: string): string {
  const bank = (institution ?? '').trim();
  return bank
    ? `Two ${bank} connections both list ${lookalike}`
    : `Two connections both list ${lookalike}`;
}

export function combineBlockedReason(
  kind:
    | 'bank-id-missing'
    | 'different-bank'
    | 'different-kind'
    | 'strands'
    | 'ambiguous'
    | 'unproven'
    | 'dismissed'
    | 'already-linked',
  opts: { strandedAccountNames?: readonly string[] } = {},
): string {
  switch (kind) {
    case 'bank-id-missing':
      return 'We won’t offer to combine them yet, because we don’t have the bank’s own ID stored for both connections — and matching on the bank’s NAME alone can put two different banks together. Fetching it takes one tap.';
    case 'different-bank':
      return 'The bank’s own IDs say these two connections are at different banks, so we won’t offer to combine them.';
    case 'different-kind':
      return 'The two accounts differ in kind — the type, sub-type or currency isn’t the same — so we won’t treat them as one account.';
    case 'strands':
      return `Combining would mean disconnecting a connection that also feeds ${joinList([
        ...(opts.strandedAccountNames ?? []),
      ])}, and that account isn’t a duplicate of anything — it would stop updating. So neither direction is offered.`;
    case 'ambiguous':
      return 'One of these rows matches more than one account on the other connection, so nothing here is proven — picking one would risk folding the wrong account.';
    case 'unproven':
      return 'Nothing stored on these two rows proves they are the same account — most often there is no last-4 on one of them — so this stays a suggestion, not an action.';
    case 'dismissed':
      return 'You told us these are not the same account, so we stopped offering to combine them. If that was wrong, you can put the offer back.';
    case 'already-linked':
      return 'These two are already combined, so there is nothing left to do here.';
  }
}

/** What the reader can do about it, when there is something. */
export function combineBlockedActionLabel(kind: string): string | null {
  if (kind === 'bank-id-missing') return 'Get the bank’s ID';
  if (kind === 'dismissed') return 'Offer it again';
  return null;
}

/**
 * A pair the reader had dismissed is back in play. Lives here rather than inline in the page so
 * it sits inside the same lock as the other sentences that send a reader to the Combine control
 * (O.19) — an instruction naming a collapsed section is exactly the kind of claim that goes stale
 * silently when it is the only copy of itself.
 */
export function duplicateReconsideredFlash(): string {
  return `Back in play — if they are the same account, the Combine option is under “${ACCOUNT_CLEANUP_HEADING}” on this page.`;
}

export function bankIdentityRefreshedFlash(updated: number): string {
  return updated > 0
    ? `Got it — ${updated} ${updated === 1 ? 'connection' : 'connections'} identified. If they are the same account, the Combine option is under “${ACCOUNT_CLEANUP_HEADING}” on this page now.`
    : 'Your bank didn’t return an ID for those connections just now. Nothing changed — try again in a few minutes, or tap Sync on each connection first.';
}
