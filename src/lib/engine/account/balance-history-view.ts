/**
 * What the /accounts detail panel says about a recorded balance the net-worth
 * trend does NOT count (TASKS U.5).
 *
 * The panel lists every balance RECORDED for an account. The trend counts a
 * subset: combining two accounts (a bank moved between providers) makes both
 * sides carry a row on the SAME date — U.4 writes one date across all of a
 * user's accounts — and the reconciliation boundary keeps exactly one of them,
 * so the same real account is not counted twice. The dropped row is still a
 * balance the bank sent for this account, so the panel shows it; what it may
 * not do is carry a claim about counting.
 *
 * WHY A PURE MODULE, not a ternary in the .tsx (the discipline
 * `accounts-list.tsx` and `networth/panel.ts` both state outright): a rule
 * written in a component cannot be locked by a unit test. The first draft of
 * this copy lived inline and shipped a singular/plural defect in the branch the
 * component test did not cover.
 *
 * THE FACT RIDES THE ROW. The counted balance is named per row, not summarised
 * in the note, because each dropped date has its OWN counterpart figure: the
 * two sides of a combined pair disagree (that is why one has to win), and one
 * sentence covering several dates would either pick a figure that is wrong for
 * the others or state none at all. The same rule U.4 applied to
 * carried-forward rows and U.6 to a row's recorded class.
 *
 * U.10 is a different reason a recorded row does not feed the figure the
 * reader sees: `netWorthSeries` replaces today's snapshot bucket with live
 * balances so the latest point matches the headline. The boundary may still
 * KEEP that row (it is not a combine collision). The combine copy above would
 * be false of it — there is no counterpart, and the account IS in today's
 * net worth. `replacedByLiveMarker` / `replacedByLiveNote` name that rule.
 * One account has at most one row per date (`@@unique([accountId, date])`),
 * so the note is always singular.
 */
import { cents, formatCents } from '@/lib/money';
import { accountTypeLabel } from '@/lib/engine/account/type-label';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';

/** The balance the trend counts for a date this account's own row was dropped
 *  from — read off the reconciliation boundary's OUTPUT, never re-derived. */
export interface CountedInsteadOf {
  /** The combined account's display label, as the rest of /accounts renders it. */
  name: string;
  /** Magnitude as recorded; `isLiability` carries the sign (the U.6 rule — a
   *  stored balance's sign cannot recover its class). */
  balanceCents: number;
  isLiability: boolean;
}

/**
 * The marker on a row the trend does not count.
 *
 * Named outright ("your net worth"), never positionally: an earlier draft said
 * the row "is not counted here", and "here" inside a list titled *Recorded
 * balance history* makes the nearest antecedent the list itself — the
 * self-contradicting demonstrative L.19/L.20 removed from `feed-dropped-view`
 * for the same reason.
 *
 * With a counterpart it states the figure that IS counted, so the reader can
 * see the substitution instead of being told a balance simply does not apply.
 * Without one (a chain, where the date's owner is not this account's direct
 * counterpart) it states only what is certain.
 */
export function uncountedBalanceMarker(counted: CountedInsteadOf | null): string {
  if (counted === null) return 'not in your net worth';
  const amount = formatCents(cents(counted.balanceCents));
  return `your net worth counts ${counted.isLiability ? '−' : ''}${amount} from ${counted.name}`;
}

