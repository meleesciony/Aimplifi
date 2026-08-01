/**
 * The labels the guilt-free breakdown prints for its four standing lines —
 * authored ONCE, for every surface that prints them (TASKS L.29).
 *
 * WHY THIS MODULE EXISTS AT ALL. Two surfaces print these lines: the Glass-Box
 * trace behind /spending-plan (`traceSafeToSpend`) and the Ask answer's facts
 * (`answerSafeToSpend`). They were two copies of the same four strings, and they
 * had already drifted — 'Savings target (Settings)' against 'Savings target (from
 * Settings)' — which is the L.21 rule (sweep the data class, don't fix the
 * reported surface) applied to copy. A label is data about the money here: it
 * names the BASIS the figure came from, so two surfaces naming it differently is
 * two answers to one question.
 *
 * WHAT L.29 ADDS. A zero row said nothing about which kind of zero it was.
 * "Card payments due this month — $0.00" is true for a reader with no cards, true
 * for a reader whose statements are all dated past this month's edge, and true
 * for a reader whose bills were dropped by a defect upstream: three different
 * facts, one identical pixel. That is exactly how the L.26 defect survived four
 * sessions of the owner looking straight at this panel. So every zero here names
 * its own reason, using the idiom this breakdown already had for income
 * ('Income (no pattern yet)'), and a zero that means "you have not set this up"
 * carries the CONTROL that sets it up.
 *
 * WHAT L.30 ADDS, AND WHAT IT STILL WILL NOT CLAIM. `disclosures.fixedSeries`
 * carries WHY each repeating expense is or is not in the figure, recorded by the
 * same pass that admits the projected rows, so a zero can now name the alarm
 * (a bill found and not counted) and the two correct absences.
 *
 * It still never says "nothing was found". `detected` counts STORED
 * `RecurringSeries` rows, and a series is only stored if its merchant has a
 * `Merchant` row — which the Plaid and SimpleFIN ingests create but the manual-add
 * and CSV-import writers do not. So `detected === 0` has two causes, and reading it
 * as proof of absence told a reader who had TYPED IN three monthly charges that no
 * repeating bill was found, while /recurring listed them. Both L.30 critics
 * reproduced that independently, by execution. An empty table is not an empty
 * world; the residual is recorded in docs/STATUS.md §OPEN after L.30.
 *
 * Pure: strings in, strings out; no I/O, no Date, no money arithmetic — every
 * figure these labels sit beside is computed by the engine and copied verbatim.
 */
import type { SpendingPlan, SpendingPlanDisclosures } from './plan';

/** One printed line's label, plus the control a "not set up" zero should offer. */
export interface PlanRowLabel {
  label: string;
  /**
   * Where a reader can act on this zero. Absent on every non-zero row, and on a
   * zero this module can PROVE is correct — a control offered beside a working
   * figure reads as a correction.
   *
   * It is present on two kinds of zero, not one (critic P3-2 corrected the earlier
   * wording, which claimed only the first): a zero meaning "you have not set this
   * up", and a zero whose basis is unproven or mixed, where the link is how the
   * reader finds out what the app actually has. What it is never offered beside is
   * a figure asserted to be right.
   */
  action?: { label: string; href: string };
}

export interface PlanRowLabels {
  income: PlanRowLabel;
  fixed: PlanRowLabel;
  cardPayments: PlanRowLabel;
  savings: PlanRowLabel;
}

export function planRowLabels(
  plan: SpendingPlan,
  disclosures: SpendingPlanDisclosures,
): PlanRowLabels {
  return {
    income: { label: incomeLabel(plan) },
    fixed: fixedLabel(plan, disclosures),
    cardPayments: { label: cardPaymentsLabel(plan, disclosures) },
    savings: savingsLabel(plan),
  };
}

