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
  /**
   * Investment-holdings reconciliation, set only by the SimpleFIN brokerage-holdings
   * ingest (DECISIONS #124). Optional — the demo/Plaid paths don't ingest holdings.
   * upserted = positions written/updated; removed = stale synced positions deleted
   * (sold); skipped = feed positions we couldn't record (un-mappable / out of bounds);
   * withheldNonUsd = positions withheld because their currency isn't USD (no FX — #156).
   */
  holdings?: { upserted: number; removed: number; skipped: number; withheldNonUsd: number };
}

export interface DataProvider {
  /** Business "today" — the real clock for real users; pinned for the demo user
   *  / when DEMO_TODAY is set so the seed stays coherent (DECISIONS #58). */
  today(userId?: string): ISODate;
  listAccounts(userId: string): Promise<AccountLike[]>;
  getStatements(userId: string, accountId: string): Promise<StatementLike[]>;
  /** Demo: no-op. Plaid (Phase 4): cursor-based /transactions/sync. */
  syncTransactions(userId: string, cursor?: string): Promise<SyncResult>;
  getFinanceSnapshot(userId: string): Promise<FinanceSnapshot>;
}
