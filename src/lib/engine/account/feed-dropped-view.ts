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
/**
 * Join two claims about different sub-lists without saying the same closing thing twice.
 *
 * `frozenNothingDueNote` recurses — first by kind, then by ownership — and every leaf appends its
 * own remedy and its own "this covers only what we can still see". A household with two frozen
 * cards and two frozen loans therefore produced FOUR sentences carrying the remedy twice and the
 * coverage caveat four times, in a weekly digest that cannot correct itself (critic P2-1).
 *
 * A tail is dropped ONLY when an IDENTICAL one appears later in the set — never merely because it
 * is not last.
 *
 * MY OWN FIRST CUT OF THIS FUNCTION WAS THE BUG, caught by the test written for it. It dropped the
 * tail from every claim but the last, on the reasoning that the tail is "true of the whole set".
 * That holds for the coverage caveat and is false for the REMEDY: the own/partner split exists
 * precisely because those two rows have DIFFERENT remedies, and the reader's own claim comes first
 * — so "Open Aimplifi to see the connection and how to fix it" was deleted outright, leaving a
 * household reader told only that someone else can fix someone else's account. A fix for a
 * verbosity finding that silently removed the one actionable sentence would have been a far worse
 * defect than the repetition it was tidying.
 */
function joinClaims(claims: readonly (string | null)[]): string {
  const kept = claims.filter((c): c is string => c != null);
  const COVERAGE = ' — this covers only what we can still see.';
  const tailOf = (c: string) => {
    const at = c.indexOf(COVERAGE);
    return at === -1 ? null : c.slice(at);
  };
  return kept
    .map((c, i) => {
      const tail = tailOf(c);
      if (tail == null) return c;
      // Say it once, at the END, and only when the later claim says exactly the same thing.
      const repeatedLater = kept.slice(i + 1).some((other) => tailOf(other) === tail);
      return repeatedLater ? `${c.slice(0, c.length - tail.length)}.` : c;
    })
    .join(' ');
}

export interface FrozenNothingDueRow {
  readonly label: string;
  readonly frozenSince: string;
  readonly ownership: FrozenOwnership;
  /**
   * REQUIRED (TASKS L.19). An all-clear covers cards AND loans — `selectPaymentReminders` mixes
   * both into the one list this claim is about — and the reason the absence is unreliable is
   * different for each, so a single sentence cannot carry both:
   *  · a card's gap is a STATEMENT that could not reach us;
   *  · a loan's is its stored payment and due day, which the bank stopped CONFIRMING on the drop
   *    date. A loan issues no statement, so the card wording would name a document that does not
   *    exist and quietly imply the due day itself is trustworthy — and the due day is precisely
   *    the field that decides whether "nothing due in the next 7 days" is true at all.
   *  · an `undatable-loan` has no dated payment AT ALL (TASKS L.20). `selectLoanObligations`
   *    emits nothing without both a positive payment and a due day, so this loan is absent from
   *    every list an all-clear is a claim about — and the loan wording above would be false about
   *    it twice over: it names a stored payment and due date as merely stale when there is none,
   *    and it implies the gap could close on its own, when the bank that would send one has
   *    stopped sharing the account. Cards carry this case out through `unknownDueDateCards`;
   *    until L.20 loans had no equivalent, so this was the one row that could reach no surface.
   */
  readonly kind: 'card' | 'loan' | 'undatable-loan';
  /**
   * For `undatable-loan` only: WHICH field is absent (L.20 critic cycle, finding B-2). Null on the
   * other two kinds, which are undated for no such reason. See `UndatableFrozenLoan.missing` — the
   * sentence was wrong about this on the commonest shape a bank actually sends.
   */
  readonly missing: 'due-day' | 'payment' | 'both' | null;
}

