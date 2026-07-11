/**
 * Joint cash-needed read (TASKS 4.2 slice 4, HOUSEHOLD_ARCHITECTURE §4.4).
 * `getSharedSnapshotSlice` fetches exactly one live partner's shared-account
 * rows — the confidentiality boundary is the QUERY SCOPE (every `where`
 * carries `sharedToHousehold: true` + the partner's userId), never a
 * fetch-full-then-filter (critic F5, same defense class as `visibleAccountsWhere`).
 * A partner's UNSHARED rows never enter process memory.
 *
 * Trust model: callers must pass a `partnerId` already verified as a live
 * household member (e.g. from `partnerIdsOf(viewer)`, which is itself sourced
 * from a DB-fresh membership read) — same trust boundary `partnerSharedAccountsWhere`
 * already relies on.
 */
import { prisma } from '@/lib/db';
import type { ISODate } from '@/lib/dates';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import type { PartnerSnapshotSlice } from '@/lib/engine/household/merge-snapshot';
import { isSupportedCurrency } from '@/lib/providers/currency';
import { getProvider } from '@/lib/providers/demo';

export async function getSharedSnapshotSlice(partnerId: string): Promise<PartnerSnapshotSlice> {
  // The partner's OWN business day (§4.4 drift guard) — today this is the same
  // server clock as the viewer's, but resolved honestly rather than assumed.
  const partnerToday: ISODate = getProvider().today(partnerId);

  const sharedWhere = { userId: partnerId, sharedToHousehold: true } as const;
  const ownedByShared = { account: sharedWhere } as const;

  // Mirrors DemoProvider.getFinanceSnapshot's query shapes exactly (parity with
  // the personal path) — only the `where` scope differs (partner + share flag).
  const [accounts, autopays, statements, cardPayments, transactions, scheduled] = await Promise.all([
    prisma.account.findMany({ where: sharedWhere, orderBy: { id: 'asc' } }),
    prisma.autopayConfig.findMany({ where: ownedByShared }),
    prisma.statement.findMany({ where: ownedByShared, orderBy: { cycleEnd: 'asc' } }),
    prisma.cardPayment.findMany({ where: { statement: { account: sharedWhere } } }),
    prisma.transaction.findMany({
      where: { account: { ...sharedWhere, type: { in: [...SPENDING_ACCOUNT_TYPES] } } },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    }),
    prisma.scheduledTransaction.findMany({ where: ownedByShared }),
  ]);

  // Currency guard (DECISIONS #135 parity): a non-USD shared account is withheld
  // from every money engine, same as the owner's own dashboard would withhold it.
  const supportedAccounts = accounts.filter((a) => isSupportedCurrency(a.currency));
  const supportedIds = new Set(supportedAccounts.map((a) => a.id));

  return {
    today: partnerToday,
    accounts: supportedAccounts,
    autopays,
    statements,
    cardPayments,
    transactions: transactions.filter((t) => supportedIds.has(t.accountId)),
    scheduled: scheduled.filter((s) => supportedIds.has(s.accountId)),
  };
}
