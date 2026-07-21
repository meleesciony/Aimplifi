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
import { isSupportedCurrency } from './currency';
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
    // Currency guard (DECISIONS #135): the app does no FX, so a non-USD account — and ALL its
    // child rows — must be withheld from EVERY engine that reads the snapshot (net worth,
    // cash-needed, forecast, coach, the assistant, spending/reports/trends), else a foreign
    // balance OR transaction is summed at a fabricated 1:1. Filtering only `accounts` left the
    // account's transactions/scheduled in the snapshot (critic P1), so drop those by account too.
    // Demo / manual rows are null-currency = assumed USD, so this is a no-op for the golden dataset.
    const supportedAccounts = accounts.filter((a) => isSupportedCurrency(a.currency));
    const supportedIds = new Set(supportedAccounts.map((a) => a.id));
    // #254 critic F3: statements/cardPayments were returned unfiltered — safe
    // while every consumer joined them through the filtered accounts list, but
    // the cleared-streak engine reads statements join-free, so a withheld
    // account's statements would count in a streak. Filter them at the source
    // like every other child row (autopays stay as-is: no join-free consumer).
    const supportedStatements = statements.filter((s) => supportedIds.has(s.accountId));
    const supportedStatementIds = new Set(supportedStatements.map((s) => s.id));
    return {
      paymentAccountId: user?.paymentAccountId ?? null,
      accounts: supportedAccounts,
      autopays,
      statements: supportedStatements,
      cardPayments: cardPayments.filter((cp) => supportedStatementIds.has(cp.statementId)),
      transactions: transactions.filter((t) => supportedIds.has(t.accountId)),
      scheduled: scheduled.filter((s) => supportedIds.has(s.accountId)),
      balanceSnapshots: balanceSnapshots.filter((b) => supportedIds.has(b.accountId)),
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
