/**
 * feed-dropped-view.ts — the DISCLOSURE for an account its bank has stopped sharing (TASKS L.14).
 *
 * The defect: Plaid Link's update mode ships with `account_selection_enabled`, so a user can untick
 * an account. `upsertPlaidAccounts` only ever creates or updates, so nothing noticed — the row kept
 * its last balance, kept counting toward net worth, cash-needed and /cards, and kept LOOKING current,
 * because a Plaid row's freshness is graded from its BANK's last sync (#293) and the bank was still
 * syncing perfectly. A permanently frozen figure, vouched for as a live one. Slice 2 of L.10 shipped
 * a sentence in the post-update success flash naming the re-tick as the remedy, but a transient flash
 * is not a fix for a figure that stays wrong forever.
 *
 * DISCLOSE, NEVER SILENTLY ADJUST — the same stance as #192/#221/#289/#299, and for a sharper reason
 * here. Removing the row from the totals would be its own money claim, and its failure direction is
 * the expensive one: an unticked card whose statement is still genuinely owed would vanish out of
 * cash-needed, and the app would stop telling someone to pay a bill they still owe. Keeping the row
 * over-funds slightly; dropping it silently risks a missed payment. Only the user knows whether the
 * account still exists, so the app's job is to surface the decision with both remedies attached, not
 * to guess it. What changes is what the app CLAIMS: the row stops reading as fresh (health.ts
 * `not_shared`), says plainly that it is frozen and still counted, and becomes deletable — the
 * standing refusal ("the next sync would just bring it back") is false for a row the feed no longer
 * carries.
 *
 * PURE and framework-free. It owns every string the disclosure renders, per the
 * `card-duplicate-view.ts` precedent, and takes its labels already painted.
 *
 * WHERE THE READER IS STANDING is a required argument, not an inference — the L.15 lesson, which
 * cost three critic cycles. "The row below" is true on /accounts, which lists the account and carries
 * the Delete and re-link controls, and false on the dashboard, which carries neither. So there is one
 * builder per surface and no shared sentence that quietly assumes a list is present. Likewise no
 * sentence claims a figure has moved, because none has.
 */
import { renderSafe } from './render-safe';
import { formatISODate, type ISODate } from '@/lib/dates';
import { isLiabilityType } from '@/lib/engine/transactions/query';
import { cents, formatCents } from '@/lib/money';

/** The dashboard banner. Distinct from the row note below: an e2e that cannot tell the two apart
 *  would pass while only one of the two surfaces speaks. */
export const FEED_DROPPED_TESTID = 'feed-dropped-banner';
export const FEED_DROPPED_ROW_TESTID = 'account-feed-dropped';

export interface DroppedAccountInput {
  readonly id: string;
  /** The account name exactly as the surface paints it. */
  readonly name: string;
  readonly mask: string | null;
  /** CHECKING | SAVINGS | CREDIT | INVESTMENT | LOAN — decides how the frozen number is labelled. */
  readonly type: string;
  /** YYYY-MM-DD the feed was first observed to omit it (Account.feedDroppedAt). */
  readonly feedDroppedAt: ISODate;
  readonly currentBalanceCents: number;
}

/** "Chase Sapphire ••0977" — the same painted identity every sentence here uses. */
function label(a: DroppedAccountInput): string {
  const name = renderSafe(a.name);
  return a.mask ? `${name} ••${a.mask}` : name;
}

/**
 * The frozen number, labelled by what it MEANS rather than printed bare (the
 * verbatim-value-not-verbatim-meaning lesson). Balances are stored positive and the type carries the
 * sign, so "$4,210.55" beside a credit card reads as money the reader HAS when it is money they OWE.
 */
function frozenAmount(a: DroppedAccountInput): string {
  const amount = formatCents(cents(a.currentBalanceCents));
  return isLiabilityType(a.type) ? `${amount} owed` : amount;
}

/**
 * One account's line: what stopped, when, and what the number beside it now is. Shared by every
 * surface because it makes no claim about position or available controls.
 */
export function feedDroppedLine(a: DroppedAccountInput): string {
  return `${label(a)} — your bank stopped sharing this account on ${formatISODate(
    a.feedDroppedAt,
    'long',
  )}. The last balance we saw was ${frozenAmount(a)}, and it has not changed since.`;
}