/**
 * The income row has named its own basis since L.22 — this is the idiom the
 * three rows below were written to match, kept here so all four move together.
 *
 * The zero case is its own sentence (L.29 critic P2-5): `incomeBasis` is
 * 'trailing-median' whenever ANY complete month exists, including three months of
 * zeros, so "Income (median of last 3 months) — $0.00" was the panel's answer to a
 * reader whose pay stopped or who is paid in cash the app never sees. The median of
 * three zeros is a real reading, not a missing one, and saying so is the difference
 * between "we found nothing" and "there was nothing".
 */
function incomeLabel(plan: SpendingPlan): string {
  if (plan.incomeBasis === 'trailing-median') {
    const months = `${plan.incomeMonths} month${plan.incomeMonths === 1 ? '' : 's'}`;
    return plan.patternIncomeCents === 0
      ? `Income (none arrived in the last ${months})`
      : `Income (median of last ${months})`;
  }
  return plan.incomeBasis === 'detected-series'
    ? 'Income (detected recurring, monthly)'
    : 'Income (no pattern yet)';
}

/**
 * Zero here meant four different things and printed one line (L.30). L.29 could
 * only say "none counted", because at that point nothing downstream of the
 * projection knew WHY a series had not become a projected row — the two filters
 * that decided it threw the reason away. Now `disclosures.fixedSeries` carries
 * the reason for every repeating expense the detector found, recorded by the
 * same pass that admits the rows, and each of these zeros is a different fact:
 *
 *  - every one of them charges to a CREDIT card AND that card's payment is really
 *    in the card-payments term, so this $0.00 is exactly right;
 *  - every one of them has stopped charging;
 *  - one or more charges on an account this projection does not read — the L.26
 *    signature, where the figure is simply WRONG and too low.
 *
 * ORDERED BY FAILURE DIRECTION, not by likelihood. Every branch here is a $0 the
 * reader may spend against, so the two that mean "this number is missing money"
 * are asserted first: a reader shown "all charged to a card" when a bill was in
 * fact dropped has been told his zero is correct, which is the false all-clear
 * this whole thread exists to remove. The reverse mistake — hedging a line that is
 * genuinely fine — only sends him to a list, which costs him a look and nothing else.
 * There is no "nothing was found" branch at all, for the reason the module header
 * gives: the stored table cannot prove an empty world.
 *
 * THE ALARM DOES NOT DIAGNOSE. It says the bills were found and are not in this
 * figure, and points at the list; it does not name a mechanism, because two
 * different mechanisms reach it (a series re-keyed onto an account the projection
 * cannot read, and an auto-loan ACH that must stay on the payment account) and a
 * sentence naming one would be false for the other. What they SHARE is the only
 * thing the reader needs and the only thing this may assert: the money is real
 * and it is not in the line. Checked rather than assumed — `SpendingPlanInput`
 * has no loan term of any kind, so an auto-loan ACH dropped by the payment-account
 * rule is missing from this plan outright, not held by some other line. Neither
 * case is benign here.
 *
 * WHAT IS DELIBERATELY NOT SEPARATED: a mixture of correct absences (some on a
 * card, some lapsed) falls through to L.29's "none counted", because a sentence
 * naming one mechanism would be false about the other rows, and a reader whose
 * zero is correct for two different correct reasons needs the list, not a
 * taxonomy. Rows whose reason was never recorded (stored before this shipped, or
 * seeded) land there too: an unrecorded reason may never be read as a good one.
 *
 * The non-zero label is unchanged, and a non-empty `scheduledFixed` keeps it even
 * at a zero total: a series list that rounds to nothing is a rounding artifact,
 * and "none counted" would be false while rows exist. An UNDERSTATED non-zero
 * figure is disclosed too, but in the basis sentence beside the row rather than
 * in the label — see `traceSafeToSpend`.
 */
