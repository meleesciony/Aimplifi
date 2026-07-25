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

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * TASKS L.18 — the surfaces that print a figure derived from a frozen account
 *
 * L.14 disclosed the freeze on /accounts and the dashboard, and disclosed the two DEPENDENT cases
 * in the cash-needed engine's `assumptions`. Only the dashboard hero renders `assumptions`, so
 * /cards, the reminder email, the weekly digest, web push, the Ask answer and /coach all kept
 * printing figures built on a stopped balance with nothing said. (The comment that claimed
 * otherwise shipped inside `cash-needed/engine.ts`; it is corrected there in the same slice.)
 *
 * WHAT IS ACTUALLY WRONG WITH A FROZEN CARD — checked against `buildObligation`, not assumed, and
 * it is not what L.14's sentence said. That sentence read "Its figures here are based on the last
 * balance we saw," which is true only on the ESTIMATE path. When a statement exists, the engine
 * reads the statement's balance, minimum and due date and never touches `currentBalanceCents` — so
 * the sentence named a dependency the figure does not have, while missing the two that bite:
 *
 *   · `paymentsAppliedCents` comes from CardPayment rows against that statement, and those stop
 *     arriving with the feed — so a payment the reader has ALREADY MADE is not subtracted, and the
 *     app asks for money that is no longer owed.
 *   · no new statement arrives either, so once the current one passes its due date the engine keeps
 *     carrying it ("Due date has passed — treated as due today").
 *
 * One claim covers both paths and both mechanisms, because it describes the FEED rather than any
 * particular field: nothing that has happened on the card since the drop is in these figures.
 *
 * THREE THINGS ARE REQUIRED ARGUMENTS, each because guessing it is a shipped defect elsewhere:
 *  · `role` — whether the qualified number is a FIGURE the reader weighs or an INSTRUCTION they
 *    act on. L.14's whole stance was argued over figures and shipped the instruction case broken
 *    (`failure-direction-is-per-role-not-per-value.md`).
 *  · `nextStep` — what this surface can honestly point at. An email controls no position and holds
 *    no button; a push body has no room at all (L.15).
 *  · the row LABELS — passed in already painted by the caller, so the disclosure can never name a
 *    card differently from the line the reader is looking at.
 *
 * Every builder returns `null`/`[]` when there is nothing honest to say, and every one of them is
 * resolved against the rows the surface ACTUALLY prints — a claim about a computed set is checked
 * against that set, never against its input (the L.15 cycle-2 finding).
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */

/** /cards: the note under a frozen card's own amounts. */
export const FROZEN_CARD_TESTID = 'card-frozen';
/** /cards: the qualifier on the one instruction this page gives. */
export const FROZEN_FIRST_ACTION_TESTID = 'do-this-first-frozen';
/** /coach: the note beside a figure computed from a frozen balance. */
export const FROZEN_COACH_TESTID = 'coach-frozen-note';
/** /coach: the same, on the runway card, which reads the CASH side rather than the portfolio. */
export const FROZEN_RUNWAY_TESTID = 'runway-frozen-note';
/** /cards: the note qualifying an all-clear rather than a figure. */
export const FROZEN_ALL_CLEAR_TESTID = 'cards-frozen-all-clear';

/**
 * Whether the number being qualified is something the reader WEIGHS or something they ACT on.
 *
 * A total containing a stale balance is a figure — the reader can discount it. "Pay $6,679.68 by
 * Saturday" built on one is an instruction, and its failure is money moved wrongly: too little and
 * the card carries interest, too much and cash leaves that was already sent. Only the instruction
 * form carries an action guard, and the guard names the one control that exists in every state a
 * message can render in — the card or account itself, at the bank.
 */
export type FrozenFigureRole = 'figure' | 'instruction';

