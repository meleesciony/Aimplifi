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
import { type ISODate, addMonthsToMonthKey, formatISODate, isMonthEnd, isoDate, monthKey } from '@/lib/dates';
import { type Cents, formatCents } from '@/lib/money';

export function netWorthPointBasis(
  figureCents: Cents,
  date: ISODate,
): readonly [string, ...string[]] {
  const dateLabel = formatISODate(date);
  const monthEnd = isMonthEnd(date);
  return [
    // NOT "every account's": U.4 made a point with a missing account reachable
    // for real users (an account linked after the month was recorded, or one
    // deleted since — its snapshots cascade). The next line already says so; a
    // first sentence claiming completeness made that line a retraction rather
    // than an elaboration, and the first sentence is the one a reader stops at.
    `The ${formatCents(figureCents)} is the sum of the ${monthEnd ? 'month-end ' : ''}balances the app had recorded on ${dateLabel} — assets minus liabilities.`,
    `It is built from the snapshots the app held for that date; an account with no snapshot then is not in it.`,
  ];
}

/**
 * The delta under the net-worth headline (/dashboard and /accounts render the
 * same one), decided rather than labelled — because a difference between two
 * points is only a change in WEALTH when both points count the same accounts.
 *
 * U.4 is what made that a live concern. Before it, a real user had no snapshots
 * at all, so the trend held exactly one point, `prev` was null and this figure
 * never rendered; only the seeded demo — whose 18 buckets each carry all nine
 * accounts — ever produced it. Now a user who links a second bank (or types the
 * mortgage the /accounts placeholder literally advertises) mid-month lands in a
 * month already claimed by the writer, so their previous point is missing that
 * account by design: subtracting the two prints a quarter-million-dollar "change"
 * that never happened, and reversing which account arrived first prints it in
 * green. An account can leave the set too — deleting a synced row cascades its
 * snapshots, so an old point loses it retroactively.
 *
 * The constituents are already carried out of the same loop that produced each
 * figure (the O.18c/O.20d carry-out rule), so the sets are here to be compared
 * and no re-derivation is needed. When they differ, the honest output is not a
 * smaller number — it is the absence of one, WITH its reason named
 * (a-zero-is-a-claim: never a silent suppression).
 *
 * U.6 added the SECOND way two points can fail to be comparable: the same set of
 * accounts, counted under different classes. Before it, a reclassification
 * re-signed both points together — history was wrong but the delta between two
 * equally-wrong points still subtracted cleanly. Now each row keeps the class it
 * was read under, so the two points really do disagree, and subtracting them
 * would report 2× a balance as earnings. Same rule, one level down: a difference
 * is a change in wealth only when both points count the same accounts AND count
 * them the same way.
 *
 * The comparable branch's words still come from the date, the same rule
 * `netWorthPointBasis` applies above: "vs last month-end" is claimed only for a
 * point that IS a month-end AND is the month immediately before this one, since
 * a user whose only trigger is the nightly cron can carry a gap (a manual-only
 * user has no other trigger — `AutoSync` is gated on a live connection), and 38
 * days of drift labelled as one month's is the same class of lie.
 */
export interface NetWorthDeltaView {
  /** The signed change, or null when the two points are not comparable. */
  deltaCents: number | null;
  /** Beside the figure when there is one; on its own when there is not. */
  label: string;
}

interface DeltaPointLike {
  date: string;
  netWorthCents: number;
  /** `balanceCents` is read only to tell a class change that MOVES the figure
   *  from one that cannot (a $0.00 account changing sides). */
  constituents: readonly { accountId: string; isLiability: boolean; balanceCents: number }[];
}

