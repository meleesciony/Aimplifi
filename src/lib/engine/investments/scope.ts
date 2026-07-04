/**
 * /investments account-scope resolver (DECISIONS #160). The #159 row-link lets a user
 * tap an INVESTMENT account on /accounts; this resolves an optional `?account=<id>`
 * deep-link into WHICH per-account holdings cards /investments shows, so a real
 * multi-brokerage user lands on THAT account's holdings instead of the whole portfolio.
 *
 * Pure + deterministic (no React, no I/O) so the "filters out the other accounts"
 * behavior is unit-locked without a DOM. Scoping is INERT — it falls back to the full,
 * unchanged list — in every case where narrowing is meaningless or the deep-link can't
 * be honored:
 *   - the user has one or zero investment accounts (nothing to narrow to),
 *   - the id matches no account (a stale / hand-typed link),
 *   - the matched account has no holdings (a confusing empty single-account view).
 * The full fallback is byte-identical to the pre-#160 render, so the single-brokerage
 * demo (and any single-account user) is golden-safe regardless of the query param; the
 * portfolio-wide summary card above the list stays whole-portfolio in every case.
 */

/** The minimal shape this resolver needs — structurally satisfied by InvestmentAccountView. */
export interface ScopableInvestmentAccount {
  accountId: string;
  accountName: string;
  portfolio: { positions: readonly unknown[] };
}

export interface InvestmentScope<T extends ScopableInvestmentAccount> {
  /** The per-account holdings cards to render, in the original order. */
  accounts: T[];
  /** The scoped account's display name when an active scope is applied, else null. */
  scopedName: string | null;
  /** Whether to offer a "Show all accounts" reset (only true when a scope is active). */
  showAllAccounts: boolean;
}

export function resolveInvestmentScope<T extends ScopableInvestmentAccount>(
  accounts: T[],
  scopedAccountId: string | undefined,
): InvestmentScope<T> {
  const full: InvestmentScope<T> = { accounts, scopedName: null, showAllAccounts: false };
  // Nothing to scope to with one/zero accounts → inert (keeps the demo byte-identical).
  if (!scopedAccountId || accounts.length <= 1) return full;
  const found = accounts.find((a) => a.accountId === scopedAccountId);
  // Unknown id or an empty account → fall back to the full, unchanged view.
  if (!found || found.portfolio.positions.length === 0) return full;
  return { accounts: [found], scopedName: found.accountName, showAllAccounts: true };
}
