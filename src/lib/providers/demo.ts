/**
 * DemoProvider — backed entirely by the seeded local database.
 * Runs with zero third-party credentials. "Today" is pinned via DEMO_TODAY
 * (default: the seed asOf) so the dataset stays coherent (DECISIONS #12).
 *
 * Row ownership: every query is scoped to the userId (directly or via the
 * owning account relation) — see docs/CRITIC_RUBRIC.md standing checks.
 */
import { prisma } from '@/lib/db';
import { holidayTable, type ISODate } from '@/lib/dates';
import { businessToday } from '@/lib/business-today';
import { applyReconciliationBoundary } from '@/lib/engine/account/reconcile-boundary';
import { loanPaymentFlowExclusions } from '@/lib/engine/categorize/loan-payment-flows';
import { LOAN_ACCOUNT_TYPES } from '@/lib/engine/categorize/transfers';
import { selectLoanObligations } from '@/lib/engine/loans/obligations';
import { trendHistoryFloor } from '@/lib/engine/networth/snapshot-plan';
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
    // Demo data is static; nothing to sync — and nothing derived is recomputed either,
    // so there is never anything for the caller to re-render (L.28).
    return { added: 0, modified: 0, removed: 0, nextCursor: null, derivedChanged: false };
  }

  async getFinanceSnapshot(userId: string): Promise<FinanceSnapshot> {
    const ownedByUser = { account: { userId } } as const;
    const [user, accounts, autopays, statements, cardPayments, transactions, scheduled, balanceSnapshots, reconciliations] =
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
          // The payee name the register shows, joined so a snapshot consumer can
          // NAME a row and not only sum it (the category-breakdown panels). Not
          // derivable from `rawDescriptor`: a keyword rule's `renameTo` writes
          // `Merchant.canonical` (O.13a), so the normalizer's guess at the bank
          // text is exactly the name a reader who renamed a payee replaced.
          include: { merchant: { select: { canonical: true } } },
        }),
        prisma.scheduledTransaction.findMany({ where: ownedByUser }),
        // Windowed since U.4 (see `trendHistoryFloor`): its only consumer is the
        // net-worth trend, whose chip strip renders 18 points — this bounds a
        // payload that now grows every month without capping what is shown.
        prisma.balanceSnapshot.findMany({
          where: { ...ownedByUser, date: { gte: trendHistoryFloor(this.today()) } },
          orderBy: { date: 'asc' },
        }),
        // Active reconciliation links (Wave 4.6 slice 3) — same predicate as
        // server/reconciliation.ts getActiveReconciliations (undoneAt: null).
        prisma.accountReconciliation.findMany({
          where: { userId, undoneAt: null },
          select: { predecessorAccountId: true, successorAccountId: true, cutoverDate: true },
          orderBy: { confirmedByUserAt: 'asc' },
        }),
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
    // Reconciliation boundary (Wave 4.6 slices 3–4, PROVIDER_RECONCILIATION_ARCHITECTURE §5):
    // applied ONCE here, after the currency guard, so every downstream engine inherits
    // it. A linked predecessor contributes 0 balance and only its date<=cutover rows;
    // the successor contributes its live balance and only date>cutover rows (R1/R2);
    // a superseded funding account is remapped to its successor. Slice 4 also drops the
    // predecessor's STATEMENTS (R4 — the successor is the live source of what's owed, so
    // its stale statement must not double a card's due or corrupt the coach cleared-streak)
    // and RE-KEYS its SCHEDULED rows onto the successor (F6 — else the remapped payment
    // account's filter silently drops the predecessor's income/bills). cardPayments/autopays
    // ride along unchanged: an orphaned predecessor cardPayment is ignored by every consumer
    // (its statement is gone), and a predecessor autopay never fires because cash-needed skips
    // the superseded card. With no active links this is the exact-reference fast path —
    // demo/golden byte-identical (R8).
    const boundary = applyReconciliationBoundary({
      paymentAccountId: user?.paymentAccountId ?? null,
      accounts: supportedAccounts,
      transactions: transactions.filter((t) => supportedIds.has(t.accountId)),
      balanceSnapshots: balanceSnapshots.filter((b) => supportedIds.has(b.accountId)),
      statements: supportedStatements,
      scheduled: scheduled.filter((s) => supportedIds.has(s.accountId)),
      links: reconciliations,
    });
    // C.25 (DECISIONS #403): the read-side loan-payment exclusion, computed
    // ONCE here so every flow-summing surface inherits the SAME set. The
    // snapshot withholds loan activity (#62), so the loan side arrives via
    // one targeted query — the exact shape C.24's detection reads
    // (spending-plan.ts loanSideInflows) — and the obligation facts come
    // from the accounts already in hand. Superseded predecessors are
    // skipped exactly as cashNeededFromSnapshot skips them: the boundary
    // never zeroed their `minimumPaymentCents`, and the live successor is
    // the account that owes. Pure functions below; no row is written.
    const superseded = new Set(boundary.supersededAccountIds ?? []);
    let loanPaymentFlowExclusionsOut: FinanceSnapshot['loanPaymentFlowExclusions'];
    const loanAccountIds = new Set(
      boundary.accounts
        .filter((a) => LOAN_ACCOUNT_TYPES.has(a.type) && !superseded.has(a.id))
        .map((a) => a.id),
    );
    if (loanAccountIds.size > 0) {
      const loanInflows = await prisma.transaction.findMany({
        where: {
          accountId: { in: [...loanAccountIds] },
          amountCents: { gt: 0 },
          status: 'POSTED',
        },
        select: { id: true, accountId: true, date: true, amountCents: true },
      });
      const today = this.today(userId);
      const year = Number(today.slice(0, 4));
      const obligations = selectLoanObligations({
        accounts: boundary.accounts.filter((a) => !superseded.has(a.id)),
        today,
        holidays: holidayTable(year - 1, year + 1),
      });
      const computed = loanPaymentFlowExclusions({
        rows: boundary.transactions.filter(
          (t): t is (typeof boundary.transactions)[number] & { id: string } => t.id !== undefined,
        ),
        loanInflows,
        accountTypeById: new Map(boundary.accounts.map((a) => [a.id, a.type])),
        obligations: obligations.map((o) => ({ accountId: o.accountId, paymentCents: o.paymentCents })),
      });
      if (computed.excludeIds.size > 0) loanPaymentFlowExclusionsOut = computed;
    }
    return {
      paymentAccountId: boundary.paymentAccountId,
      supersededAccountIds: boundary.supersededAccountIds,
      accounts: [...boundary.accounts],
      autopays,
      statements: [...boundary.statements],
      cardPayments: cardPayments.filter((cp) => supportedStatementIds.has(cp.statementId)),
      transactions: [...boundary.transactions],
      scheduled: [...boundary.scheduled],
      balanceSnapshots: [...boundary.balanceSnapshots],
      loanPaymentFlowExclusions: loanPaymentFlowExclusionsOut,
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
