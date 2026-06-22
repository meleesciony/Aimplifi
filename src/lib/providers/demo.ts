/**
 * DemoProvider — backed entirely by the seeded local database.
 * Runs with zero third-party credentials. "Today" is pinned via DEMO_TODAY
 * (default: the seed asOf) so the dataset stays coherent (DECISIONS #12).
 *
 * Row ownership: every query is scoped to the userId (directly or via the
 * owning account relation) — see docs/CRITIC_RUBRIC.md standing checks.
 */
import { prisma } from '@/lib/db';
import type { ISODate } from '@/lib/dates';
import { businessToday } from '@/lib/business-today';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import type { DataProvider, FinanceSnapshot, SyncResult } from './types';

export class DemoProvider implements DataProvider {
  today(userId?: string): ISODate {
    return businessToday(userId);
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
        // Spending accounts only — investment/loan activity isn't spending (#62).
        prisma.transaction.findMany({
          where: { account: { userId, type: { in: [...SPENDING_ACCOUNT_TYPES] } } },
          orderBy: [{ date: 'asc' }, { id: 'asc' }],
        }),
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
    if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
      throw new Error(
        'DATA_PROVIDER=plaid requires PLAID_CLIENT_ID and PLAID_SECRET (see docs/PLAID_WALKTHROUGH.md)',
      );
    }
    // Lazy import keeps the dormant Plaid code out of the demo path entirely.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PlaidProvider } = require('./plaid') as typeof import('./plaid');
    return new PlaidProvider();
  }
  return new DemoProvider();
}
