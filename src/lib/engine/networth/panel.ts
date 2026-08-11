/**
 * Basis sentences behind the net-worth trend drilldown (O.20d).
 *
 * Engine-composed with the RENDERED figure embedded — a rule written in a .tsx
 * cannot be locked by a unit test, and these sentences state what the two point
 * kinds are built from, which the surfaces must never re-state in their own
 * words (the O.18c `a-link-on-a-figure-asserts-two-engines-agree` rule).
 *
 * Month-end points are built from the snapshots the app held for their date;
 * the live "today" point is built from every account's current balance. The two
 * sentences must never be swapped — the panel behind a month-end point saying
 * "manual items included" would be a lie the series engine cannot see.
 *
 * KNOWN COUPLING (critic P2-4, accepted as latent): the month-end sentence
 * calls snapshot dates "month-end" because every snapshot writer today writes
 * month-ends (the seed's balance snapshots are the only writer). If a future
 * writer snapshots on arbitrary dates, a mid-month point would render
 * "month-end balance on Jul 15" — the sentence must then be parameterized by
 * what the writer actually wrote. No reachable state violates it today.
 */
import { type Cents, formatCents } from '@/lib/money';

export function netWorthMonthEndBasis(
  figureCents: Cents,
  dateLabel: string,
): readonly [string, ...string[]] {
  return [
    `The ${formatCents(figureCents)} is the sum of every account's month-end balance on ${dateLabel} — assets minus liabilities.`,
    `It is built from the snapshots the app held for that date; an account with no snapshot then is not in it.`,
  ];
}

export function netWorthLiveBasis(figureCents: Cents): readonly [string, ...string[]] {
  return [
    `The ${formatCents(figureCents)} is today's live balance across every account — manual items included.`,
    `It is the same live balances the headline above shows right now, not a month-end snapshot.`,
  ];
}
