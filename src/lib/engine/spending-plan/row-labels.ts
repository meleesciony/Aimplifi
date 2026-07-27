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
 * WHAT IT DELIBERATELY DOES NOT CLAIM. The fixed-expenses zero says "none
 * counted" and never "none detected": this module cannot tell an empty detector
 * from a projection that dropped every row (the L.26 signature), and asserting
 * the first would restate the very false all-clear the slice exists to remove.
 * Distinguishing those two needs the account-scope predicate that decides which
 * detected series become projected rows, not a count — recorded as an open
 * residual in docs/STATUS.md §L.29 rather than guessed at here.
 *
 * Pure: strings in, strings out; no I/O, no Date, no money arithmetic — every
 * figure these labels sit beside is computed by the engine and copied verbatim.
 */
import type { SpendingPlan, SpendingPlanDisclosures } from './plan';

/** One printed line's label, plus the control a "not set up" zero should offer. */
export interface PlanRowLabel {
  label: string;
  /**
   * Where a reader can act on a zero that means "you have not set this up"
   * (never on a zero that means "nothing qualified"). Absent on every non-zero
   * row: a control offered beside a working figure reads as a correction.
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
    fixed: fixedLabel(plan),
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
 * Zero here means no repeating bill reached this month's figure. It may NOT be
 * read back as "you have no repeating bills": a bill charged to a credit card is
 * correctly absent (it arrives through the card-payments line instead), a
 * long-rhythm series that has stopped charging is correctly absent, and a
 * projection that lost every row — L.26, on the owner's live data — is
 * indistinguishable from both here. So the label states the mechanism it can
 * prove ("none counted") and hands the reader the list that shows what the app
 * did detect, which is the one place the three cases look different.
 *
 * The non-zero label is unchanged, and a non-empty `scheduledFixed` keeps it
 * even at a zero total: a series list that rounds to nothing is a rounding
 * artifact, and "none counted" would be false while rows exist.
 */
function fixedLabel(plan: SpendingPlan): PlanRowLabel {
  if (plan.fixedExpensesCents !== 0 || plan.scheduledFixed.length > 0) {
    return { label: 'Fixed & recurring expenses (monthly pattern)' };
  }
  return {
    label: 'Fixed & recurring expenses (none counted)',
    action: { label: 'See your recurring bills', href: '/recurring' },
  };
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