/**
 * The rows an all-clear must account for, built once (TASKS L.19).
 *
 * The dashboard and the weekly digest each hand-rolled this list, near-identically, from
 * `result.cards` + `result.unknownDueDateCards` — which is how ONE gap opened in TWO places: both
 * copies enumerated cards, and `selectPaymentReminders` mixes loans into the very list their
 * all-clear is a claim about. Two more surfaces (/cards, the Ask answer) build a genuinely
 * cards-only set and keep doing so; those are lists of cards, not of dues.
 *
 * It also closes a defect neither copy could see: `result.cards` holds one obligation per STATEMENT,
 * so a card with a current statement AND a next-cycle estimate appears twice, and two rows for one
 * account would have rendered as `2 cards (all of them named "Chase Sapphire")` — the disclosure
 * telling the reader two accounts are unreadable when there is one. Deduplicated by account id, the
 * same invariant `frozenCalendarNotice` enforces for the same reason.
 */
export function frozenNothingDueRows(params: {
  readonly cards: readonly {
    readonly cardId: string;
    readonly cardName: string;
    readonly frozenSince: string | null;
  }[];
  readonly loans: readonly {
    readonly accountId: string;
    readonly accountName: string;
    readonly frozenSince: string | null;
  }[];
  /**
   * Frozen LOAN/MORTGAGE accounts that produced no obligation at all because they carry no due
   * day or no positive payment (TASKS L.20 — `selectUndatableFrozenLoans`). Optional because it
   * is additive and every pre-L.20 fixture omits it; absent is identical to `[]`, which is the
   * pre-L.20 behaviour exactly.
   *
   * These can never appear in `loans` above: that list is built from `LoanObligation`s, and a
   * loan reaches one only by having both fields. The two inputs are disjoint by construction, so
   * the dedupe below is a belt-and-braces invariant rather than a live filter.
   */
  readonly undatableLoans?: readonly {
    readonly accountId: string;
    readonly accountName: string;
    readonly frozenSince: string | null;
    /** WHICH field is absent — see `UndatableFrozenLoan.missing` (L.20 critic cycle, B-2). */
    readonly missing: 'due-day' | 'payment' | 'both';
  }[];
  /** accountId → owning partner's display name. Absent ⇒ the reader's own. At household scope the
   *  result is MERGED, so a row here may belong to someone who cannot be addressed in the second
   *  person and whose connection the reader cannot fix (L.18 critic P1-2). */
  readonly partnerLabel: Readonly<Record<string, string | undefined>>;
}): FrozenNothingDueRow[] {
  const seen = new Set<string>();
  const out: FrozenNothingDueRow[] = [];
  const push = (
    id: string,
    label: string,
    frozenSince: string | null,
    kind: 'card' | 'loan' | 'undatable-loan',
    missing: FrozenNothingDueRow['missing'] = null,
  ) => {
    // Keyed by KIND and id, not id alone (critic P2-3). A CREDIT account cannot also be
    // LOAN/MORTGAGE today, so a collision is latent rather than live — but the failure mode of a
    // shared key is a money DISCLOSURE silently disappearing, which is the one direction this
    // whole file exists to prevent, and scoping the key costs nothing.
    //
    // The two LOAN kinds share one namespace, though (L.20), because there the collision would
    // fail in the OTHER direction: one account claiming both "its stored due date may be stale"
    // and "it has no due date at all" is a self-contradiction on one screen. `loans` is pushed
    // first, so a dated obligation wins — which is also the true answer, since holding one is
    // what makes a loan datable.
    const key = `${kind === 'card' ? 'card' : 'loan'}:${id}`;
    if (frozenSince == null || seen.has(key)) return;
    seen.add(key);
    out.push({
      label,
      frozenSince,
      ownership: params.partnerLabel[id] ? 'partner' : 'reader',
      kind,
      missing,
    });
  };
  for (const c of params.cards) push(c.cardId, c.cardName, c.frozenSince, 'card');
  for (const l of params.loans) push(l.accountId, l.accountName, l.frozenSince, 'loan');
  for (const l of params.undatableLoans ?? []) {
    push(l.accountId, l.accountName, l.frozenSince, 'undatable-loan', l.missing);
  }
  return out;
}

/**
 * Fixed grouping order, so the sentence never depends on the order rows arrived in.
 *
 * The undatable kind is split by WHICH field is missing (L.20 critic cycle, finding B-2): rows that
 * disagree about that cannot share a clause, any more than a card and a loan can share one.
 */