function fixedLabel(plan: SpendingPlan, disclosures: SpendingPlanDisclosures): PlanRowLabel {
  if (plan.fixedExpensesCents !== 0 || plan.scheduledFixed.length > 0) {
    return { label: 'Fixed & recurring expenses (monthly pattern)' };
  }
  const seen = disclosures.fixedSeries;
  const absent = seen.detected - seen.counted;
  const unexplained: PlanRowLabel = {
    label: 'Fixed & recurring expenses (none counted)',
    action: { label: 'See your recurring bills', href: '/recurring' },
  };
  if (seen.uncounted > 0) {
    // The count is `uncounted`, NOT `detected` (critic P2-2/P2-4, found by both
    // critics): on a branch reserved for "this figure is missing money", naming
    // every detected bill invites the reader to add back bills that are correctly
    // elsewhere. A reader with 3 detected, 2 on a card and 1 lost was told "3 bills
    // found" beside a sentence that said one — two answers to one question, on one
    // page, which is the drift this module exists to prevent.
    return {
      label: `Fixed & recurring expenses (${bills(seen.uncounted)} found, not counted here)`,
      action: { label: 'See your recurring bills', href: '/recurring' },
    };
  }
  if (seen.noCashAccount > 0) {
    return {
      label: 'Fixed & recurring expenses (no checking or savings account linked)',
      action: { label: 'Link an account', href: '/accounts' },
    };
  }
  // A CORRECT absence gets no control: a link beside a figure that is right reads
  // as a correction (the L.29 rule).
  //
  // "All charged to a card" is a claim about ANOTHER LINE holding the money, so it
  // is only true while that line is actually acting (critic P1-2, executed). When
  // a card has no due date yet, or no statement generated, or is currency-withheld,
  // its obligation is excluded from `cardObligationsCents` ENTIRELY — `detect.ts`
  // says so out loud — so those bills are in NO term of this plan and BOTH lines
  // print $0.00. Asserting the card line holds them would be the false all-clear
  // this thread exists to remove, on the panel that removed it.
  const cardTermActs =
    plan.cardObligationsCents !== 0 &&
    disclosures.undatedCards.length === 0 &&
    disclosures.statementPendingCards.length === 0 &&
    disclosures.creditCardsOutsideFigure === 0;
  if (absent > 0 && seen.onCard === absent) {
    return cardTermActs ? { label: 'Fixed & recurring expenses (all charged to a card)' } : unexplained;
  }
  if (absent > 0 && seen.lapsed === absent) {
    return { label: 'Fixed & recurring expenses (none still charging)' };
  }
  // NO "nothing was found" BRANCH, deliberately — see the note above about what
  // `detected === 0` can and cannot prove. Both critics reproduced the same false
  // claim from it, so it is gone rather than narrowed.
  return unexplained;
}

/** "1 bill" / "3 bills" — pluralized here so the two surfaces that print this
 *  count cannot disagree about it. */
function bills(n: number): string {
  return `${n} bill${n === 1 ? '' : 's'}`;
}

/**
 * THE CASE NO LABEL CAN REACH: a NON-ZERO fixed-expenses figure that is short.
 *
 * `fixedLabel` speaks only when the line is $0.00, so a reader with four counted
 * bills and a fifth the projection lost sees a confident number with no hint that
 * it is missing money — the same direction as the broken zero and considerably
 * quieter. This sentence is therefore gated on the FACT rather than on the figure,
 * and fires in both states.
 *
 * Authored here, beside the label, because two surfaces print it (the /spending-plan
 * basis list and the Ask answer's qualifiers) and L.29 was paid for by exactly this
 * mistake: the four labels were two copies and had already drifted.
 *
 * It names no cause — two mechanisms reach this count and a sentence naming one
 * would be false for the other (see `fixedLabel`) — and no AMOUNT, because the
 * census counts series and never sums them. A dollar figure here would be one the
 * panel below cannot reconcile against its own rows.
 *
 * Returns null when there is nothing to disclose, so a caller cannot print an
 * empty qualifier.
 *
 * `headline` IS REQUIRED, and it is not decoration. A missing bill makes the
 * amount free to spend SMALLER and an overage BIGGER — the same fact pointing in
 * opposite directions — and the two surfaces do not render the same figure: the
 * trace always carries left-to-spend (negative when overspent), while the Ask
 * answer's overspent branch renders the OVERAGE, the negation of it. The first
 * draft of this sentence said "too generous" unconditionally, which is backwards
 * for every overspent reader on Ask. Every sibling qualifier in `answer.ts`
 * already flips on exactly this, so the direction is the caller's fact to state,
 * never a default this module can pick (the L.15 defaulted-argument rule).
 */
