/**
 * Server-side finance reads: provider → assembler → pure engines.
 * All entry points take the session userId; every underlying query is
 * row-ownership scoped in the provider.
 */
import { holidayTable, type ISODate } from '@/lib/dates';
import { assembleCashNeededInput, netWorthCents } from '@/lib/engine/cash-needed/assemble';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import type { CashNeededResult } from '@/lib/engine/cash-needed/types';
import { getProvider } from '@/lib/providers/demo';
import type { FinanceSnapshot } from '@/lib/providers/types';
import type { Cents } from '@/lib/money';
import { cents } from '@/lib/money';

export interface NetWorthPoint {
  date: string;
  netWorthCents: number;
}

export interface DashboardData {
  today: string;
  paymentAccountName: string;
  /** The user's stored choice (may be null/unset) — distinct from the resolved
   *  paymentAccountName, which always falls back to a real account. Used to
   *  decide the onboarding nudge without a second user read. */
  paymentAccountId: string | null;
  payInFull: CashNeededResult;
  minimum: CashNeededResult;
  netWorthCents: Cents;
  netWorthTrend: NetWorthPoint[];
  accounts: { id: string; name: string; type: string; currentBalanceCents: number; mask: string | null }[];
}

/**
 * THE payment-account resolution — one definition (cycle-1 H1: three pages
 * had drifted copies that could disagree about which account "the answer"
 * is computed against).
 */
export function resolvePaymentAccount(snap: FinanceSnapshot) {
  const paymentAccount =
    snap.accounts.find((a) => a.id === snap.paymentAccountId) ??
    snap.accounts.find((a) => a.type === 'CHECKING') ??
    snap.accounts[0];
  if (!paymentAccount) throw new Error('No accounts found — run `npx prisma db seed`.');
  return paymentAccount;
}

/** THE cash-needed assembly — every page goes through this one path. */
export function cashNeededFromSnapshot(
  snap: FinanceSnapshot,
  today: ISODate,
  scenario: 'PAY_IN_FULL' | 'MINIMUM' = 'PAY_IN_FULL',
) {
  const year = Number(today.slice(0, 4));
  const input = assembleCashNeededInput({
    today,
    scenario,
    paymentAccountId: resolvePaymentAccount(snap).id,
    accounts: snap.accounts,
    autopays: snap.autopays,
    statements: snap.statements,
    cardPayments: snap.cardPayments,
    transactions: snap.transactions,
    scheduled: snap.scheduled,
    holidayTable: holidayTable(year - 1, year + 1),
  });
  return { input, result: computeCashNeeded(input) };
}

export async function getCashNeeded(userId: string, scenario: 'PAY_IN_FULL' | 'MINIMUM' = 'PAY_IN_FULL') {
  const provider = getProvider();
  const today = provider.today();
  const snap = await provider.getFinanceSnapshot(userId);
  return { today, snap, ...cashNeededFromSnapshot(snap, today, scenario) };
}

export async function getDashboardData(userId: string): Promise<DashboardData> {
  const provider = getProvider();
  const today = provider.today();
  const snap = await provider.getFinanceSnapshot(userId);
  const paymentAccount = resolvePaymentAccount(snap);

  const { input, result: payInFull } = cashNeededFromSnapshot(snap, today, 'PAY_IN_FULL');
  const minimum = computeCashNeeded({ ...input, scenario: 'MINIMUM' });

  // Net-worth trend from month-end snapshots (assets − liabilities per date).
  const liabilityTypes = new Set(['CREDIT', 'LOAN']);
  const typeById = new Map(snap.accounts.map((a) => [a.id, a.type]));
  const byDate = new Map<string, number>();
  for (const s of snap.balanceSnapshots) {
    const sign = liabilityTypes.has(typeById.get(s.accountId) ?? '') ? -1 : 1;
    byDate.set(s.date, (byDate.get(s.date) ?? 0) + sign * s.balanceCents);
  }
  // Today's live point replaces any same-dated snapshot; drop anything dated
  // beyond "today" so the x-axis is strictly chronological history.
  const current = netWorthCents(snap.accounts);
  byDate.set(today, current);
  const netWorthTrend = [...byDate.entries()]
    .filter(([date]) => date <= today)
    .map(([date, value]) => ({ date, netWorthCents: value }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

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
    paymentAccountId: snap.paymentAccountId,
    payInFull,
    minimum,
    netWorthCents: cents(current),
    netWorthTrend,
    accounts,
  };
}