/**
 * The note under the list. It explains the mechanism ONCE — the figures are on
 * the rows — and points at the surface that shows the pair, because the
 * combined account named on those rows is deliberately folded out of the
 * account groups on this page (it would otherwise read as a name the reader
 * cannot find anywhere).
 *
 * It says the app kept ONE balance per date, never "counting both would double
 * it": the two sides carry DIFFERENT balances, so "double" is false of the two
 * figures actually in play, and the honest claim is about counting the same
 * account twice — not about doubling a number.
 *
 * Four separate claims in this one sentence were wrong, and two critics had to
 * take them apart clause by clause (docs/lessons/a-disclosure-is-several-claims-in-one-sentence):
 *
 *  1. NOT "both sides recorded a balance on that date". True only of the
 *     two-account pair it was written for. The date's winner is decided across the
 *     whole supersession COMPONENT, so the row that displaced this one can belong
 *     to a third account — a chain member (reachable since U.5, where this clause
 *     was already false) or a SIBLING, a second stale row continued onto the same
 *     live account (U.9). In the chain shape the reader's own counterpart may have
 *     recorded nothing at all that date; in the sibling shape there is no "both
 *     sides" to speak of, because three accounts are in play.
 *  2. NOT "another one" (singular). One live account may continue several old
 *     rows, and the panel that renders this note is the live one — the same page
 *     says "Combines 2 old accounts into this one" under Account cleanup.
 *  3. NOT "Aimplifi counts one of them". The nearest plural antecedent is the
 *     uncounted balances named in the first clause, none of which is counted;
 *     it read as a promise that one of the greyed rows in front of the reader is
 *     in their net worth.
 *  4. NOT "the same ACCOUNT is not counted twice", unqualified. That is a claim
 *     about every figure the account touches, and TASKS U.11 measures it false for
 *     spending: two stale feeds of one account still contribute a purchase twice.
 *     The de-duplication this note explains is over BALANCES, so the sentence says
 *     balances. A disclosure may only certify the surface it actually covers.
 *
 * And the first repair overshot: "more than one row CAN describe the same real
 * account" is a statement of possibility answering a question about an event. The
 * row was dropped because more than one row DID.
 */
export function uncountedBalancesNote(uncountedCount: number): string | null {
  if (uncountedCount <= 0) return null;
  const subject =
    uncountedCount === 1
      ? 'One balance here is not in your net worth'
      : `${uncountedCount} balances here are not in your net worth`;
  const dates = uncountedCount === 1 ? 'that date' : 'those dates';
  return (
    `${subject}. This account is combined with at least one other account you had, and on ${dates} ` +
    `more than one of them recorded a balance — Aimplifi counts a single balance per date for a ` +
    `combined account, so no balance is counted twice. Your combined accounts are listed under Account cleanup.`
  );
}

/**
 * The marker on a row dated today that the boundary kept. The chart's today
 * point is live balances, not this recording — even when the cents happen
 * to match (the seed's `back === 0` row equals `currentBalanceCents`).
 *
 * NOT the combine marker: that sentence names a counterpart and says the
 * account is "not in your net worth", both false here. The account counts
 * today; this recording is not what the chart reads.
 */
export function replacedByLiveMarker(): string {
  return "today's point is live";
}

/**
 * The note under the list. Mechanism once; the row already carries the
 * marker. Gated on the FACT (a kept row dated today), never on whether
 * the recorded cents currently differ from live — the overwrite always
 * happens, and a later sync the same day is exactly when the numbers
 * diverge. The seed's `back === 0` row equals `currentBalanceCents`,
 * so "not from this recording" would read as discarded dollars on the
 * path that always shows this note.
 *
 * No "tomorrow" clause: demo / `DEMO_TODAY` pins today, so that date's
 * bucket is overwritten on every load, and a later combine can drop
 * the recording even after the clock moves.
 */
export function replacedByLiveNote(): string {
  return (
    "One balance here is dated today. Today's chart point uses the live balance, " +
    'even when it still matches this recording.'
  );
}

/**
 * When a today-row was recorded under a different class than the account
 * has now: the live point signs by CURRENT type (`netWorthSeries`), so
 * the historical "for that date it counts on the own/owe side" sentence
 * is about the recording and would be false here.
 */
export function replacedByLiveClassNote(asClass: string): string {
  return `Today's live point counts this account as ${asClass}, not as the class on this recording.`;
}

/**
 * The panel's opening sentence (U.3 / U.8). The first clause is the
 * account's role in net worth — true of every type. The second clause
 * must not claim this account has no activity feed when it is one of
 * the three types whose primary click IS the register
 * (`SPENDING_ACCOUNT_TYPES`). A rule in the .tsx cannot be locked.
 */
export function accountDetailRoleLine(input: { type: string; isLiability: boolean }): string {
  const label = accountTypeLabel(input.type);
  const side = input.isLiability ? 'owe' : 'own';
  const role = `${label} — counts toward your net worth as money you ${side}.`;
  if (SPENDING_ACCOUNT_TYPES.includes(input.type)) {
    return `${role} Day-to-day activity is in Transactions.`;
  }
  return (
    `${role} Day-to-day transactions come from checking, savings, and card accounts, ` +
    'so this account is tracked by its balance instead of an activity feed.'
  );
}