export function uncountedFixedNote(
  disclosures: SpendingPlanDisclosures,
  headline: 'left-to-spend' | 'overage',
  /**
   * What THIS surface calls the thing the bill is missing from — also required,
   * for the same reason as `headline`. /spending-plan and Ask both print a line
   * called "Fixed & recurring expenses"; /budgets prints no such line at all, only
   * a "Fixed costs" bucket that also contains card payments, so naming a line
   * there points at nothing (critic P2-3, executed against the component's own
   * labels).
   */
  lineName: 'the fixed-expenses line' | 'your fixed costs',
): string | null {
  const n = disclosures.fixedSeries.uncounted;
  if (n <= 0) return null;
  const subject = n === 1 ? 'One repeating bill we found is' : `${n} repeating bills we found are`;
  const direction =
    headline === 'overage'
      ? 'the real overage is bigger than shown by that much'
      : 'the real amount free to spend is smaller than shown by that much';
  return `${subject} not in ${lineName}, so your real fixed costs are higher than shown and ${direction}. Your recurring list shows every bill we found, including ${n === 1 ? 'it' : 'these'}.`;
}

/**
 * Four zeros wearing one sentence, separated, and ordered so that the strongest
 * claim is made last.
 *
 * "None due this month" is the only branch that asserts an ABSENCE of demand, and
 * it is reachable only after every way of not knowing has been ruled out. Both L.29
 * critics broke the first cut here, independently and in the same direction:
 *  - a card the figure could not COUNT (no due date yet, or no statement generated)
 *    may perfectly well be due inside this month — the panel says so itself, twelve
 *    lines lower, under "What this figure can't see" — so with one of those present
 *    the honest word is "counted", the same word the fixed row uses and for the same
 *    reason;
 *  - a card the figure could not SEE at all (non-USD, withheld from the snapshot)
 *    makes even "no credit cards linked" false, which is why that branch now reads a
 *    linkage count rather than the snapshot;
 *  - and "dated past the edge" is a fact about DATES, so it may not be read off
 *    `obligationsBeyondMonthCents`, which is a NET figure that falls to zero exactly
 *    when next month's income covers the payment — the commonest issuer pattern
 *    (paid the 1st, cards due the 3rd), where the old code printed "none due this
 *    month" three days before a statement.
 *
 * The failure direction is why the ordering is worth the branches: every one of
 * these zeros is a $0 the reader may spend against, and "none due" is the only
 * wording that invites him to.
 *
 * No control on any branch: linking a card is not the remedy for a correct $0, and
 * the two excluded-card cases already carry their own sentences, each with its own
 * direction, on the same page.
 */
/**
 * The card facts the plan could not count, as sentences (O.18b critic P1-1).
 *
 * /budgets was the one surface printing this figure with NO excluded-card
 * disclosure — /spending-plan carries "What this figure can't see" and the
 * dashboard card carries its own notes, but the strip said nothing, and the
 * O.18b panels then certified the figure to the penny around the silence.
 * Authored here so the strip's visible notes and the bucket panels' basis
 * (which the share snapshot exports) are ONE text.
 *
 * Three separate sentences, never one, because their directions differ: an
 * uncounted card makes fixed costs UNDERstated (the guarded direction — the
 * reader overspends), a duplicated card makes them OVERstated, and a frozen
 * card is stale in an unknown direction. A sentence covering two of these
 * would be false about one of them.
 *
 * Scope matches the dashboard note deliberately: undated + statement-pending
 * only. A currency-withheld card is excluded by a different mechanism with its
 * own banner, and naming "no statement or due date yet" for it would state a
 * wrong reason — the dangerous half of a disclosure.
 *
 * KNOWN RESIDUAL (filed in TASKS): this is the class's THIRD author — the
 * dashboard card and /spending-plan each hand-roll their variants. Unifying
 * all three onto this module is its own slice; this function at least stops
 * the count growing past three.
 */
