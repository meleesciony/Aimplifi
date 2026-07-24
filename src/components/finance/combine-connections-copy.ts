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
 */

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
  return `Combining disconnects ${dropLabel} and continues ${which} on ${keepLabel}. The old account and its history stay on this page — from the day ${keepLabel} started pulling, that connection is the one counted, so the old copies of those days stop being counted twice.`;
}

/** The two-step confirm. Names the irreversible half in the prompt itself. */
export function combineConfirmPrompt(keepLabel: string, dropLabel: string): string {
  return `Disconnect ${dropLabel} and continue on ${keepLabel}? Disconnecting can’t be undone from this page.`;
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
    return `Done — ${combined} ${noun} now ${combined === 1 ? 'counts' : 'count'} once, and the duplicate connection is disconnected.`;
  }
  if (combined === 0) {
    return `The duplicate connection was disconnected, but combining didn’t finish, so nothing has been linked yet. You’ll see a “Combine” offer for the pair on this page — try it there. (${failures.join(
      ' ',
    )})`;
  }
  return `Partly done: ${combined} ${noun} now ${
    combined === 1 ? 'counts' : 'count'
  } once, and the duplicate connection is disconnected — but ${failures.length} didn’t link. You’ll see a “Combine” offer for the rest on this page. (${failures.join(
    ' ',
  )})`;
}
