/**
 * Where an account row on /accounts takes the reader (owner report 2026-08-11:
 * "when I click on my mortgage in accounts, why does it bring me to a
 * completely empty transaction page?").
 *
 * The register's row basis is SPENDING_ACCOUNT_TYPES only (`registerRowWhere`,
 * DECISIONS #62), so a LOAN / MORTGAGE / REAL_ESTATE / VEHICLE / CASH / OTHER_*
 * account linked to `/transactions?account=` lands on a page that is empty BY
 * CONSTRUCTION — no filter change can ever populate it. A link is a claim that
 * the destination answers the click; for those types the claim was false.
 *
 * One author for the decision, importing the register's OWN type set rather
 * than restating it (a-guard-must-read-what-it-guards): if the register's
 * basis ever widens, rows start linking there again without this file
 * changing. INVESTMENT keeps its #159 special case (holdings are the useful
 * destination). Everything else opens its detail in place on /accounts.
 */
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';

export type AccountRowDestination =
  /** The transactions register CAN show this account's rows. */
  | { kind: 'register'; href: string }
  /** A linked brokerage — holdings / performance live on /investments (#159). */
  | { kind: 'holdings'; href: string }
  /** No page answers this click better than the account itself: expand a
   *  detail panel in place on /accounts. */
  | { kind: 'detail' };

export function accountRowDestination(account: { id: string; type: string }): AccountRowDestination {
  if (account.type === 'INVESTMENT') {
    return { kind: 'holdings', href: `/investments?account=${account.id}` };
  }
  if (SPENDING_ACCOUNT_TYPES.includes(account.type)) {
    return { kind: 'register', href: `/transactions?account=${account.id}` };
  }
  return { kind: 'detail' };
}