/**
 * What this surface can honestly point at. A fact about the SURFACE, so it is never defaulted.
 *  · `accounts-route` — the reader is in the app and /accounts can be named as a route (never as a
 *    position: "below" is false the moment the layout changes or the list is empty).
 *  · `open-app` — an email or a page with no such control: name the app, and nothing inside it that
 *    the reader cannot see from here.
 *  · `partner` — the row belongs to another household member, so the reader has no control over
 *    it at all: their /accounts does not list that connection. Naming one anyway is the L.14
 *    critic F-4 defect (a remedy pointing at a control that does not exist in the state the
 *    message renders in), and it is why liveness became a required argument there.
 *  · `nothing` — a push body, or a line that already sits beside a step naming the same fix.
 */
export type FrozenNextStep = 'accounts-route' | 'open-app' | 'partner' | 'nothing';

function nextStepClause(nextStep: FrozenNextStep, plural: boolean): string {
  switch (nextStep) {
    case 'accounts-route':
      return ` Accounts shows the connection and how to fix or remove ${plural ? 'them' : 'it'}.`;
    case 'open-app':
      return ` Open Aimplifi to see the connection and how to fix ${plural ? 'them' : 'it'}.`;
    case 'partner':
      return ` Only the household member who owns ${plural ? 'them' : 'it'} can reconnect ${
        plural ? 'them' : 'it'
      }.`;
    case 'nothing':
      return '';
  }
}

/**
 * WHOSE account a frozen row is — which decides the SUBJECT of the sentence, whether there is an
 * imperative at all, and which remedy is reachable.
 *
 * REQUIRED on every row, from critic P1-1: the first cut hardcoded `role: 'instruction'` and
 * printed "Your bank stopped sharing … Check the card with your bank before paying" over a
 * PARTNER's shared card — an imperative addressed to a reader who is not the one paying, naming a
 * bank they have no relationship with, immediately followed by "only the household member who owns
 * it can reconnect it". That is slice-8 critic F-2 (a second-person money claim on a partner's card
 * invites a double payment), which /cards honours a hundred lines above and abandoned here.
 *
 * `'unknown'` exists because one caller genuinely cannot answer: the cash-needed ENGINE is pure and
 * is handed a household-MERGED account list with no ownership on it, so at household scope it
 * cannot tell whose card it is holding. Rather than let it assert "your bank" over a partner's
 * card, it says "the bank" — true either way. Inventing a `false` default there is precisely the
 * silent-failure this file keeps arguing against; a third state that names the ignorance is honest,
 * and the day the assembler learns ownership this value has one obvious place to be improved.
 */
export type FrozenOwnership = 'reader' | 'partner' | 'unknown';

/** A card this surface is printing, labelled exactly as the surface paints it. */
export interface FrozenCardRow {
  readonly cardId: string;
  /** The card's painted label, identity suffix included. Sanitized here so a plain-text channel
   *  and the page agree on what the reader is being shown (the L.15 invisible-name residual). */
  readonly label: string;
  /** YYYY-MM-DD — a row is only passed in when it IS frozen, so this is never null. */
  readonly frozenSince: string;
  /** True when no statement exists, so the amount asked for is derived from the frozen balance
   *  itself. Changes the claim, so it is carried rather than inferred. */
  readonly isEstimated: boolean;
  readonly ownership: FrozenOwnership;
}

/**
 * The subject clause. "Your bank" is the READER's bank; on a partner's shared card it is not, and
 * with several frozen accounts it may be several banks (critic P3-3 — the old copy said "your
 * bank" and "the connection" while pluralising only the pronoun, so a reader who found one broken
 * connection stopped looking).
 */
/**
 * Which next step is honest for a set of rows (critic P1-3).
 *
 * `'unknown'` stopped at the SUBJECT in the first cut: the sentence said "the bank" and then went on
 * to point at /accounts, which is only the reader's own connections. A caller that cannot say whose
 * account it is cannot say the reader can fix it either, so it points at nothing — on the dashboard,
 * the one surface that renders those assumptions, the frozen banner beside them already names the
 * route for the accounts that really are the reader's.
 */
function resolveStep(
  ownership: readonly FrozenOwnership[],
  requested: FrozenNextStep,
): FrozenNextStep {
  if (ownership.every((o) => o === 'partner')) return 'partner';
  if (ownership.some((o) => o === 'unknown')) return 'nothing';
  return requested;
}

