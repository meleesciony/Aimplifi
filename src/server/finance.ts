/**
 * Server-side finance reads: provider → assembler → pure engines.
 * All entry points take the session userId; every underlying query is
 * row-ownership scoped in the provider.
 */
import { holidayTable } from '@/lib/dates';
import { assembleCashNeededInput, netWorthCents } from '@/lib/engine/cash-needed/assemble';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import type { CashNeededResult } from '@/lib/engine/cash-needed/types';
import { getProvider } from '@/lib/providers/demo';
import type { Cents } from '@/lib/money';
import { cents } from '@/lib/money';

export interface NetWorthPoint {
  date: string;
  netWorthCents: number;
}

export interface DashboardData {
  today: string;
  paymentAccountName: string;
  payInFull: CashNeededResult;
  minimum: CashNeededResult;
  netWorthCents: Cents;
  netWorthTrend: NetWorthPoint[];
  accounts: { id: string; name: string; type: string; currentBalanceCents: number; mask: string | null }[];
}

export async function getDashboardData(userId: string): Promise<DashboardData> {
  const provider = getProvider();
  const today = provider.today();
  const snap = await provider.getFinanceSnapshot(userId);

  const paymentAccount =
    snap.accounts.find((a) => a.id === snap.paymentAccountId) ??
    snap.accounts.find((a) => a.type === 'CHECKING') ??
    snap.accounts[0];
  if (!paymentAccount) throw new Error('No accounts found — run `npx prisma db seed`.');

  const year = Number(today.slice(0, 4));
  const input = assembleCashNeededInput({
    today,
    scenario: 'PAY_IN_FULL',
    paymentAccountId: paymentAccount.id,
    accounts: snap.accounts,
    autopays: snap.autopays,
    statements: snap.statements,
    cardPayments: snap.cardPayments,
    transactions: snap.transactions,
    scheduled: snap.scheduled,
    holidayTable: holidayTable(year - 1, year + 1),
  });

  const payInFull = computeCashNeeded(input);
  const minimum = computeCashNeeded({ ...input, scenario: 'MINIMUM' });

  // Net-worth trend from month-end snapshots (assets − liabilities per date).
  const liabilityTypes = new Set(['CREDIT', 'LOAN']);
  const typeById = new Map(snap.accounts.map((a) => [a.id, a.type]));
  const byDate = new Map<string, number>();
  for (const s of snap.balanceSnapshots) {
    const sign = liabilityTypes.has(typeById.get(s.accountId) ?? '') ? -1 : 1;
    byDate.set(s.date, (byDate.get(s.date) ?? 0) + sign * s.balanceCents);
  }
  const netWorthTrend = [...byDate.entries()]
    .map(([date, value]) => ({ date, netWorthCents: value }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const current = netWorthCents(snap.accounts);
  netWorthTrend.push({ date: today, netWorthCents: current });

  const accounts = snap.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    currentBalanceCents: a.currentBalanceCents,
    mask: (a as { mask?: string | null }).mask ?? null,
  }));

  return {
    today,
    paymentAccountName: paymentAccount.name,
    payInFull,
    minimum,
    netWorthCents: cents(current),
    netWorthTrend,
    accounts,
  };
}