export function netWorthDelta(
  previous: DeltaPointLike,
  current: DeltaPointLike,
): NetWorthDeltaView {
  const before = new Set(previous.constituents.map((c) => c.accountId));
  const after = new Set(current.constituents.map((c) => c.accountId));
  const joined = [...after].filter((id) => !before.has(id)).length;
  const left = [...before].filter((id) => !after.has(id)).length;
  const when = formatISODate(isoDate(previous.date), 'long');

  // Computed before the set branch so a point that changed BOTH ways can say so:
  // "1 account joined" sends the reader to their account list, where they find
  // the new account and stop — a complete-looking answer to half the question.
  // (Ids present in both points only; a joined/left account has no counterpart
  // to disagree with.)
  const previousById = new Map(previous.constituents.map((c) => [c.accountId, c]));
  // DISTINCT accounts, like the joined/left checks above, which use Sets — the
  // engine blesses two same-account constituents on one date, so counting an
  // array here would disagree with the branch directly above it.
  const movedIds = new Set(
    current.constituents
      .filter((c) => {
        const before = previousById.get(c.accountId);
        if (before === undefined || before.isLiability === c.isLiability) return false;
        // A class change only DISTORTS the subtraction through the previous
        // point's contribution: had the class been stable, that term would have
        // carried the current sign, so the spurious amount is exactly 2× the
        // previous balance. At $0.00 it is 2 × 0. Refusing there would delete a
        // true figure over a paid-off card or a closed account the feed moved —
        // routine events, and a false refusal is as much a defect as a false
        // number.
        return before.balanceCents !== 0;
      })
      .map((c) => c.accountId),
  );
  const reclassified = movedIds.size;
  // One clause, reused by both branches: the reader needs the same words for the
  // same event whether or not the account set moved too.
  const movedClause =
    reclassified === 1
      ? 'one account moved between the things you own and the things you owe'
      : `${reclassified} accounts moved between the things you own and the things you owe`;

  if (joined > 0 || left > 0) {
    const plural = (n: number) => (n === 1 ? 'account' : 'accounts');
    const setClause =
      joined > 0 && left > 0
        ? 'the accounts counted have changed'
        : joined > 0
          ? `${joined} ${plural(joined)} joined`
          : `${left} ${plural(left)} left`;
    return {
      deltaCents: null,
      label: `No comparison — ${setClause} since ${when}${reclassified > 0 ? `, and ${movedClause}` : ''}.`,
    };
  }

  // Same accounts, counted the other way round: an account that was a liability
  // on one of these dates and an asset on the other (U.6 — the providers rewrite
  // `Account.type`, and the row now keeps the class it was read under, so the two
  // points genuinely disagree instead of both being rewritten together). The
  // subtraction would print 2× that balance as a change in wealth on a month
  // where nothing was earned, spent or paid — the same lie as a changed account
  // SET, one level down: a set can match while the measurement does not.
  //
  // The sentence leads with the DATE and spells the move out, because the reader
  // has no other way to find the account: /accounts groups by an account's
  // CURRENT class, so the one that moved sits among its new neighbours looking
  // ordinary. The three siblings above can be resolved from the account list;
  // this one cannot, so it says where to look.
  if (reclassified > 0) {
    return {
      deltaCents: null,
      label: `No comparison — since ${when} ${movedClause}, so the two dates are not measuring the same thing. Open that account on Accounts to see which balances were counted which way.`,
    };
  }

  const prevDate = isoDate(previous.date);
  const lastMonthEnd =
    isMonthEnd(prevDate) &&
    addMonthsToMonthKey(monthKey(previous.date), 1) === monthKey(current.date);
  return {
    deltaCents: current.netWorthCents - previous.netWorthCents,
    label: lastMonthEnd ? 'vs last month-end' : `vs ${when}`,
  };
}

/**
 * What the trend chart is made of, stated once for both surfaces that draw it.
 *
 * U.6 is why the second sentence exists. The rule above names ONE reason a point
 * can differ from what a reader expects (an account the app had no balance for),
 * and U.6 created a second: a point before a reclassification is drawn on the
 * opposite side from a point after it, which on the chart is a cliff of twice the
 * balance with no transaction behind it. `netWorthDelta` only ever compares the
 * LAST two points (both call sites), so a move further back refuses nothing and
 * the chart is the only thing that speaks. Opening a gap grows the disclosure
 * that enumerates them — the inverse of the closing-a-gap lesson below.
 *
 * A POSITIVE admission rule, not a list of exclusions
 * (docs/lessons/closing-a-gap-shrinks-the-disclosure-that-described-it.md): it
 * says what IS in a point, so every account the app cannot put there — one
 * linked after that month was recorded, one withheld by the currency guard, one
 * whose rows were deleted with it — is covered without being enumerated. The
 * sentence it replaces ("Trend uses month-end balances across all accounts")
 * asserted a SHAPE that U.4 ended and a COMPLETENESS that was never true.
 */
export const NET_WORTH_TREND_BASIS =
  'Each point is the balances the app had recorded on that date, counted as what each account was classed as then — an account it had no balance for then is not in it. If an account moves between what you own and what you owe, points before and after that move are drawn on opposite sides. Today’s point is your live balances.';

export function netWorthLiveBasis(figureCents: Cents): readonly [string, ...string[]] {
  return [
    `The ${formatCents(figureCents)} is today's live balance across every account — manual items included.`,
    // "not a month-end snapshot" named a shape that no longer exists on a live
    // user's chart — U.4's rows are dated the day the balance was read. The
    // contrast that still holds is recorded-earlier vs right-now.
    `It is the same live balances the headline above shows right now, not a balance recorded earlier.`,
  ];
}