const FROZEN_DUE_GROUPS = [
  { kind: 'card', missing: null },
  { kind: 'loan', missing: null },
  { kind: 'undatable-loan', missing: 'both' },
  { kind: 'undatable-loan', missing: 'due-day' },
  { kind: 'undatable-loan', missing: 'payment' },
] as const satisfies readonly {
  kind: FrozenNothingDueRow['kind'];
  missing: FrozenNothingDueRow['missing'];
}[];

/**
 * The mechanism clause — WHY this account's absence from the list is unreliable.
 *
 * Five clauses, because each names a different thing that stopped: a card's statement, a loan's
 * stored payment-and-due-day, and — for an undatable loan — the field that was never there to go
 * stale, which is a different field in each of the three cases a bank can leave us in. The
 * undatable branches are the only ones that must also say the gap cannot close on its own: the
 * other two describe a figure we hold and cannot refresh, while these describe a figure we do not
 * hold at all, and a reader who assumes it will appear next cycle misses a mortgage payment.
 *
 * Two corrections from the L.20 critic cycle, both in the undatable wording:
 *
 *  · it said "we have no due date **or** payment amount" about every undatable row, which is false
 *    whenever only one is absent — and one-absent is the COMMON shape, since a bank that reports a
 *    loan without `next_payment_due_date` still sends the payment, and the app prints that payment
 *    on /accounts while this sentence denied holding it (finding B-2);
 *  · it said the row "is not counted **here**" — the positional word this very builder had
 *    "N of the cards here" removed from it in L.19, for the same reason: every caller is inside an
 *    all-clear branch that lists nothing, and one of them is an EMAIL. The set is named outright
 *    instead (findings A-5 / B-10b).
 *
 * The closing clause states NECESSITY without sufficiency (finding A-6): while the account is not
 * being shared, no due date can arrive — not that reconnecting will produce one. A live loan can be
 * undatable too, which is why the two cases have separate sentences and separate remedies.
 */
const FROZEN_DUE_MECHANISM: Record<
  string,
  { readonly noun: string; readonly one: string; readonly many: string }
> = {
  card: {
    noun: 'cards',
    one: 'so a statement issued on it since would not have reached us',
    many: 'so a statement issued on any of them since would not have reached us',
  },
  loan: {
    noun: 'loans',
    one: 'so a change to its payment or due date since would not have reached us',
    many: 'so a change to a payment or due date on any of them since would not have reached us',
  },
  'undatable-loan:both': {
    noun: 'loans',
    one: 'and we hold no due date and no payment amount for it, so it is in no payment list at all — and neither can arrive while the account is not being shared',
    many: 'and we hold no due date and no payment amount for any of them, so they are in no payment list at all — and neither can arrive while the accounts are not being shared',
  },
  'undatable-loan:due-day': {
    noun: 'loans',
    one: 'and we hold no due date for it, so it is in no payment list at all — and one cannot arrive while the account is not being shared',
    many: 'and we hold no due date for any of them, so they are in no payment list at all — and one cannot arrive while the accounts are not being shared',
  },
  'undatable-loan:payment': {
    noun: 'loans',
    one: 'and we hold no payment amount for it, so it is in no payment list at all — and one cannot arrive while the account is not being shared',
    many: 'and we hold no payment amount for any of them, so they are in no payment list at all — and one cannot arrive while the accounts are not being shared',
  },
};

/** The mechanism key for a row: the kind, plus which field is missing where that differs. */
function mechanismKey(r: FrozenNothingDueRow): string {
  return r.kind === 'undatable-loan' ? `${r.kind}:${r.missing ?? 'both'}` : r.kind;
}

