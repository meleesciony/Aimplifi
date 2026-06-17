/**
 * Net worth over time (DECISIONS #40). One shared series builder for the
 * dashboard and the /accounts page — replacing the inline, hardcoded-liability
 * computation that used to live in src/server/finance.ts (a latent drift bug:
 * it didn't know about manual MORTGAGE / OTHER_LIABILITY types).
 *
 * Pure: month-end net worth = Σ (asset balances) − Σ (liability balances), with
 * asset/liability decided by the single `isLiabilityType` source of truth. Each
 * period's snapshots are summed by date (providers snapshot every account per
 * period). The live "today" point is computed from current balances over ALL
 * accounts — including manual items, which have no historical snapshots — so the
 * latest point matches the headline net worth exactly.
 */
import { isLiabilityType } from '@/lib/engine/transactions/query';

export interface NetWorthSeriesPoint {
  date: string; // YYYY-MM-DD
  netWorthCents: number;
}

export function netWorthSeries(input: {
  snapshots: readonly { accountId: string; date: string; balanceCents: number }[];
  accounts: readonly { id: string; type: string; currentBalanceCents: number }[];
  today: string;
}): NetWorthSeriesPoint[] {
  const typeById = new Map(input.accounts.map((a) => [a.id, a.type]));
  const byDate = new Map<string, number>();

  for (const s of input.snapshots) {
    const type = typeById.get(s.accountId);
    if (type === undefined) continue; // snapshot for an account we don't have
    const sign = isLiabilityType(type) ? -1 : 1;
    byDate.set(s.date, (byDate.get(s.date) ?? 0) + sign * s.balanceCents);
  }

  // Live point: current balances over ALL accounts (manual items included, even
  // though they carry no snapshot history). Replaces any same-dated snapshot.
  let current = 0;
  for (const a of input.accounts) current += (isLiabilityType(a.type) ? -1 : 1) * a.currentBalanceCents;
  byDate.set(input.today, current);

  return [...byDate.entries()]
    .filter(([date]) => date <= input.today) // strictly history, no future month-ends
    .map(([date, netWorthCents]) => ({ date, netWorthCents }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