function stoppedSharing(count: number, ownership: readonly FrozenOwnership[]): string {
  const allReaders = ownership.every((o) => o === 'reader');
  const who = allReaders ? 'Your' : 'The';
  return count > 1 ? `${who} banks stopped sharing` : `${who} bank stopped sharing`;
}

/**
 * How to name a set of rows when two of them PAINT IDENTICALLY.
 *
 * The L.15 finding, and the shape #298 was filed for: the owner's own screen held three cards all
 * called "CREDIT CARD". Manufacturing an identifier ("1. CREDIT CARD") is what that lesson forbids;
 * when two rows cannot be told apart, the honest move is to say so.
 */
function nameSet(labels: readonly string[]): string {
  const unique = Array.from(new Set(labels));
  if (labels.length > 1 && unique.length < labels.length) {
    // No count of how many share a name (critic P3-4): with four rows over two labels "two of them
    // share a name" is simply wrong, and the point of this branch is that they cannot be told apart
    // — inventing a tally about them is the same manufacturing the L.15 rule forbids.
    return unique.length === 1
      ? `all of them named “${unique[0]}”`
      : `${unique.join(', ')} — some of them share a name`;
  }
  return labels.join(', ');
}

function labelsOf(rows: readonly { label: string }[]): string[] {
  return rows.map((r) => renderSafe(r.label));
}

/**
 * The claim for cards whose bank stopped sharing them, among the cards THIS surface prints.
 *
 * The date is stated only in the single-card case. With several frozen cards the drops carry
 * different dates, and one date standing for all of them would be a small fabrication; the
 * per-account date lives on /accounts, which this sentence can point at.
 */
export function frozenCardsNote(
  rows: readonly FrozenCardRow[],
  opts: { role: FrozenFigureRole; nextStep: FrozenNextStep },
): string | null {
  if (rows.length === 0) return null;
  // A MIXED list is two claims, not one (critic P2-1): the first cut keyed every reader-only clause
  // on `allPartner`, so one own card restored the imperative, the second-person possessive and the
  // reader-only remedy over the partner's row beside it. Split and say each thing once.
  const own = rows.filter((r) => r.ownership !== 'partner');
  const theirs = rows.filter((r) => r.ownership === 'partner');
  if (own.length > 0 && theirs.length > 0) {
    return [frozenCardsNote(own, opts), frozenCardsNote(theirs, opts)].filter(Boolean).join(' ');
  }
  const owners = rows.map((r) => r.ownership);
  const allPartner = owners.every((o) => o === 'partner');
  // No imperative on a card the reader is not paying: "check it before paying" is addressed to
  // whoever pays, and on a partner's card that is the partner (critic P1-1).
  const guard =
    opts.role === 'instruction' && !allPartner
      ? ` Check ${rows.length === 1 ? 'the card' : 'the cards'} with your bank before paying.`
      : '';
  const tail = `${guard}${nextStepClause(resolveStep(owners, opts.nextStep), rows.length > 1)}`;
  const opener = stoppedSharing(rows.length, owners);
  // "any payment YOU have already made" is second person, so it holds only where every row is the
  // reader's OWN. On a partner's card the payment is theirs; where ownership is unknown the claim
  // cannot be supported either. In both cases the possessive drops rather than being reassigned.
  const madeBy = owners.every((o) => o === 'reader') ? 'you have already made' : 'made';

  if (rows.length === 1) {
    const r = rows[0];
    const name = renderSafe(r.label);
    const when = formatISODate(r.frozenSince as ISODate, 'long');
    return r.isEstimated
      ? `${opener} ${name} on ${when}, and no statement has arrived since, so the amount asked for here is worked out from the last balance we saw — nothing that has happened on the card since is in it, including any payment ${madeBy}.${tail}`
      : `${opener} ${name} on ${when}, so nothing that has happened on the card since is in these figures — including any payment ${madeBy} against this statement.${tail}`;
  }
  return `${opener} ${rows.length} of these cards (${nameSet(
    labelsOf(rows),
  )}), so nothing that has happened on them since is in these figures — including any payments ${madeBy}.${tail}`;
}

