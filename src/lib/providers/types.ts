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
  /** The user's designated card-payment (checking) account, if set. When that
   *  account is the PREDECESSOR of an active reconciliation (Wave 4.6), the
   *  assembler remaps this to the successor — the same real account's live side. */
  paymentAccountId: string | null;
  /** Accounts superseded by an active reconciliation (predecessor side; balance
   *  contributes 0). Funding-account FALLBACKS must never pick one of these —
   *  it would anchor cash-needed/forecast on a zeroed balance. Absent/empty when
   *  no reconciliation is active (the demo/golden path). */
  supersededAccountIds?: readonly string[];
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
  /**
   * Linked items whose own sync threw and was isolated (Plaid only; the failure is
   * audited and persisted as `lastSyncError`, and the sweep continues so one bad bank
   * cannot cost the others their data).
   *
   * Optional because only the Plaid path has per-item isolation. It exists because
   * without it a totally failed sync is INDISTINGUISHABLE from a clean one that found
   * nothing: `added: 0` with no error, which every caller then reports as "0 new
   * transactions". An empty set is not a fact
   * (docs/lessons/an-empty-set-is-not-a-fact-about-money.md).
   */
  itemsFailed?: number;
}

export interface DataProvider {
  /** Business "today" — the real clock for real users; pinned for the demo user
   *  / when DEMO_TODAY is set so the seed stays coherent (DECISIONS #58). */
  today(userId?: string): ISODate;
  listAccounts(userId: string): Promise<AccountLike[]>;
  getStatements(userId: string, accountId: string): Promise<StatementLike[]>;
  /**
   * Demo: no-op. Plaid (Phase 4): cursor-based /transactions/sync.
   *
   * The second parameter was `cursor?: string` and NO caller ever passed it — the
   * cursor is persisted per item and read inside the provider. Replaced with an
   * options bag carrying `itemId`, which scopes the sweep to ONE linked bank for
   * the per-connection "Sync" control (owner request 2026-07-23). Omit it to sync
   * every item, which is what every existing caller does.
   */
  syncTransactions(userId: string, opts?: { itemId?: string }): Promise<SyncResult>;
  getFinanceSnapshot(userId: string): Promise<FinanceSnapshot>;
}
