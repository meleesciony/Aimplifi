/**
 * Server-side transaction & account reads for the register and accounts pages.
 * Every query is row-ownership scoped by userId (via the owning account).
 * Display formatting (merchant/category names) happens here; the pure query
 * engine in src/lib/engine/transactions/query.ts does the filtering/totals.
 */
import { prisma } from '@/lib/db';
import { isRuleEligibleMerchant } from '@/lib/engine/categorize/assign';
import { categoryName } from '@/lib/engine/categorize/categories';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { type NetWorthSeriesPoint, netWorthSeries } from '@/lib/engine/networth/series';
import { DEFAULT_AS_OF } from '@/lib/seed/build';
import {
  type AccountView,
  type AccountsSummary,
  type TxnFilter,
  type TxnSummary,
  type TxnView,
  filterTransactions,
  groupAccounts,
  sortByDateDesc,
  summarizeTransactions,
} from '@/lib/engine/transactions/query';

export interface TransactionsResult {
  rows: TxnView[];
  summary: TxnSummary;
  /** Distinct accounts for the filter dropdown (id + name). */
  accountOptions: { id: string; name: string }[];
}

/**
 * All of a user's transactions, mapped to display rows, then filtered/sorted by
 * the pure engine. Split PARENT containers are excluded — their children carry
 * the real amounts, so including both would double-count every split (the same
 * rule the cash-needed assembler enforces). Split CHILDREN are shown normally.
 *
 * Loads the full set per call — fine at demo scale; server-side pagination is a
 * scale concern (see docs/ROADMAP.md #8), consistent with getDashboardData.
 */
export async function getTransactions(userId: string, filter: TxnFilter = {}): Promise<TransactionsResult> {
  const txns = await prisma.transaction.findMany({
    where: { account: { userId }, isSplitParent: false },
    include: { account: { select: { id: true, name: true } }, merchant: true },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
  });

  // How many transactions share each merchant — drives the "apply to N" count
  // on the register's "Always" action (DECISIONS #42).
  const merchantCounts = new Map<string, number>();
  for (const t of txns) {
    if (t.merchantId) merchantCounts.set(t.merchantId, (merchantCounts.get(t.merchantId) ?? 0) + 1);
  }

  const rows: TxnView[] = txns.map((t) => ({
    id: t.id,
    date: t.date,
    accountId: t.accountId,
    accountName: t.account.name,
    merchantName: t.merchant?.canonical ?? normalizeMerchant(t.rawDescriptor).canonical,
    rawDescriptor: t.rawDescriptor,
    categoryId: t.categoryId ?? 'uncategorized',
    categoryName: categoryName(t.categoryId),
    amountCents: t.amountCents,
    status: t.status,
    isTransfer: t.isTransfer,
    merchantId: t.merchantId,
    ruleEligible: isRuleEligibleMerchant(t.rawDescriptor),
    merchantCount: t.merchantId ? merchantCounts.get(t.merchantId) : undefined,
  }));

  const filtered = sortByDateDesc(filterTransactions(rows, filter));

  // Render only the most-recent slice. The summary totals are computed over the
  // FULL filtered set (accurate), but rendering 800+ interactive rows made the
  // page heavy enough to delay hydration (search/filters racing load). Capping
  // the DOM keeps the register responsive; refine with filters to see older rows
  // (server-side pagination is the eventual scale answer, ROADMAP #8).
  const DISPLAY_CAP = 200;
  const summary = summarizeTransactions(filtered);
  const display = filtered.slice(0, DISPLAY_CAP);

  // Account options come from the full (unfiltered) set so the dropdown is stable.
  const seen = new Map<string, string>();
  for (const r of rows) if (!seen.has(r.accountId)) seen.set(r.accountId, r.accountName);
  const accountOptions = [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => (a.name < b.name ? -1 : 1));

  return { rows: display, summary, accountOptions };
}

/**
 * Billing state for a manual CREDIT card (extends DECISIONS #45) — surfaced on
 * /accounts so the user can attach/edit the statement that lets the Cash-Needed
 * Engine answer "how much & when" for it. Present only for manual credit cards.
 */
export interface ManualCardBilling {
  hasStatement: boolean;
  statementBalanceCents?: number;
  minimumPaymentCents?: number;
  dueDate?: string; // YYYY-MM-DD
  cycleEnd?: string; // YYYY-MM-DD (statement close)
  aprBps: number | null;
  autopayMode: string | null;
  /** Set only for FIXED_AMOUNT autopay — lets the editor re-hydrate the amount. */
  autopayFixedAmountCents: number | null;
}

export interface AccountsView extends AccountsSummary {
  paymentAccountId: string | null;
  /** Net worth over time (DECISIONS #40), oldest → newest, ending at today. */
  trend: NetWorthSeriesPoint[];
  /** Per-account billing for manual credit cards, keyed by account id. */
  cardBilling: Record<string, ManualCardBilling>;
}

/** Every account, grouped into assets vs liabilities with net worth + trend. */
export async function getAccountsView(userId: string): Promise<AccountsView> {
  const [user, accounts, snapshots, statements, autopays] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { paymentAccountId: true } }),
    prisma.account.findMany({ where: { userId }, orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
    prisma.balanceSnapshot.findMany({
      where: { account: { userId } },
      select: { accountId: true, date: true, balanceCents: true },
    }),
    prisma.statement.findMany({
      where: { account: { userId } },
      orderBy: { cycleEnd: 'desc' },
      select: { accountId: true, cycleEnd: true, dueDate: true, statementBalanceCents: true, minimumPaymentCents: true },
    }),
    prisma.autopayConfig.findMany({
      where: { account: { userId } },
      select: { accountId: true, mode: true, fixedAmountCents: true },
    }),
  ]);

  const views: AccountView[] = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    mask: a.mask,
    currentBalanceCents: a.currentBalanceCents,
    manual: a.provider === 'manual',
  }));

  // Newest statement per account (orderBy cycleEnd desc → first seen wins).
  const newestStatement = new Map<string, (typeof statements)[number]>();
  for (const s of statements) if (!newestStatement.has(s.accountId)) newestStatement.set(s.accountId, s);
  const autopayByAccount = new Map(autopays.map((a) => [a.accountId, a]));

  const cardBilling: Record<string, ManualCardBilling> = {};
  for (const a of accounts) {
    if (a.provider !== 'manual' || a.type !== 'CREDIT') continue;
    const ap = autopayByAccount.get(a.id);
    const s = newestStatement.get(a.id);
    const common = {
      aprBps: a.aprBps,
      autopayMode: ap?.mode ?? null,
      autopayFixedAmountCents: ap?.mode === 'FIXED_AMOUNT' ? ap.fixedAmountCents : null,
    };
    cardBilling[a.id] = s
      ? {
          hasStatement: true,
          statementBalanceCents: s.statementBalanceCents,
          minimumPaymentCents: s.minimumPaymentCents,
          dueDate: s.dueDate,
          cycleEnd: s.cycleEnd,
          ...common,
        }
      : { hasStatement: false, ...common };
  }

  const today = process.env.DEMO_TODAY ?? DEFAULT_AS_OF;
  const trend = netWorthSeries({ snapshots, accounts: views, today });

  return {
    ...groupAccounts(views),
    paymentAccountId: user?.paymentAccountId ?? null,
    trend,
    cardBilling,
  };
}