/**
 * The all-clear case, and the sharpest one in this whole set: "nothing is due this cycle" / "a
 * clear week ahead" is a POSITIVE money claim, and a card the bank stopped sharing is precisely a
 * card whose new statement could not have reached us. Every other builder here qualifies a number;
 * this one qualifies an ABSENCE, which is why it cannot borrow their wording ("nothing that has
 * happened on it since is in these figures" is nonsense where there are no figures).
 *
 * The lesson it comes from is `an-empty-set-is-not-a-fact-about-money.md`: eight surfaces once
 * rendered "we don't know" as "you're all caught up". A frozen card reintroduces exactly that gap
 * through a different door.
 */
export function frozenNothingDueNote(
  /** Label, date and ownership: nothing about the estimate path or a card id changes an ABSENCE
   *  claim, but WHOSE account it is changes both the subject and the remedy (critic P1-2). */
  rows: readonly {
    readonly label: string;
    readonly frozenSince: string;
    readonly ownership: FrozenOwnership;
  }[],
  opts: { nextStep: FrozenNextStep },
): string | null {
  if (rows.length === 0) return null;
  const own = rows.filter((r) => r.ownership !== 'partner');
  const theirs = rows.filter((r) => r.ownership === 'partner');
  if (own.length > 0 && theirs.length > 0) {
    // Critic P2-1, same reason as the card note: one own card must not restore a reader-only
    // remedy over a partner's row.
    return [frozenNothingDueNote(own, opts), frozenNothingDueNote(theirs, opts)]
      .filter(Boolean)
      .join(' ');
  }
  const owners = rows.map((r) => r.ownership);
  const tail = nextStepClause(resolveStep(owners, opts.nextStep), rows.length > 1);
  const opener = stoppedSharing(rows.length, owners);
  if (rows.length === 1) {
    return `${opener} ${renderSafe(rows[0].label)} on ${formatISODate(
      rows[0].frozenSince as ISODate,
      'long',
    )}, so a statement issued on it since would not have reached us — this covers only what we can still see.${tail}`;
  }
  return `${opener} ${rows.length} of the cards here (${nameSet(
    labelsOf(rows),
  )}), so a statement issued on any of them since would not have reached us — this covers only what we can still see.${tail}`;
}

/** The funding account a projection walks from, labelled as the surface names it. */
export interface FrozenFunding {
  readonly label: string;
  readonly frozenSince: string;
}

/** As above, plus the frozen number itself — required wherever there is room to name it, so the
 *  reader can tell WHICH figure stopped moving rather than being told that one of them did. */
export interface FrozenFundingFigure extends FrozenFunding {
  readonly balanceCents: number;
}

/**
 * The claim for a projection whose STARTING balance stopped updating (L.14 critic F-1, extended
 * here to every surface that states one of the resulting figures).
 *
 * The direction is stated, not hedged both ways: a balance frozen HIGH reports a shortfall of $0
 * and no transfer to make while the real account cannot cover the autopay, which is the missed
 * payment this whole feature exists to prevent. Frozen LOW merely over-funds. Naming the expensive
 * direction is the point — "this number may be off" tells a reader nothing they can act on.
 */
export function frozenFundingNote(
  funding: FrozenFundingFigure,
  opts: { role: FrozenFigureRole; nextStep: FrozenNextStep },
): string {
  const name = renderSafe(funding.label);
  const when = formatISODate(funding.frozenSince as ISODate, 'long');
  const guard =
    opts.role === 'instruction' ? ' Treat the amount as a floor and check the account first.' : '';
  // "Every figure here is projected from it" — L.14's wording — was itself an overclaim, and the
  // correction comes from the engine rather than from taste: `requiredCents` is the sum of the card
  // dues and does not touch this balance at all. What the balance decides is the shortfall, the
  // covered/not-covered verdict, and the transfer. Naming those keeps the sentence checkable.
  return `${name}'s balance of ${formatCents(
    cents(funding.balanceCents),
  )} has not updated since ${when}, because your bank stopped sharing that account. The shortfall and any transfer it recommends are projected from that balance, so if the real one is lower, this understates what you need to move.${guard}${nextStepClause(
    opts.nextStep,
    false,
  )}`;
}

