/**
 * Net worth over time (DECISIONS #40). One shared series builder for the
 * dashboard and the /accounts page — replacing the inline, hardcoded-liability
 * computation that used to live in src/server/finance.ts (a latent drift bug:
 * it didn't know about manual MORTGAGE / OTHER_LIABILITY types).
 *
 * Pure: a point's net worth = Σ (asset balances) − Σ (liability balances), with
 * asset/liability decided by the single `isLiabilityType` source of truth. Each
 * date's snapshots are summed by date, so the writer's contract is that ALL of a
 * user's accounts share ONE date per period — a bucket missing an account is not
 * a shorter list, it is an understated figure (see `snapshot-plan.ts`, which
 * holds that invariant; the seed satisfies it with month-ends, U.4's live writer
 * with the day each month's balances were read). The live "today" point is
 * computed from current balances over ALL accounts — including manual items,
 * which may have no historical snapshots — so the latest point matches the
 * headline net worth exactly. Two points can therefore cover DIFFERENT account
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
}

export interface NetWorthSeriesPoint {
  date: string; // YYYY-MM-DD
  netWorthCents: number;
  constituents: NetWorthConstituent[];
}

export function netWorthSeries(input: {
  snapshots: readonly { accountId: string; date: string; balanceCents: number }[];
  accounts: readonly { id: string; name: string; type: string; currentBalanceCents: number }[];
  today: string;
}): NetWorthSeriesPoint[] {
  const accountById = new Map(input.accounts.map((a) => [a.id, a]));
  const byDate = new Map<string, NetWorthConstituent[]>();

  for (const s of input.snapshots) {
    const acct = accountById.get(s.accountId);
    if (acct === undefined) continue; // snapshot for an account we don't have
    const arr = byDate.get(s.date) ?? [];
    arr.push({
      accountId: s.accountId,
      name: acct.name,
      balanceCents: (isLiabilityType(acct.type) ? -1 : 1) * s.balanceCents,
    });
    byDate.set(s.date, arr);
  }

  // Live point: current balances over ALL accounts (manual items included, even
  // though they carry no snapshot history). Replaces any same-dated snapshot.
  byDate.set(
    input.today,
    input.accounts.map((a) => ({
      accountId: a.id,
      name: a.name,
      balanceCents: (isLiabilityType(a.type) ? -1 : 1) * a.currentBalanceCents,
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
