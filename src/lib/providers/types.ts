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
  /**
   * The account's class when this balance was read (U.6) — what decides whether
   * it adds to net worth or subtracts from it. Null on rows written before the
   * column existed, the only ones a reader signs by the account's current type.
   */
  accountType: string | null;
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
  /**
   * C.25 (DECISIONS #403): the READ-TIME loan-payment exclusion, computed
   * ONCE here so every flow-summing surface inherits the same set — the
   * row ids of loan payments that are carried elsewhere (a dateable
   * obligation on the linked loan account at the row's own amount) and so
   * leave spending totals in EVERY month, not just the months the sync-time
   * ±3-day pairing happened to flag. `excluded` carries the disclosure
   * facts (what moved, where it is counted instead). Absent/empty when no
   * merchant qualifies — the demo/golden path, SimpleFIN-only readers, and
   * any loan the app cannot project.
   */
  loanPaymentFlowExclusions?: {
    readonly excludeIds: ReadonlySet<string>;
    readonly excluded: readonly { canonical: string; accountId: string; paymentCents: number }[];
  };
  /**
   * U.35: the (account, released day) pairs `applyReconciliationBoundary`
   * derived from the same link-table rows it used for the keep. Empty set
   * when there are no effective links (demo/golden). Required so a page that
   * already holds this snapshot cannot re-fetch the keys and disagree with
   * the keep it is disclosing.
   */
  handoverKeys: ReadonlySet<string>;
  /**
   * C.22: predecessor id → terminal live successor, from the same boundary
   * call that produced `handoverKeys` and the keep. Absent/empty when there
   * are no effective links (demo/golden) — every account id is its own
   * terminal. Required on a live snapshot that has links, so radar/burn
   * cannot re-fetch the map and disagree with the keep they are scoping.
   */
  terminalOf?: ReadonlyMap<string, string>;
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
  /**
   * True when this sync rewrote DERIVED rows the app renders — transfer flags, the
   * recurring series, the detected scheduled projections — even though `added`,
   * `modified` and `removed` may all be zero.
   *
   * Required, not optional, on purpose (L.28). The whole defect this closes was a
   * change nobody had a field for: the caller re-renders the page only when a sync
   * reports movement, and a sync that ingests no transaction can still rewrite every
   * figure on the guilt-free breakdown — on the owner's live data L.26's re-keying
   * turned 0 stored scheduled rows into 8 while reporting `added: 0`, so the very page
   * load that repaired his data re-painted the stale $0.00. Optional would let a new
   * provider omit it and inherit that silence, and the direction of that silence is a
   * reader acting on a number the app has already superseded.
   *
   * Scope of that guarantee, since an earlier draft of this comment overstated it
   * (critic P2-4): `required` binds real implementers and every literal construction
   * site, which tsc checks. It does NOT bind test doubles — a `vi.fn()` erases the type
   * at the mock boundary, so a partial `SyncResult` in a test still compiles and reads
   * as `undefined` here. This field is therefore a contract for providers, not a
   * guarantee about the fixtures that stand in for them.
   */
  derivedChanged: boolean;
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
