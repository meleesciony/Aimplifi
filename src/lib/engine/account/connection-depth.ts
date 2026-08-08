/**
 * How far back one bank CONNECTION's transaction history actually reaches — the
 * per-connection answer to TASKS H.1(b), so the owner can SEE the depth on
 * /accounts instead of asking for it.
 *
 * Why this is an engine and not a `groupBy _min`. Two separate rules stand
 * between "rows exist" and "the owner can see them", and getting either wrong
 * puts a rendered date on /accounts that the register contradicts on the same
 * screenload — the H.8 defect, one surface further on.
 *
 *  1. The reconciliation keep rule (R1, `reconcile-boundary.ts txnKeepRule`) is
 *     WINDOWED: an account loses exactly the rows inside each transitive upstream
 *     predecessor's claim, which is a PREFIX of its history. Measured on the
 *     owner's live corpus 2026-08-08
 *     (`scripts/audit-probes/h1-connection-depth.mts`): SEVEN connections carry a
 *     raw-vs-owned delta of 84–91 days. Not a rounding difference — three months
 *     of history the connection does not own.
 *  2. The REGISTER'S OWN BASIS (`registerRowWhere`) lists only
 *     SPENDING_ACCOUNT_TYPES, USD-or-null, non-split-parent rows. A mortgage's, a
 *     loan's, an investment account's and a withheld non-USD account's
 *     transactions are all real rows that /transactions will never show. The
 *     first cut of this slice missed this one and the critic executed it: a
 *     connection rendered "History goes back to Mon, May 18, 2026" while the
 *     register showed zero rows and did not even offer the account in its filter
 *     dropdown.
 *
 * The input is therefore per-account facts the CALLER has already put through
 * BOTH rules, and this module holds the decisions that remain: which of a
 * connection's accounts sets its depth, and what a connection that owns nothing
 * is allowed to claim.
 */

/** One account's history, as the register's basis and the boundary leave it. */
export interface AccountDepthFact {
  /**
   * Whether this account's rows can appear in the register at all — a spending
   * type, in a supported currency. False for MORTGAGE, LOAN, INVESTMENT and
   * withheld non-USD accounts, whose rows exist but are listed nowhere the owner
   * can reach.
   */
  inRegisterBasis: boolean;
  /**
   * Whether this KIND of account ever sends transactions. Investment, loan and
   * mortgage accounts do not: no `/investments/transactions` ingest exists
   * anywhere in the app, and both providers say so in their own words
   * (`simplefin-actions.ts:146`, `plaid-history-backfill.ts:24`). This is what
   * separates "nothing has arrived yet" from "nothing is ever coming" — and on
   * the owner's live corpus it decides FOUR of his thirteen connections, every
   * one of which had been told to keep waiting.
   */
  neverTransactional: boolean;
  /**
   * The earliest register-visible date this account OWNS — its first such row
   * that passes the R1 keep rule. `null` = it owns none, which is NOT the same
   * as holding none.
   */
  earliestOwned: string | null;
  /**
   * Whether the account holds any register-visible row at all, owned or not.
   * This and `earliestOwned` disagree in exactly the case the boundary creates:
   * rows are present, and the window they fall in belongs to the account this
   * one was combined with.
   */
  holdsRows: boolean;
}

/**
 * What a connection may truthfully say about its own depth.
 *
 * Four states, because every smaller set forces one of them to lie — and each
 * was reached by execution, not by enumeration:
 *  - `counted-elsewhere` is its own state rather than a null date because the
 *    live corpus has one (an American Express item holding 7 rows and owning 0);
 *    rendering "no transactions yet" over 7 real rows is false the other way.
 *  - `balances-only` and `not-counted` split what one "outside the register"
 *    state would blur, because their sentences are not interchangeable: an
 *    investment or loan account is never going to send a transaction, while a
 *    non-USD account is being withheld by a policy (#135). Measured: FOUR live
 *    connections (U.S. Bank ×2 LOAN, Vanguard ×4 INVESTMENT, Schwab ×2 IRA,
 *    Truist ×1 MORTGAGE — 9 of 9 accounts) were rendering "No transactions
 *    yet." while syncing cleanly that same day.
 *  - `no-rows` therefore now means what it says: a spending account, in a
 *    counted currency, that genuinely has not delivered anything yet.
 */
export type ConnectionDepth =
  | { state: 'reaches'; earliest: string }
  | { state: 'counted-elsewhere' }
  | { state: 'balances-only' }
  | { state: 'not-counted' }
  | { state: 'no-rows' };

/**
 * A connection reaches as far back as the OLDEST row any of its accounts owns.
 *
 * The oldest, not the newest and not the newest-of-the-oldests: the line answers
 * "how far back does this bank's data go", and one account reaching 2024 is the
 * true answer for the connection even when its siblings start last month. Dates
 * are YYYY-MM-DD, so string comparison IS date comparison (repo convention —
 * business dates are calendar dates, never timestamps).
 *
 * An account outside the register's basis takes no part in any of it: it cannot
 * supply a date, and it cannot make a connection look empty either. Only when
 * NONE of a connection's accounts are in the basis does the connection describe
 * itself that way, because then there is no register-visible history to report.
 */
export function connectionHistoryDepth(accounts: readonly AccountDepthFact[]): ConnectionDepth {
  const visible = accounts.filter((a) => a.inRegisterBasis);
  if (visible.length === 0) {
    // No accounts at all is genuinely "nothing here". Accounts that exist but
    // are all outside the register is a different fact — and which fact depends
    // on WHY, because the reader is looking straight at those account names.
    if (accounts.length === 0) return { state: 'no-rows' };
    return accounts.some((a) => a.neverTransactional) ? { state: 'balances-only' } : { state: 'not-counted' };
  }
  let earliest: string | null = null;
  let holdsAny = false;
  for (const a of visible) {
    if (a.holdsRows) holdsAny = true;
    if (a.earliestOwned !== null && (earliest === null || a.earliestOwned < earliest)) {
      earliest = a.earliestOwned;
    }
  }
  if (earliest !== null) return { state: 'reaches', earliest };
  // Rows exist but the boundary gives every one of them to another account. Say
  // that, rather than a date the connection does not own or a "nothing here"
  // that the row count contradicts.
  if (holdsAny) return { state: 'counted-elsewhere' };
  return { state: 'no-rows' };
}
