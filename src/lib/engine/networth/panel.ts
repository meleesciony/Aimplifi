/**
 * Basis sentences behind the net-worth trend drilldown (O.20d).
 *
 * Engine-composed with the RENDERED figure embedded — a rule written in a .tsx
 * cannot be locked by a unit test, and these sentences state what the two point
 * kinds are built from, which the surfaces must never re-state in their own
 * words (the O.18c `a-link-on-a-figure-asserts-two-engines-agree` rule).
 *
 * The LIVE "today" point is built from every account's current balance and must
 * always use `netWorthLiveBasis` — a live point on a month-end date is still a
 * live point (manual items included). Every OTHER point is built from the
 * snapshots the app held for its date, and `netWorthPointBasis` derives the
 * sentence from the DATE ITSELF: a true month-end reads "month-end balance",
 * and a snapshot dated mid-month (the seed's `back === 0` row is dated `asOf`,
 * so `npx prisma db seed -- --asOf 2026-05-15` with `DEMO_TODAY` still
 * 2026-06-10 produces exactly one) reads "balance on" — never "month-end" over
 * a date that is not one (O.20f P2-g; the KNOWN COUPLING this replaces held
 * only by the coincidence that every snapshot writer wrote month-ends).
 */
import { type ISODate, formatISODate, isMonthEnd } from '@/lib/dates';
import { type Cents, formatCents } from '@/lib/money';

export function netWorthPointBasis(
  figureCents: Cents,
  date: ISODate,
): readonly [string, ...string[]] {
  const dateLabel = formatISODate(date);
  const monthEnd = isMonthEnd(date);
  return [
    `The ${formatCents(figureCents)} is the sum of every account's ${monthEnd ? 'month-end ' : ''}balance on ${dateLabel} — assets minus liabilities.`,
    `It is built from the snapshots the app held for that date; an account with no snapshot then is not in it.`,
  ];
}

export function netWorthLiveBasis(figureCents: Cents): readonly [string, ...string[]] {
  return [
    `The ${formatCents(figureCents)} is today's live balance across every account — manual items included.`,
    `It is the same live balances the headline above shows right now, not a month-end snapshot.`,
  ];
}