/**
 * Cash Flow Radar, in-app. Its own sentence because its claim is structurally different from every
 * other funding-derived figure: the radar reports a VERDICT over a 90-day walk, and the verdict has
 * two shapes with opposite failure directions.
 *
 * With a transfer to make, the risk is an amount too small. With none — the "Clear" header — the
 * risk is worse and quieter: a balance frozen HIGH produces a clean projection over an account that
 * is really heading under, and the reader is reassured into doing nothing. Saying "this understates
 * what you need to move" there would be nonsense (there is nothing to move), so the no-transfer
 * form states the only honest thing: an absent dip is not evidence of safety.
 *
 * `statesATransfer` is a fact about what this radar run actually rendered, so it is required and is
 * read from `coverTransfer`, never from the status enum.
 */
export function frozenProjectionNote(
  funding: FrozenFunding,
  opts: {
    /**
     * What this run of the projection actually put on screen — read from the result, never from a
     * status enum. Cash Flow Radar and /forecast walk the same balance forward and differ only in
     * whether they end in an instruction, so they share the sentence and not the consequence.
     */
    shows: 'a-transfer' | 'a-dip' | 'no-dip';
    nextStep: FrozenNextStep;
  },
): string {
  const name = renderSafe(funding.label);
  const when = formatISODate(funding.frozenSince as ISODate, 'long');
  const consequence =
    opts.shows === 'a-transfer'
      ? 'If the real balance is lower, the dip comes sooner and the amount to move is larger than shown.'
      : opts.shows === 'a-dip'
        ? 'If the real balance is lower, the dip comes sooner and goes deeper than shown.'
        : 'A projection cannot see a balance it is no longer being sent, so no dip here is not evidence that the account is safe.';
  return `This projection starts from ${name}'s balance, which stopped updating on ${when} when your bank stopped sharing that account. ${consequence}${nextStepClause(
    opts.nextStep,
    false,
  )}`;
}

/**
 * When the figure IS one frozen account's balance, quoted as its balance — the Ask account-balance
 * answer, and the /cards panel that lists an undatable card's balance.
 *
 * Separate from `frozenTotalNote` because the claims differ in kind: there is nothing here to be
 * "included in", so the honest statement is that the number is the last one we saw rather than a
 * current one. Collapsing the two would produce "this balance includes a number that is no longer
 * moving", which is a sentence about a total, printed beside something that is not one.
 */
export function frozenQuotedBalanceNote(
  row: { readonly frozenSince: string },
  opts: { nextStep: FrozenNextStep },
): string {
  return `That balance stopped updating on ${formatISODate(
    row.frozenSince as ISODate,
    'long',
  )}, when your bank stopped sharing the account — it is the last figure we saw, not a current one.${nextStepClause(
    opts.nextStep,
    false,
  )}`;
}

/**
 * A surface that LISTS balances rather than summing them — the Ask fallback that answers "here are
 * the accounts I can see" with one figure per row.
 *
 * Its own builder because "still counted in the balances listed here" is a category error (critic
 * P3-5): the frozen figure IS one of the listed balances, not something inside them. `frozenTotalNote`
 * is for a number computed OVER accounts; this is for a list of the accounts themselves.
 */
export function frozenListedBalancesNote(
  rows: readonly FrozenTotalRow[],
): string | null {
  if (rows.length === 0) return null;
  if (rows.length === 1) {
    return `${renderSafe(rows[0].label)}'s balance stopped updating on ${formatISODate(
      rows[0].frozenSince as ISODate,
      'long',
    )}, when your bank stopped sharing the account — it is the last figure we saw, not a current one.`;
  }
  return `${rows.length} of these balances are the last figures we saw rather than current ones (${labelsOf(
    rows,
  ).join(', ')}) — your banks stopped sharing those accounts.`;
}

/** An account inside a total this surface prints, labelled as the surface names it. */
export interface FrozenTotalRow {
  readonly label: string;
  readonly frozenSince: string;
}

