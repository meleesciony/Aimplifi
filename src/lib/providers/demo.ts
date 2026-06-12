/**
 * DemoProvider — backed entirely by the seeded local database.
 * Runs with zero third-party credentials. "Today" is pinned via DEMO_TODAY
 * (default: the seed asOf) so the dataset stays coherent (DECISIONS #12).
 *
 * Row ownership: every query is scoped to the userId (directly or via the
 * owning account relation) — see docs/CRITIC_RUBRIC.md standing checks.
 */
import { prisma } from '@/lib/db';
import { type ISODate, isoDate } from '@/lib/dates';
import { DEFAULT_AS_OF } from '@/lib/seed/build';
import type { DataProvider, FinanceSnapshot, SyncResult } from './types';

export class DemoProvider implements DataProvider {
  today(): ISODate {
    return isoDate(process.env.DEMO_TODAY ?? DEFAULT_AS_OF);
  }

  async listAccounts(userId: string) {
    return prisma.account.findMany({ where: { userId }, orderBy: { id: 'asc' } });
  }

  async getStatements(userId: string, accountId: string) {
    return prisma.statement.findMany({
      where: { accountId, account: { userId } },
      orderBy: { cycleEnd: 'desc' },
    });
  }

  async syncTransactions(): Promise<SyncResult> {
    // Demo data is static; nothing to sync.
    return { added: 0, modified: 0, removed: 0, nextCursor: null };
  }

  async getFinanceSnapshot(userId: string): Promise<FinanceSnapshot> {
    const ownedByUser = { account: { userId } } as const;
    const [user, accounts, autopays, statements, cardPayments, transactions, scheduled, balanceSnapshots] =
      await Promise.all([
        prisma.user.findUnique({ where: { id: userId } }),
        prisma.account.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
        prisma.autopayConfig.findMany({ where: ownedByUser }),
        prisma.statement.findMany({ where: ownedByUser, orderBy: { cycleEnd: 'asc' } }),
        prisma.cardPayment.findMany({ where: { statement: { account: { userId } } } }),
        prisma.transaction.findMany({ where: ownedByUser, orderBy: [{ date: 'asc' }, { id: 'asc' }] }),
        prisma.scheduledTransaction.findMany({ where: ownedByUser }),
        prisma.balanceSnapshot.findMany({ where: ownedByUser, orderBy: { date: 'asc' } }),
      ]);
    return {
      paymentAccountId: user?.paymentAccountId ?? null,
      accounts,
      autopays,
      statements,
      cardPayments,
      transactions,
      scheduled,
      balanceSnapshots,
    };
  }
}

export function getProvider(): DataProvider {
  const which = process.env.DATA_PROVIDER ?? 'demo';
  if (which === 'plaid') {
    // PlaidProvider lands in Phase 4 behind this same interface.
    throw new Error('DATA_PROVIDER=plaid is not available yet (Phase 4). Use demo.');
  }
  return new DemoProvider();
}