export function frozenNothingDueNote(
  /** Label, date, ownership and kind: nothing about the estimate path or an account id changes an
   *  ABSENCE claim, but WHOSE account it is changes both the subject and the remedy (critic P1-2),
   *  and WHAT KIND it is changes the mechanism being disclosed (L.19). */
  rows: readonly FrozenNothingDueRow[],
  opts: { nextStep: FrozenNextStep },
): string | null {
  if (rows.length === 0) return null;
  // Split by KIND before ownership: the two claims are about different mechanisms, so they can
  // never share a sentence, and each resulting single-kind list then splits by ownership exactly
  // as before. Cards first, deterministically — the order must not depend on input order.
  const groups = FROZEN_DUE_GROUPS.map((g) =>
    rows.filter((r) => r.kind === g.kind && (g.missing === null || r.missing === g.missing)),
  ).filter((g) => g.length > 0);
  if (groups.length > 1) {
    return joinClaims(groups.map((g) => frozenNothingDueNote(g, opts)));
  }
  const own = rows.filter((r) => r.ownership !== 'partner');
  const theirs = rows.filter((r) => r.ownership === 'partner');
  if (own.length > 0 && theirs.length > 0) {
    // L.18 critic P2-1, same reason as the card note: one own card must not restore a reader-only
    // remedy over a partner's row.
    return joinClaims([frozenNothingDueNote(own, opts), frozenNothingDueNote(theirs, opts)]);
  }
  const owners = rows.map((r) => r.ownership);
  const tail = nextStepClause(resolveStep(owners, opts.nextStep), rows.length > 1);
  const opener = stoppedSharing(rows.length, owners);
  const kind = mechanismKey(rows[0]);
  if (rows.length === 1) {
    const mechanism = FROZEN_DUE_MECHANISM[kind].one;
    return `${opener} ${renderSafe(rows[0].label)} on ${formatISODate(
      rows[0].frozenSince as ISODate,
      'long',
    )}, ${mechanism} — this covers only what we can still see.${tail}`;
  }
  // "of the cards here" (the pre-L.19 wording) named a set this surface does not render: every
  // caller of this builder is inside an all-clear branch, which lists NOTHING — so "here" had no
  // antecedent on any of the four surfaces that print it. The rows are named outright instead,
  // which is what the reader needs and what the single-row branch has always done.
  const mechanism = FROZEN_DUE_MECHANISM[kind].many;
  return `${opener} ${rows.length} ${FROZEN_DUE_MECHANISM[kind].noun} (${nameSet(
    labelsOf(rows),
  )}), ${mechanism} — this covers only what we can still see.${tail}`;
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

/** The dashboard Today feed: the note qualifying an absence of warnings rather than a figure. */
export const FROZEN_FEED_TESTID = 'today-feed-frozen';

/**
 * The dashboard "Today" feed, when the funding balance is frozen and NO nudge on the feed says so
 * (TASKS L.20).
 *
 * Its own builder, and not `frozenProjectionNote`, for the reason L.19 had to correct twice: that
 * sentence opens "This projection starts from…", and this feed renders no projection — the phrase
 * would name an antecedent the reader cannot see, which is exactly the "N of the cards here" defect
 * on a surface that lists nothing. What this feed shows is the ABSENCE of a warning, so that is
 * what the sentence is about.
 *
 * It also may not claim the feed is EMPTY. The fact is carried whenever no proposal states it, and
 * an unrelated opportunity can sit at the top of an otherwise quiet feed; "an empty feed here"
 * would then be false on the page it was written for.
 *
 * For the same reason the closing clause is CONDITIONAL rather than positional (L.20 critic cycle,
 * finding B-10a). It used to read "the absence of a warning here", and "here" is a claim about the
 * reader's position that this builder cannot make: the paragraph renders directly beneath whatever
 * headline the feed has, which on the slice's own fixture is a payment due — a warning, sitting
 * immediately above a sentence about the absence of one. "If neither has flagged a problem" is
 * true whether or not something else is on screen, and it is still about the silence that matters.
 *
 * The direction is the one that costs money, stated plainly: a balance frozen HIGH produces no
 * shortfall and no dip, so the silence the reader is being reassured by is manufactured by the
 * missing data itself.
 */
export function frozenNoWarningNote(
  funding: FrozenFundingFigure,
  opts: { nextStep: FrozenNextStep },
): string {
  return `${renderSafe(funding.label)}'s balance of ${formatCents(
    cents(funding.balanceCents),
  )} has not updated since ${formatISODate(
    funding.frozenSince as ISODate,
    'long',
  )}, because your bank stopped sharing that account. Whether you are short for the cards due, and whether cash dips below $0, are both worked out from that balance — so if neither has flagged a problem, that silence rests on a figure we cannot refresh rather than on a confirmed cushion.${nextStepClause(
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
  row: {
    readonly label: string;
    readonly frozenSince: string;
    /**
     * REQUIRED, from the same finding that made it required on `FrozenCardRow` — and it was missed
     * here (TASKS L.19). L.18's critic P1-1 fixed the card path and left this one hardcoded to the
     * second person, while `payment-reminders-card.tsx` was ALREADY calling it on a partner's shared
     * loan: the reader saw "Your bank stopped sharing …. Check it with your lender before paying."
     * over an account they do not own, followed immediately by "Only the household member who owns
     * it can reconnect it." An imperative addressed to whoever is not paying, naming a lender the
     * reader has no relationship with — the double-payment invitation, one obligation type across.
     */
    readonly ownership: FrozenOwnership;
  },
  opts: { role: FrozenFigureRole; nextStep: FrozenNextStep },
): string {
  // No imperative on a loan the reader is not paying, and no second-person subject over someone
  // else's lender — the two halves of the card fix, applied here.
  // `=== 'reader'`, NOT `!== 'partner'` (critic P3-3). Under `'unknown'` the negative form kept the
  // imperative while `resolveStep` correctly dropped the remedy — an order to act with the how-to
  // removed, over an account the builder has just admitted it cannot attribute. A caller that does
  // not know whose loan this is cannot tell the reader to go and pay it.
  const guard =
    opts.role === 'instruction' && row.ownership === 'reader'
      ? ' Check it with your lender before paying.'
      : '';
  const opener = stoppedSharing(1, [row.ownership]);
  return `${opener} ${renderSafe(row.label)} on ${formatISODate(
    row.frozenSince as ISODate,
    'long',
  )}, so the payment amount and due date shown here are the last ones it sent — nothing about this loan has been confirmed since.${guard}${nextStepClause(
    resolveStep([row.ownership], opts.nextStep),
    false,
  )}`;
}

/** /calendar: the notice qualifying the dated payments the grid paints. */
export const FROZEN_CALENDAR_TESTID = 'calendar-frozen';

/** One due event on the calendar grid, identified as the grid identifies it. */
export interface FrozenCalendarRow {
  /**
   * The account behind the event. Carried so the notice can COUNT accounts rather than events:
   * `result.cards` holds the current statement AND the next cycle's estimate, so one card can paint
   * two due events in a single month, and "2 accounts are no longer being shared" over one account
   * is the L.15 defect exactly — a count computed over something other than what it names.
   */
  readonly accountId: string;
  /** The card or loan name as the grid paints it, owner suffix included and the " due" verb
   *  excluded — the identity portion of the event label, not the whole event label. */
  readonly label: string;
  readonly frozenSince: string;
  readonly ownership: FrozenOwnership;
  readonly kind: 'card' | 'loan';
  /** Card only: no statement, so the amount is derived from the frozen balance. Always false for a
   *  loan, whose payment is a stored fixed amount rather than an estimate. */
  readonly isEstimated: boolean;
}

export interface FrozenCalendarNotice {
  readonly title: string;
  readonly lines: readonly string[];
  /** The claim about the month summary, which is a figure in its own right. Null when nothing on
   *  the grid is frozen and only the PROJECTION behind it is — there are no due rows in the totals
   *  to qualify, and claiming otherwise would be a hedge over figures that are perfectly current. */
  readonly totalNote: string | null;
}

/**
 * The due DATE claim for a frozen card, which exists only on this surface (TASKS L.19, critic P1-2).
 *
 * `frozenCardsNote` qualifies the AMOUNT — "nothing that has happened on the card since is in these
 * figures". On every other surface that is the whole story. On a calendar it is half of it: the
 * reader's takeaway is "pay this much ON THIS DAY", and the day is as unconfirmed as the amount.
 * Worse, the date printed may be one the APP produced rather than one any bank sent —
 * `buildObligation` clamps a due date that has already passed to today, and for a frozen card no
 * new statement can ever arrive to move it off today again. `frozenLoanNote` has said exactly this
 * for loans since L.18 ("the payment amount and due date shown here are the last ones it sent");
 * the card path, on the same banner, said nothing.
 *
 * The estimate path is named separately because its date comes from a different stale field: the
 * account's own stored cycle-close and due day, not a statement.
 */
export function frozenCardDatesNote(
  rows: readonly { readonly isEstimated: boolean }[],
): string | null {
  if (rows.length === 0) return null;
  const many = rows.length > 1;
  const subject = many ? 'The due dates shown for them are' : 'The due date shown for it is';
  // Both paths in one clause where they agree, split where they do not: a statement card's date
  // came from the last statement, an estimate card's from the account's own stored due day.
  const source = rows.every((r) => r.isEstimated)
    ? `worked out from the day of the month this account used to be due`
    : rows.some((r) => r.isEstimated)
      ? `taken from the last statement the bank sent, or from the day of the month the account used to be due`
      : `taken from the last statement the bank sent`;
  return `${subject} ${source}, so ${
    many ? 'they cannot' : 'it cannot'
  } move to match anything issued since — and a due date that has already passed is shown here as due today.`;
}

/**
 * /calendar (TASKS L.19) — the highest-consequence surface L.18 left silent, because it is the one
 * that prints a DATED AMOUNT TO PAY, which is the whole product of the page.
 *
 * Its own builder rather than a reused sentence, for a reason specific to this surface: a frozen
 * LOAN is worse here than anywhere else in the app. Everywhere else the stale field that bites is an
 * amount; here the reader is looking at a grid whose entire organising principle is the DATE, and a
 * frozen loan's `dueDayOfMonth` is exactly the field the bank stopped confirming. `frozenLoanNote`
 * already says that in as many words, so it is reused verbatim rather than restated.
 *
 * `role` is `'instruction'` and not negotiable: every row here is "pay this much on this day".
 *
 * The set must be resolved against the events the grid ACTUALLY holds for the displayed month — an
 * obligation whose due date falls in another month emits no event, and naming it would point the
 * reader at a row that is not on their screen (the L.15 rule, and the same reason
 * `cardDuplicateCalendarView` takes the painted events rather than the obligations).
 *
 * The per-line remedy is repeated rather than hoisted into one closing sentence: `resolveStep`
 * gives a partner-owned row a different remedy from the reader's own, and with at most a cards line
 * plus one line per frozen loan the repetition costs less than a hoisted clause that would have to
 * re-derive that ownership split by hand.
 *
 * THE PROJECTION IS PART OF THIS SURFACE (critic P1-1). The page prints one more dated instruction
 * that no due row accounts for: "Projected low: $X — transfer $Y by DATE to stay covered", walked
 * forward from the funding balance. With every card and loan live but that balance frozen, the
 * first cut of this builder returned `null` and the page disclosed nothing at all — and the
 * expensive direction is the silent one, because a balance frozen HIGH produces no dip line
 * whatsoever and reassures the reader into doing nothing. So `funding` is a required argument, and
 * the notice can exist with no frozen due rows at all.
 */
export function frozenCalendarNotice(
  rows: readonly FrozenCalendarRow[],
  opts: {
    nextStep: FrozenNextStep;
    /** The funding account the dip/transfer line is projected from, when IT is frozen. Required —
     *  a caller that forgets it re-opens the silent case above. */
    funding: FrozenFunding | null;
    /** What this month's grid actually put on screen, read from the rendered result rather than a
     *  status enum: a transfer instruction, a dip with no transfer, or no dip at all. Only
     *  consulted when `funding` is non-null. */
    shows: 'a-transfer' | 'a-dip' | 'no-dip';
  },
): FrozenCalendarNotice | null {
  // One entry per ACCOUNT, first event wins. A card CAN paint two due events in one month (a
  // current statement and a next cycle), and the title counts accounts, so the collapse happens
  // here where it can be unit-tested rather than in a page.
  //
  // CORRECTION (critic P3-1): an earlier comment here justified this by claiming `result.cards`
  // holds one obligation per STATEMENT so a card appears twice in the input. That is false —
  // `computeCashNeeded` pushes exactly one `buildObligation` per card (engine.ts:194). The real
  // reason is the one above, about EVENTS rather than obligations, and it was worth re-reading the
  // engine rather than trusting the comment I had written from a neighbouring one.
  const byAccount = new Map<string, FrozenCalendarRow>();
  // `kind:id`, for the reason in `frozenNothingDueRows` (critic P2-3).
  for (const r of rows) {
    const key = `${r.kind}:${r.accountId}`;
    if (!byAccount.has(key)) byAccount.set(key, r);
  }
  const unique = [...byAccount.values()];
  if (unique.length === 0 && opts.funding == null) return null;

  const cards = unique.filter((r) => r.kind === 'card');
  const loans = unique.filter((r) => r.kind === 'loan');
  const lines = [
    frozenCardsNote(
      cards.map((c) => ({ ...c, cardId: c.accountId })),
      { role: 'instruction', nextStep: opts.nextStep },
    ),
    frozenCardDatesNote(cards),
    // One sentence per loan: `frozenLoanNote` speaks about a single account, and a frozen mortgage
    // beside a frozen car loan carries two different amounts, two different dates and two different
    // lenders — there is no honest way to merge them into one claim.
    //
    // COLLAPSED when two of them come out byte-identical (critic P2-2): two loans both called
    // "AUTO LOAN", dropped the same day, produced the same sentence twice under a title claiming
    // two accounts — the reader told two things are wrong and shown one, twice, with no way to tell
    // them apart. That is the #298/L.15 collision the `nameSet` rule exists for, and routing loans
    // through `frozenLoanNote` one at a time bypassed it. Saying it once and naming the collision
    // is the honest form; manufacturing "1." and "2." is what the rule forbids.
    ...collapseIdentical(
      loans.map((l) => frozenLoanNote(l, { role: 'instruction', nextStep: opts.nextStep })),
    ),
    opts.funding
      ? frozenProjectionNote(opts.funding, { shows: opts.shows, nextStep: opts.nextStep })
      : null,
  ].filter((s): s is string => s != null);

  // "no longer being shared" collides with the household vocabulary this page renders directly
  // above it — `HouseholdScopeToggle` is about accounts shared between MEMBERS, so the first
  // wording read as "your partner stopped sharing this with you" rather than "the bank stopped
  // sending it" (critic P3-5). L.14's own dashboard notice already had the right words.
  // "behind" rather than "on", because the funding account drives the projection without ever
  // painting a row of its own.
  const total = unique.length + (opts.funding ? 1 : 0);
  return {
    title:
      total === 1
        ? 'One account behind this calendar has stopped updating'
        : `${total} accounts behind this calendar have stopped updating`,
    lines,
    // The summary line is a separate figure from the rows, and it is rendered directly above this
    // notice by the page's own structure (CardHeader, then CardContent) — the same guarantee
    // `cardDuplicateCalendarView` relies on to say "above". Inclusion only, no direction: a card
    // whose payment already landed makes the total too HIGH, while an estimate from a frozen
    // balance can be wrong either way, so a single directional claim would be false half the time.
    // Subject/verb caught by my own re-read: the first cut said the total "and the count of
    // payments due" both "include these amounts" — a count does not include an amount. Recast so
    // ONE subject (these payments) sits inside both figures, and in the SAME vocabulary the
    // duplicate banner on this page already uses, so two banners inches apart name the summary
    // line identically.
    //
    // Null when only the FUNDING account is frozen: the money-out total is a sum of due rows, and
    // with every due row live there is nothing in it to qualify. Hedging it anyway would be the
    // false-hedge failure this file keeps arguing against.
    totalNote:
      unique.length === 0
        ? null
        : 'These payments are inside the money-out total and the count of payments due above.',
  };
}

/**
 * Say a repeated sentence once, and say that it is repeated.
 *
 * Two accounts that paint identically produce identical sentences, and printing both tells the
 * reader two things are wrong while showing them one — the #298 shape (three cards all called
 * "CREDIT CARD"). `nameSet` handles this wherever rows are merged into ONE sentence; this is the
 * same rule for builders that emit one sentence PER row.
 */
function collapseIdentical(lines: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(l, (counts.get(l) ?? 0) + 1);
  const out: string[] = [];
  const emitted = new Set<string>();
  for (const l of lines) {
    if (emitted.has(l)) continue;
    emitted.add(l);
    const n = counts.get(l)!;
    out.push(
      n === 1
        ? l
        : // No manufactured identifier, and no claim about which is which — the point of this
          // branch is precisely that they cannot be told apart from here.
          `${l} ${n} accounts here match this description and nothing on this page tells them apart.`,
    );
  }
  return out;
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