/**
 * When a total or a derived estimate is computed OVER accounts, one or more of which is frozen.
 *
 * `figureLabel` is required and must be the noun this surface actually prints ("your net worth",
 * "this total", "the years-to-FI estimate"). A shared sentence that names the figure itself would
 * be wrong on every surface but the one it was written for, which is the L.15 mistake exactly; and
 * a surface that cannot name its own figure has no business qualifying it.
 */
export function frozenTotalNote(
  rows: readonly FrozenTotalRow[],
  opts: { figureLabel: string; nextStep: FrozenNextStep },
): string | null {
  if (rows.length === 0) return null;
  const tail = nextStepClause(opts.nextStep, rows.length > 1);
  // `figureLabel` is the OBJECT of the clause, never its subject, so a plural label ("the balances
  // listed here") cannot disagree with a singular row count and produce "the balances rests on".
  if (rows.length === 1) {
    return `${renderSafe(rows[0].label)}'s balance stopped updating on ${formatISODate(
      rows[0].frozenSince as ISODate,
      'long',
    )}, when your bank stopped sharing the account, and that last figure is still counted in ${
      opts.figureLabel
    }.${tail}`;
  }
  return `${rows.length} accounts' balances stopped updating when your banks stopped sharing them (${labelsOf(
    rows,
  ).join(', ')}), and those last figures are still counted in ${opts.figureLabel}.${tail}`;
}

/**
 * A frozen LOAN or MORTGAGE. Its own builder, because the card sentence is false about it twice
 * over (critic P1-3): `selectLoanObligations` reads only the account's stored `minimumPaymentCents`
 * and `dueDayOfMonth` and never subtracts a payment, so "a payment you have already made is not in
 * these figures" names a mechanism that does not exist here — and a reader who concludes the
 * reminder is stale skips a mortgage payment. What IS stale is the stored payment and due day
 * themselves, which the bank stopped confirming on the drop date.
 */
export function frozenLoanNote(
  row: { readonly label: string; readonly frozenSince: string },
  opts: { role: FrozenFigureRole; nextStep: FrozenNextStep },
): string {
  const guard = opts.role === 'instruction' ? ' Check it with your lender before paying.' : '';
  return `Your bank stopped sharing ${renderSafe(row.label)} on ${formatISODate(
    row.frozenSince as ISODate,
    'long',
  )}, so the payment amount and due date shown here are the last ones it sent — nothing about this loan has been confirmed since.${guard}${nextStepClause(
    opts.nextStep,
    false,
  )}`;
}

/** A due this email prints, labelled as the bullet labels it. May be a card OR a loan. */
export interface FrozenDueRow {
  readonly label: string;
  readonly frozenSince: string;
  /** Cards and loans go stale in different ways, and the sentence differs. Never inferred. */
  readonly kind: 'card' | 'loan';
  /** No statement, so the amount is derived from the frozen balance itself. Always false for a
   *  loan, whose payment is a stored fixed amount rather than an estimate. */
  readonly isEstimated: boolean;
  /**
   * The row belongs to another household member (the joint digest prints their shared card's due).
   * REQUIRED: the reader cannot reconnect an account they do not own, and a remedy telling them to
   * go and fix it is the L.14 critic F-4 defect posted to an inbox, where nothing can correct it.
   * A boolean rather than `FrozenOwnership` on purpose — both callers here compose per user and
   * know the answer, so there is no ignorance to represent.
   */
  readonly ownedByPartner: boolean;
}

/**
 * The reminder email and the weekly digest, which print the SAME bullets through the same
 * `reminderLine` and hold the same nothing: no controls, no adjustable figures, and — per L.15 —
 * no position they may name. So the sentences say "in this email", never "above", and the step is
 * the app itself, named as a destination rather than a button.
 *
 * Shared by both emails deliberately: identical bullets, identical money claim, identical absence
 * of controls, exactly as `cardDuplicateEmailLines` is shared. What must never be shared is a
 * sentence across surfaces whose claims differ — which is why /cards, push, Ask and /coach each
 * get their own and this one is not reused there.
 *
 * A loan is included: `selectPaymentReminders` mixes loans into the same list, and a frozen loan's
 * stored payment and due day are as stale as a frozen card's statement. The wording says "account"
 * rather than "card" for that reason.
 */
