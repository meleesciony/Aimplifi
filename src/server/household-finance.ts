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
import { activeSupersededPredecessorIds } from '@/server/reconciliation';

export async function getSharedSnapshotSlice(partnerId: string): Promise<PartnerSnapshotSlice> {
  // The partner's OWN business day (§4.4 drift guard) — today this is the same
  // server clock as the viewer's, but resolved honestly rather than assumed.
  const partnerToday: ISODate = getProvider().today(partnerId);

  const sharedWhere = { userId: partnerId, sharedToHousehold: true } as const;
  const ownedByShared = { account: sharedWhere } as const;

  // Mirrors DemoProvider.getFinanceSnapshot's query shapes exactly (parity with
  // the personal path) — only the `where` scope differs (partner + share flag).
  const [accounts, autopays, statements, cardPayments, transactions, scheduled] = await Promise.all([
    prisma.account.findMany({
      where: sharedWhere,
      // An explicit column list, not a bare read (TASKS L.7 critic F6): the first fix for the
      // nickname leak fetched every column and deleted one by name, which is the
      // fetch-full-then-filter shape this file's own header forbids three lines above. A
      // `select` fails CLOSED — the next user-authored column added to `Account` (a note, a
      // tag, a goal label) does not silently join a partner's snapshot the way `displayName`
      // did. `displayName` is absent BY CONSTRUCTION, so it never reaches process memory.
      select: {
        id: true,
        name: true,
        provider: true,
        type: true,
        mask: true,
        currency: true,
        currentBalanceCents: true,
        aprBps: true,
        minimumPaymentCents: true,
        dueDayOfMonth: true,
        cycleCloseDayOfMonth: true,
        feedDroppedAt: true,
      },
      orderBy: { id: 'asc' },
    }),
    prisma.autopayConfig.findMany({ where: ownedByShared }),
    prisma.statement.findMany({ where: ownedByShared, orderBy: { cycleEnd: 'asc' } }),
    prisma.cardPayment.findMany({ where: { statement: { account: sharedWhere } } }),
    prisma.transaction.findMany({
      where: { account: { ...sharedWhere, type: { in: [...SPENDING_ACCOUNT_TYPES] } } },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    }),
    prisma.scheduledTransaction.findMany({ where: ownedByShared }),
  ]);

  // Reconciliation (Wave 4.6 slice 4, R5): a superseded predecessor is NOT part of
  // the shared set — the live successor is the single account the household sees, so
  // the stale predecessor must not double-count in the partner's joint cash-needed.
  // Excluding it from the account list cascades to EVERY child row via `supportedIds`
  // (same mechanism as the currency guard), so no per-row-family fence is needed.
  const supersededIds = await activeSupersededPredecessorIds([partnerId]);

  // Currency guard (DECISIONS #135 parity): a non-USD shared account is withheld
  // from every money engine, same as the owner's own dashboard would withhold it.
  // EVERY dependent row family is filtered by the surviving account set (slice-8
  // critic F-7): an orphan autopay/statement/cardPayment for a withheld account
  // must never travel into the merge, where a future consumer could act on it.
  // The withhold is COUNTED so callers can disclose it (critic F-6, #135 stance) —
  // and it stays CURRENCY-only: a superseded predecessor is not "withheld", it is
  // the owner's stale duplicate the partner should simply never see.
  const currencySupported = accounts.filter((a) => isSupportedCurrency(a.currency));
  const supportedAccounts = currencySupported.filter((a) => !supersededIds.has(a.id));
  const supportedIds = new Set(supportedAccounts.map((a) => a.id));
  const supportedStatements = statements.filter((s) => supportedIds.has(s.accountId));
  const supportedStatementIds = new Set(supportedStatements.map((s) => s.id));

  return {
    today: partnerToday,
    // TASKS L.7, found by a fresh-context critic. A partner's private nickname never enters
    // this slice — see the `select` above, which omits it by construction. That is deliberately
    // the ONLY fence: `displayName` is a label its author typed for himself ("Divorce lawyer
    // card"), and sharing an account shares its money, not the words he chose in private. Every
    // household-scope label therefore falls back to the bank's own name by the ordinary
    // `accountLabel` rule, with nothing per-surface to forget — cards, loans, reminders,
    // /calendar, the digest email and push all read this one slice.
    accounts: supportedAccounts,
    autopays: autopays.filter((a) => supportedIds.has(a.accountId)),
    statements: supportedStatements,
    cardPayments: cardPayments.filter((p) => supportedStatementIds.has(p.statementId)),
    transactions: transactions.filter((t) => supportedIds.has(t.accountId)),
    scheduled: scheduled.filter((s) => supportedIds.has(s.accountId)),
    withheldAccountCount: accounts.length - currencySupported.length,
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
    // Labelling only, and only ever printed back for the VIEWER's own rows (TASKS L.7 critic
    // F2). The detector below compares `name`; a partner's nickname is dropped by the caller.
    displayName: true,
    type: true,
    mask: true,
    // Bank data, never user-typed: the L.9 registration veto reads it so a partner's Roth is never
    // advised as a duplicate of the viewer's Traditional. Nothing prints it.
    subtype: true,
    currentBalanceCents: true,
    currency: true,
  } as const;
  const [own, shared, supersededIds] = await Promise.all([
    prisma.account.findMany({ where: { userId: viewerId }, select, orderBy: { id: 'asc' } }),
    partnerIds.length > 0
      ? prisma.account.findMany({
          where: { userId: { in: partnerIds }, sharedToHousehold: true },
          select,
          orderBy: { id: 'asc' },
        })
      : Promise.resolve([]),
    // R5 (slice 4): a reconciled pair is not an active duplicate — exclude the
    // superseded predecessor (viewer's own or a partner's) so the household
    // duplicate advisory never fires for a pair the user already reconciled.
    activeSupersededPredecessorIds([viewerId, ...partnerIds]),
  ]);
  return [...own, ...shared]
    .filter((a) => isSupportedCurrency(a.currency) && !supersededIds.has(a.id))
    .map((a) => ({
      id: a.id,
      ownerId: a.userId,
      provider: a.provider,
      name: a.name,
      type: a.type,
      mask: a.mask,
      subtype: a.subtype,
      currentBalanceCents: a.currentBalanceCents,
      currency: a.currency,
    }));
}
