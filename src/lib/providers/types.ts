/**
 * DataProvider — the seam between data sources (demo seed / Plaid) and the app.
 * Everything downstream consumes this interface; demo vs plaid is a runtime
 * switch via DATA_PROVIDER (Plaid lands in Phase 4).
 */
import type { ISODate } from '@/lib/dates';
import type {
  AccountLike,
  AutopayLike,
  CardPaymentLike,
  ScheduledLike,
  StatementLike,
  TransactionLike,
} from '@/lib/engine/cash-needed/assemble';

export interface BalanceSnapshotLike {
  accountId: string;
  date: string;
  balanceCents: number;
}

/** Everything the engines need, in one consistent read. */
export interface FinanceSnapshot {
  /** The user's designated card-payment (checking) account, if set. */
  paymentAccountId: string | null;
  accounts: AccountLike[];
  autopays: AutopayLike[];
  statements: StatementLike[];
  cardPayments: CardPaymentLike[];
  transactions: TransactionLike[];
  scheduled: ScheduledLike[];
  balanceSnapshots: BalanceSnapshotLike[];
}

export interface SyncResult {
  added: number;
  modified: number;
  removed: number;
  nextCursor: string | null;
}

export interface DataProvider {
  /** Business "today" — pinned in demo mode so the seed stays coherent. */
  today(): ISODate;
  listAccounts(userId: string): Promise<AccountLike[]>;
  getStatements(userId: string, accountId: string): Promise<StatementLike[]>;
  /** Demo: no-op. Plaid (Phase 4): cursor-based /transactions/sync. */
  syncTransactions(userId: string, cursor?: string): Promise<SyncResult>;
  getFinanceSnapshot(userId: string): Promise<FinanceSnapshot>;
}