export function frozenDuesEmailLines(rows: readonly FrozenDueRow[]): string[] {
  if (rows.length === 0) return [];
  const many = rows.length > 1;
  // "your bank" is the reader's, and one of these rows may be a partner's shared card — so the
  // TITLE says only what is true of every row. (My own abstention test caught this: the per-row
  // sentence had been made partner-safe while the heading above it still claimed the reader's own
  // bank had stopped sharing someone else's account.)
  const out: string[] = [
    many
      ? 'Some of these payments come from accounts that are no longer being shared'
      : 'One of these payments comes from an account that is no longer being shared',
  ];
  for (const r of rows) {
    const when = formatISODate(r.frozenSince as ISODate, 'long');
    // "your bank" is the reader's bank. On a partner's shared card it is not, so that row says whose
    // it is and stops there — the reader has no connection to fix.
    const whose = r.ownedByPartner
      ? `${renderSafe(r.label)}: the bank behind this account stopped sharing it on ${when}`
      : `${renderSafe(r.label)}: your bank stopped sharing this account on ${when}`;
    // Second person only where the row is the reader's own — the payment on a partner's card is
    // theirs to have made, and telling the reader otherwise is the double-payment invitation.
    const made = r.ownedByPartner ? 'made' : 'you have already made';
    const mechanism =
      r.kind === 'loan'
        ? ', so the amount and the date listed for it in this email are the last ones it sent — nothing about this loan has been confirmed since.'
        : `, so nothing that has happened on it since is in the amount listed for it in this email — including any payment ${made}.${
            r.isEstimated
              ? ' No statement has arrived since either, so that amount is worked out from the last balance we saw.'
              : ''
          }`;
    out.push(
      `${whose}${mechanism}${
        r.ownedByPartner ? ' Only the household member who owns it can reconnect it.' : ''
      }`,
    );
  }
  // The app is named only when at least one of these rows is the reader's OWN — otherwise the email
  // would send them into Aimplifi to fix connections that are not theirs to fix.
  const own = rows.filter((r) => !r.ownedByPartner);
  if (own.length === 0) {
    // Every row belongs to someone else: there is no bank of the reader's to check and no
    // connection of theirs to fix. The per-row sentence has already said who can.
    out.push('Nothing has been adjusted.');
    return out;
  }
  const ownPlural = own.length > 1;
  out.push(
    `Nothing has been adjusted. Check ${
      ownPlural ? 'those accounts' : 'that account'
    } with your bank before paying, and open Aimplifi to see the connection and how to fix ${
      ownPlural ? 'them' : 'it'
    }.`,
  );
  return out;
}

/**
 * Web push, per notification. Its own builder because push has a constraint no other surface has:
 * the operating system truncates the body, so this rides LAST — after the amount and the date —
 * and says the shortest true thing. It points at nothing, because a notification holds no control.
 *
 * Disclose, never suppress: withholding the notification would assert the amount is wrong, which
 * is not known, and its failure direction is a missed payment (the L.15 push decision).
 */
export function frozenCardPushNote(row: {
  readonly frozenSince: string;
  /** Required for the same reason as on `FrozenDueRow`: the consequence differs (critic P1-3). */
  readonly kind: 'card' | 'loan';
}): string {
  const when = formatISODate(row.frozenSince as ISODate, 'long');
  return row.kind === 'loan'
    ? `Your bank stopped sharing this account on ${when}, so this amount and date are the last ones it sent.`
    : `Your bank stopped sharing this account on ${when}, so a payment you have already made may not be counted here.`;
}

/**
 * Web push, the cash-flow alert. The projection's starting balance is frozen, and this is the only
 * message in the app that states an amount to MOVE, so the conditional names the direction that
 * costs money: a real balance lower than the frozen one means the dip is sooner and the transfer
 * larger than the body says.
 */
export function frozenRadarPushNote(funding: FrozenFunding): string {
  return `This starts from ${renderSafe(funding.label)}'s balance, which stopped updating on ${formatISODate(
    funding.frozenSince as ISODate,
    'long',
  )} — if the real balance is lower, the dip comes sooner and the amount is larger.`;
}
