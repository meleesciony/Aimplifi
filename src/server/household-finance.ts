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
import type { HouseholdDuplicateAccountCandidate } from '@/lib/engine/account/duplicates';
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
  // EVERY dependent row family is filtered by the surviving account set (slice-8
  // critic F-7): an orphan autopay/statement/cardPayment for a withheld account
  // must never travel into the merge, where a future consumer could act on it.
  // The withhold is COUNTED so callers can disclose it (critic F-6, #135 stance).
  const supportedAccounts = accounts.filter((a) => isSupportedCurrency(a.currency));
  const supportedIds = new Set(supportedAccounts.map((a) => a.id));
  const supportedStatements = statements.filter((s) => supportedIds.has(s.accountId));
  const supportedStatementIds = new Set(supportedStatements.map((s) => s.id));

  return {
    today: partnerToday,
    accounts: supportedAccounts,
    autopays: autopays.filter((a) => supportedIds.has(a.accountId)),
    statements: supportedStatements,
    cardPayments: cardPayments.filter((p) => supportedStatementIds.has(p.statementId)),
    transactions: transactions.filter((t) => supportedIds.has(t.accountId)),
    scheduled: scheduled.filter((s) => supportedIds.has(s.accountId)),
    withheldAccountCount: accounts.length - supportedAccounts.length,
  };
}

/**
 * Candidate rows for the household duplicate-account detector (slice-8 critic
 * F5 / T9(b)): the viewer's OWN accounts plus every partner's SHARED accounts —
 * exactly the set household-scope figures are computed over. Same share
 * predicate as everything else in this file (the confidentiality boundary is
 * the query scope, never fetch-then-filter). Supported currencies only: a
 * withheld account contributes to no figure, so it can't double-count one.
 */
export async function getHouseholdDuplicateCandidates(
  viewerId: string,
  partnerIds: string[],
): Promise<HouseholdDuplicateAccountCandidate[]> {
  const select = {
    id: true,
    userId: true,
    provider: true,
    name: true,
    type: true,
    mask: true,
    currentBalanceCents: true,
    currency: true,
  } as const;
  const [own, shared] = await Promise.all([
    prisma.account.findMany({ where: { userId: viewerId }, select, orderBy: { id: 'asc' } }),
    partnerIds.length > 0
      ? prisma.account.findMany({
          where: { userId: { in: partnerIds }, sharedToHousehold: true },
          select,
          orderBy: { id: 'asc' },
        })
      : Promise.resolve([]),
  ]);
  return [...own, ...shared]
    .filter((a) => isSupportedCurrency(a.currency))
    .map((a) => ({
      id: a.id,
      ownerId: a.userId,
      provider: a.provider,
      name: a.name,
      type: a.type,
      mask: a.mask,
      currentBalanceCents: a.currentBalanceCents,
      currency: a.currency,
    }));
}