export function planCardNotes(
  disclosures: SpendingPlanDisclosures,
  /** Same contract as `uncountedFixedNote`: the caller states which figure it renders. */
  headline: 'left-to-spend' | 'overage',
): string[] {
  const notes: string[] = [];
  const lower =
    headline === 'overage'
      ? 'the real overage may be bigger than shown'
      : 'the real amount free to spend may be smaller than shown';
  const higher =
    headline === 'overage'
      ? 'the real overage may be smaller than shown'
      : 'the real amount free to spend may be bigger than shown';
  const excluded = disclosures.undatedCards.length + disclosures.statementPendingCards.length;
  if (excluded > 0) {
    notes.push(
      `Doesn’t count ${excluded === 1 ? 'a card' : `${excluded} cards`} with a balance but no statement or due date yet — your real fixed costs are higher than shown and ${lower}.`,
    );
  }
  if (disclosures.duplicatePairs.length > 0) {
    notes.push(
      `Two of the cards in the card-payments amount may be the same card counted twice; if so your real fixed costs are lower than shown and ${higher}. Nothing was adjusted — only you can confirm it, on Accounts.`,
    );
  }
  if (disclosures.frozenCards.length > 0) {
    notes.push(
      `${disclosures.frozenCards.length === 1 ? 'A card' : `${disclosures.frozenCards.length} cards`} behind the card-payments amount stopped being shared by the bank, so that amount may be stale.`,
    );
  }
  return notes;
}

function cardPaymentsLabel(plan: SpendingPlan, disclosures: SpendingPlanDisclosures): string {
  if (plan.cardObligationsCents !== 0) return 'Card payments due this month';
  if (disclosures.creditCardCount === 0) return 'Card payments (no credit cards linked)';
  if (
    disclosures.creditCardsOutsideFigure > 0 ||
    disclosures.undatedCards.length > 0 ||
    disclosures.statementPendingCards.length > 0
  ) {
    return 'Card payments (none counted this month)';
  }
  return disclosures.cardsDatedAfterThisMonth > 0
    ? 'Card payments (none due until after this month)'
    : 'Card payments (none due this month)';
}

/**
 * The one zero on this panel that is genuinely "you have not set this up", so
 * the one that carries a control.
 *
 * `savingsSource` alone cannot label the zero: it resolves a tie to 'goals', so a
 * reader with a target set and no income pattern yet — every figure zero — was
 * told the deciding input was goals they do not have. At $0 from a set target the
 * target is still what decided it, so the zero branch asks `savingsTargetBps`
 * directly. Above zero, `savingsSource` stays authoritative: a goal total that
 * beats the target really was decided by the goals (#295).
 *
 * ONE zero branch, deliberately, after the L.29 critics: the first cut split it by
 * a goal COUNT — "no goals" against "goals contributing nothing" — and offered the
 * second a link to /goals reading "Set a monthly amount on a goal". No such control
 * exists (`goal-actions.ts` creates and deletes goals; nothing updates one), so the
 * sentence promised a fix the app cannot perform on the figure most likely to be
 * too generous. The count could not carry the claim either: a saved debt-freedom
 * plan is a `Goal` row with no monthly amount to set, and a fully-funded goal never
 * leaves the table. The wording below is true in both states, and the control it
 * names — the Settings savings target — exists and really does move this line.
 */
function savingsLabel(plan: SpendingPlan): PlanRowLabel {
  if (plan.savingsSource === 'target') return { label: 'Savings target (from Settings)' };
  if (plan.plannedSavingsCents !== 0) return { label: 'Planned savings (goals)' };
  if (plan.savingsTargetBps != null) return { label: 'Savings target (from Settings)' };
  return {
    label: 'Planned savings (no monthly amount set)',
    action: { label: 'Set a savings target', href: '/settings' },
  };
}
