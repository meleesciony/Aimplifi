/**
 * Net worth over time (DECISIONS #40). One shared series builder for the
 * dashboard and the /accounts page — replacing the inline, hardcoded-liability
 * computation that used to live in src/server/finance.ts (a latent drift bug:
 * it didn't know about manual MORTGAGE / OTHER_LIABILITY types).
 *
 * Pure: a point's net worth = Σ (asset balances) − Σ (liability balances), with
 * asset/liability decided by the single `isLiabilityType` source of truth —
 * applied to the class each SNAPSHOT recorded, not to what its account has since
 * become (U.6; the providers rewrite `Account.type` on every sync). Each
 * date's snapshots are summed by date, so the writer's contract is that ALL of a
 * user's accounts share ONE date per period — a bucket missing an account is not
 * a shorter list, it is an understated figure (see `snapshot-plan.ts`, which
 * holds that invariant; the seed satisfies it with month-ends, U.4's live writer
 * with the day each month's balances were read). The live "today" point is
 * computed from current balances over every account — including manual items,
 * which may have no historical snapshots — except a combined-away row at $0.00
 * (#782), so the latest point matches the headline net worth exactly. Two points can therefore cover DIFFERENT account
 * sets; comparing them is `netWorthDelta`'s job, not a subtraction's.
 *
 * Every point carries its CONSTITUENTS — the signed account balances it was
 * summed from — carried out of the SAME loop that produced the figure (the
 * O.18c/O.20d carry-out rule), so a panel behind a point can show exactly what
 * the point is made of without re-deriving anything. Σ constituents ===
 * netWorthCents for every point by construction; the panel's "matched to the
 * penny" sentence is therefore a real check. Balances are signed: a liability
 * contributes negative.
 */
import { isLiabilityType } from '@/lib/engine/transactions/query';

export interface NetWorthConstituent {
  accountId: string;
  /** The name the reader knows the account by (the register's `accountLabel`). */
  name: string;
  /** Signed: assets positive, liabilities negative. */
  balanceCents: number;
  /**
   * The class this point counted the account under — carried because it can
   * DIFFER between two points of the same account (U.6), and because the sign of
   * `balanceCents` cannot be read backwards to recover it: a liability stored by
   * Plaid is negative when the card is overpaid, and an overdrawn checking or a
   * margin account is a genuinely negative ASSET. `netWorthDelta` compares this.
   */
  isLiability: boolean;
}

export interface NetWorthSeriesPoint {
  date: string; // YYYY-MM-DD
  netWorthCents: number;
  constituents: NetWorthConstituent[];
}

export function netWorthSeries(input: {
  snapshots: readonly {
    accountId: string;
    date: string;
    balanceCents: number;
    /**
     * The class the balance was READ under (U.6). Null only for rows written
     * before that column existed — see the sign note below.
     *
     * REQUIRED, not optional, deliberately: optional would let a caller's
     * `select` drop `accountType: true` and revert that surface to signing
     * history by the account's current type with `tsc` still clean and every
     * test green. A caller must SAY null; it cannot omit the question.
     */
    accountType: string | null;
  }[];
  accounts: readonly { id: string; name: string; type: string; currentBalanceCents: number }[];
  /**
   * The reconciliation boundary's effective predecessors (`supersededAccountIds`) — rows the
   * user combined into another account. Kept in `accounts` so their pre-cutover snapshots
   * still resolve, but left out of the LIVE point, whose job is "what your accounts are right
   * now". Owner-reported 2026-10-03: the old ····0977 sat in "Net worth today" at $0.00 beside
   * the live one (two `CREDIT CARD` rows — "counted twice"), and the combined-away rows made the
   * change line read "No comparison — N accounts joined". REQUIRED for the same reason
   * `accountType` is: an optional field lets a caller drop it with tsc clean.
   */
  supersededAccountIds: readonly string[];
  today: string;
}): NetWorthSeriesPoint[] {
  const superseded = new Set(input.supersededAccountIds);
  const accountById = new Map(input.accounts.map((a) => [a.id, a]));
  const byDate = new Map<string, NetWorthConstituent[]>();

  for (const s of input.snapshots) {
    const acct = accountById.get(s.accountId);
    if (acct === undefined) continue; // snapshot for an account we don't have
    // The ROW's own class decides its sign, never the account's current one: both
    // providers rewrite `Account.type` on every ordinary sync, so re-deriving it
    // here let a single reclassification flip the sign of history already
    // recorded (U.6). A collision winner is still that row — do not re-sign it
    // by the successor or drop the date (U.7, measured and refused). `accountType
    // == null` is the pre-U.6 row, the one case where there is nothing better to
    // use than what the account is today — the exact behaviour that shipped
    // before, kept only for rows written under it.
    // `''` as well as null: the column is a free-text `String?` that raw SQL can
    // write (the e2e does), and an empty string is not a class — it would fall
    // through `isLiabilityType`'s set membership and silently make a credit card
    // an asset. Absence is absence however it is spelled.
    const recordedType =
      s.accountType === null || s.accountType === '' ? acct.type : s.accountType;
    const isLiability = isLiabilityType(recordedType);
    const arr = byDate.get(s.date) ?? [];
    arr.push({
      accountId: s.accountId,
      name: acct.name,
      balanceCents: (isLiability ? -1 : 1) * s.balanceCents,
      isLiability,
    });
    byDate.set(s.date, arr);
  }

  // Live point: current balances over ALL accounts (manual items included, even
  // though they carry no snapshot history). Replaces any same-dated snapshot.
  // The account's CURRENT type is the right class here — this point is what the
  // accounts are right now, not what they were.
  //
  // A combined-away row is not one of "your accounts right now": the boundary already zeroed it,
  // so it can only add a $0.00 line that reads as a second copy of its successor. Skipped ONLY
  // at zero, so this can never move the figure: a superseded row that somehow still carries a
  // balance is in the headline, and stays here so the live point keeps matching it exactly.
  byDate.set(
    input.today,
    input.accounts.filter((a) => !(superseded.has(a.id) && a.currentBalanceCents === 0)).map((a) => ({
      accountId: a.id,
      name: a.name,
      balanceCents: (isLiabilityType(a.type) ? -1 : 1) * a.currentBalanceCents,
      isLiability: isLiabilityType(a.type),
    })),
  );

  return [...byDate.entries()]
    .filter(([date]) => date <= input.today) // strictly history, never a future date
    .map(([date, constituents]) => ({
      date,
      netWorthCents: constituents.reduce((s, c) => s + c.balanceCents, 0),
      // Deterministic row order for every point, in every surface: the
      // "Apr 30" and "Today" panels must list the same accounts in the SAME
      // sequence so a reader comparing two points can follow a row across
      // them. Database order is not that (O.20f P2-c). Σ is order-invariant,
      // so sorting never moves a figure.
      constituents: [...constituents].sort(
        (a, b) => a.name.localeCompare(b.name) || a.accountId.localeCompare(b.accountId),
      ),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
