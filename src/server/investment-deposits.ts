/**
 * Loader for "Money you put in" (DECISIONS #788): the bank rows and accounts the
 * pure deposit engine reads.
 *
 * Rows come from the finance snapshot — the one assembler every money surface
 * reads, with the reconciliation boundary already applied (a combined account's
 * overlap counts once) and the currency guard (no FX) — and its own `terminalOf`,
 * from the same boundary call, so a re-linked checking's older rows read as the
 * live account, never as a second one. Accounts are the snapshot's minus the
 * superseded predecessors; their institution names are read through the live
 * connection row first, the disconnect stamp second (`resolveLiveInstitutionName`,
 * the identity ladder's own join).
 */
import { prisma } from '@/lib/db';
import { isoDate } from '@/lib/dates';
import { accountLabel } from '@/lib/engine/account/display-name';
import { handoverDatesFromKeys } from '@/lib/engine/account/reconcile-boundary';
import { accountRecords } from '@/lib/engine/analyst/account-records';
import { liveInstitutionByItem, resolveLiveInstitutionName } from '@/lib/engine/categorize/transfers';
import {
  computeDepositHistory,
  type DepositAccount,
  type DepositHistory,
  type DepositHistoryInput,
  type DepositRow,
} from '@/lib/engine/investments/deposits';
import { getProvider } from '@/lib/providers/demo';

/** The engine's inputs for one reader, unscoped — so a page can load them beside its other reads. */
export async function loadDepositInputs(userId: string): Promise<Omit<DepositHistoryInput, 'scopeAccountId'>> {
  const provider = getProvider();
  const today = isoDate(provider.today(userId));
  const [snap, accountRows, plaidItems] = await Promise.all([
    provider.getFinanceSnapshot(userId),
    prisma.account.findMany({
      where: { userId },
      select: {
        id: true,
        type: true,
        name: true,
        displayName: true,
        mask: true,
        institutionName: true,
        plaidItemId: true,
        feedDroppedAt: true,
        provider: true,
      },
    }),
    prisma.plaidItem.findMany({
      where: { userId },
      select: { itemId: true, institution: true, lastSyncedAt: true, lastSyncError: true },
    }),
  ]);

  const superseded = new Set(snap.supersededAccountIds ?? []);
  const inSnapshot = new Set(snap.accounts.map((a) => a.id));
  const institutionNameByItem = liveInstitutionByItem(plaidItems, (i) => i.institution);
  const liveRows = accountRows.filter((a) => inSnapshot.has(a.id) && !superseded.has(a.id));
  // The day a live feed vouches each record complete through — the same rule Ask's
  // same-account answers read (`accountRecords`: demo through today; a healthy Plaid item
  // through the day before its last successful sync; manual, dropped or failing: none).
  const completeThrough = new Map(
    accountRecords({
      accounts: liveRows.map((a) => ({
        id: a.id,
        name: accountLabel(a),
        provider: a.provider,
        plaidItemId: a.plaidItemId,
        feedDroppedAt: a.feedDroppedAt,
        recordStartWord: null,
        recordEndWord: null,
      })),
      rows: [],
      spendingAccountIds: new Set<string>(),
      terminalOf: snap.terminalOf ?? new Map<string, string>(),
      plaidItems,
      today,
    }).map((r) => [r.id, r.completeThrough]),
  );
  const accounts: DepositAccount[] = liveRows.map((a) => ({
    id: a.id,
    type: a.type,
    label: accountLabel(a),
    mask: a.mask,
    institutionName: resolveLiveInstitutionName(a.plaidItemId, a.institutionName, institutionNameByItem),
    feedName: a.name,
    completeThrough: completeThrough.get(a.id) ?? null,
  }));

  const rows: DepositRow[] = [];
  for (const t of snap.transactions) {
    if (typeof t.id !== 'string') continue;
    rows.push({
      id: t.id,
      accountId: t.accountId,
      date: t.date,
      amountCents: t.amountCents,
      rawDescriptor: t.rawDescriptor,
      status: t.status,
      categoryId: t.categoryId ?? null,
      isTransfer: t.isTransfer,
      isSplitParent: t.isSplitParent ?? false,
      excludeFromTotals: t.excludeFromTotals ?? null,
    });
  }

  return { today, rows, accounts, terminalOf: snap.terminalOf, handoverDates: handoverDatesFromKeys(snap.handoverKeys) };
}

export async function getDepositHistory(userId: string, scopeAccountId?: string): Promise<DepositHistory> {
  return computeDepositHistory({ ...(await loadDepositInputs(userId)), scopeAccountId });
}