/**
 * The sentence that keeps the totals honest. Deliberately position-free: it names the RELATIONSHIP
 * ("wherever Aimplifi adds up your accounts") instead of a place on a page, so it would stay true
 * on any surface that adopts it.
 *
 * TWO CORRECTIONS FROM THE CRITICS, both recorded rather than quietly dropped:
 *  · An earlier version of this comment said the wording holds "in an email" — a channel this
 *    slice never wired. Copy is not disclosure until something renders it, and describing an
 *    unbuilt surface as covered is how a gap gets marked closed. The weekly digest and the
 *    reminder email are OPEN (TASKS L.18), not served by this string.
 *  · "Adds up" is accurate for the totals and incomplete for the two places the frozen number is
 *    not summed but *depended on*: the payment account, which is the base of the whole cash-needed
 *    projection, and a card's own obligation. Those are disclosed where they happen — in the
 *    cash-needed engine's `assumptions` — because a sentence on /accounts cannot qualify a figure
 *    the reader is looking at on the dashboard.
 */
export const FEED_DROPPED_STILL_COUNTED =
  'That last balance is still counted wherever Aimplifi adds up your accounts, because only you can tell us whether the account still exists.';

/**
 * The ways out — which depend on whether the CONNECTION still exists (critic F-4).
 *
 * "Reopen that bank's Add or fix accounts" names a real control, but `PlaidUpdateButton` renders
 * once per PlaidItem: disconnect the bank and the button is gone while the row and its stamp
 * remain, deliberately, because the history is the user's. Sending a first-timer to hunt for a
 * button that is not on the page is the rule-0 failure this repo keeps writing down, so liveness
 * is a REQUIRED argument rather than an assumption — the same reason `numbersRows` had to become
 * one in L.15.
 */
export function feedDroppedRemedies(connectionLive: boolean): string {
  return connectionLive
    ? 'If you unticked it while reconnecting, reopen that bank’s “Add or fix accounts” and tick it again — it will start updating from there. If the account is closed or you meant to remove it, you can now delete the row, which also removes its history.'
    : 'That bank is no longer connected here, so there is nothing left to re-tick: connect it again to start this account updating, or delete the row, which also removes its history.';
}

export interface FeedDroppedNotice {
  readonly title: string;
  readonly body: string;
  readonly lines: readonly string[];
  /** Where the controls actually are. Null on surfaces that carry them already. */
  readonly whereToFix: string | null;
}

/**
 * The dashboard notice. This surface lists no accounts and carries no Delete or reconnect control,
 * so it names the ROUTE rather than pointing at anything, and it names every affected account rather
 * than printing a count — a count computed over something other than what will render is exactly the
 * L.15 defect, and enumerating removes the possibility entirely.
 */
export function feedDroppedDashboardNotice(
  accounts: readonly DroppedAccountInput[],
  /**
   * How many PARTNER accounts are frozen inside the household figures (critic F-3). A count, never
   * names or amounts: those belong to another member, and the viewer's sharing consent does not
   * extend to narrating them here. The viewer cannot fix a partner's connection, so the sentence
   * says who can — silence would leave a joint total resting on a stale number with no signal at
   * all. Zero on the personal scope.
   */
  householdFrozenCount = 0,
): FeedDroppedNotice | null {
  const total = accounts.length + householdFrozenCount;
  if (total === 0) return null;
  const partnerNote =
    householdFrozenCount === 0
      ? null
      : householdFrozenCount === 1
        ? 'One of them belongs to someone else in your household — only they can reconnect it.'
        : `${householdFrozenCount} of them belong to someone else in your household — only they can reconnect them.`;
  return {
    title: total === 1 ? 'One account stopped updating' : `${total} accounts stopped updating`,
    body: partnerNote ? `${FEED_DROPPED_STILL_COUNTED} ${partnerNote}` : FEED_DROPPED_STILL_COUNTED,
    lines: accounts.map(feedDroppedLine),
    whereToFix:
      accounts.length === 0
        ? null
        : `Open Accounts to fix or remove ${accounts.length === 1 ? 'it' : 'them'}.`,
  };
}

/**
 * The /accounts row note. This surface paints the account's name and mask on the line directly
 * above, so the note opens with the EVENT and does not repeat the identity — the dashboard, which
 * lists nothing, is the surface that needs naming. (Critic P2-1: the previous version's comment
 * claimed exactly this while the code did the opposite, printing the name twice in two different
 * mask glyphs — `····4321` in the heading against `••4321` in the note.)
 *
 * `connectionLive` is REQUIRED — see `feedDroppedRemedies`.
 */
export function feedDroppedRowNote(a: DroppedAccountInput, connectionLive: boolean): string {
  return `Your bank stopped sharing this account on ${formatISODate(
    a.feedDroppedAt,
    'long',
  )}. The last balance we saw was ${frozenAmount(a)}, and it has not changed since. ${FEED_DROPPED_STILL_COUNTED} ${feedDroppedRemedies(connectionLive)}`;
}
