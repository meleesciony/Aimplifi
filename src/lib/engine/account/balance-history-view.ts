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
 */
import { cents, formatCents } from '@/lib/money';

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
 */
export function uncountedBalancesNote(uncountedCount: number): string | null {
  if (uncountedCount <= 0) return null;
  const subject =
    uncountedCount === 1
      ? 'One balance here is not in your net worth'
      : `${uncountedCount} balances here are not in your net worth`;
  return (
    `${subject}. You combined this account with another one, and both sides recorded a balance on ` +
    `${uncountedCount === 1 ? 'that date' : 'those dates'} — Aimplifi keeps one of them so the same ` +
    `account is not counted twice. The pair is listed under Account cleanup.`
  );
}
