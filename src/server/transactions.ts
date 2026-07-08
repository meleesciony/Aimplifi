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
import {
  type WithheldAccountSummary,
  isSupportedCurrency,
  summarizeWithheldAccounts,
} from '@/lib/providers/currency';
import { businessToday } from '@/lib/business-today';
import { isoDate } from '@/lib/dates';
import { type FreshnessResult, classifyFreshness, perAccountFreshness } from '@/lib/engine/sync/health';
import {
  type AccountView,
  type AccountsSummary,
  type PageInfo,
  type TxnFilter,
  type TxnSummary,
  type TxnView,
  SPENDING_ACCOUNT_TYPES,
  filterTransactions,
  groupAccounts,
  paginate,
  sortByDateDesc,
  summarizeTransactions,
} from '@/lib/engine/transactions/query';

export interface TransactionsResult {
  rows: TxnView[];
  summary: TxnSummary;
  /** Distinct accounts for the filter dropdown (id + name). */
  accountOptions: { id: string; name: string }[];
  /** Pagination state for the current (filtered) page (ROADMAP #8). */
  pageInfo: PageInfo;
}

/** Rows per register page. */
const PAGE_SIZE = 100;

/**
 * All of a user's transactions, mapped to display rows, then filtered/sorted by
 * the pure engine. Split PARENT containers are excluded — their children carry
 * the real amounts, so including both would double-count every split (the same
 * rule the cash-needed assembler enforces). Split CHILDREN are shown normally.
 *
 * Loads the full set per call — fine at demo scale; server-side pagination is a
 * scale concern (see docs/ROADMAP.md #8), consistent with getDashboardData.
 */
export async function getTransactions(userId: string, filter: TxnFilter = {}, page = 1): Promise<TransactionsResult> {
  const txns = await prisma.transaction.findMany({
    // Spending accounts only — bank + cards; brokerage/loan activity isn't spending (#62).
    // Currency guard (DECISIONS #135): exclude non-USD accounts so the register + its account
    // dropdown match /accounts and net worth, which withhold them (no FX).
    where: {
      account: { userId, type: { in: [...SPENDING_ACCOUNT_TYPES] }, OR: [{ currency: null }, { currency: 'USD' }] },
      isSplitParent: false,
    },
    // Join the category row so a CUSTOM category resolves to its real name; system
    // rows are identical (their DB name == the static name), so this is a no-op for
    // them and a fix for customs without threading a meta map here (DECISIONS #111).
    include: { account: { select: { id: true, name: true } }, merchant: true, category: { select: { name: true } } },
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
    categoryName: t.category?.name ?? categoryName(t.categoryId),
    amountCents: t.amountCents,
    status: t.status,
    isTransfer: t.isTransfer,
    merchantId: t.merchantId,
    ruleEligible: isRuleEligibleMerchant(t.rawDescriptor),
    merchantCount: t.merchantId ? merchantCounts.get(t.merchantId) : undefined,
  }));

  const filtered = sortByDateDesc(filterTransactions(rows, filter));

  // Summary totals are over the FULL filtered set (accurate); the page slice keeps
  // the DOM light (rendering 800+ interactive rows delays hydration). Page
  // navigation (ROADMAP #8) lets the user reach EVERY filtered row, replacing the
  // old silent "most recent 200" cap.
  const summary = summarizeTransactions(filtered);
  const { items, info } = paginate(filtered, page, PAGE_SIZE);

  // Account options come from the full (unfiltered) set so the dropdown is stable.
  const seen = new Map<string, string>();
  for (const r of rows) if (!seen.has(r.accountId)) seen.set(r.accountId, r.accountName);
  const accountOptions = [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => (a.name < b.name ? -1 : 1));

  return { rows: items, summary, accountOptions, pageInfo: info };
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
  /** SimpleFIN bank-sync connection status (ROADMAP: cheaper Plaid alternative).
   *  `health` grades how recently the connection last synced (Gap 1 §3). */
  simplefin: { connected: boolean; lastSyncedAt: string | null; health: FreshnessResult };
  /** What the currency guard withheld — drives the disclosure banner (#135 residual). */
  withheld: WithheldAccountSummary;
}

/** Every account, grouped into assets vs liabilities with net worth + trend. */
export async function getAccountsView(userId: string): Promise<AccountsView> {
  const [user, accounts, snapshots, statements, autopays, sfConn, newestByAccount] = await Promise.all([
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
    prisma.simpleFinConnection.findUnique({ where: { userId }, select: { lastSyncedAt: true } }),
    // Newest transaction date per account — the per-row freshness reference (Gap 1 §3
    // follow-up). One grouped query rather than N per-account reads.
    prisma.transaction.groupBy({ by: ['accountId'], where: { account: { userId } }, _max: { date: true } }),
  ]);

  // Currency guard (DECISIONS #135): withhold non-USD accounts from the /accounts page so its
  // subtotals and net-worth trend match the dashboard headline, which excludes them (no FX).
  // Null-currency (demo / manual / legacy) is assumed USD → golden-safe no-op.
  const supported = accounts.filter((a) => isSupportedCurrency(a.currency));
  const views: AccountView[] = supported.map((a) => ({
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
  for (const a of supported) {
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

  const today = businessToday(userId);
  const trend = netWorthSeries({ snapshots, accounts: views, today });

  // Per-account connection freshness (Gap 1 §3 follow-up). The engine decides which
  // accounts get a result (SimpleFIN/Plaid feeds, non-INVESTMENT); manual/demo rows and
  // brokerages come back null and render no line. A SimpleFIN account's connection sync
  // floors its reference date so a quiet-but-live feed doesn't false-alarm.
  const newestTxnByAccount = new Map<string, string>();
  for (const g of newestByAccount) if (g._max.date) newestTxnByAccount.set(g.accountId, g._max.date);
  const sfLastSynced = sfConn?.lastSyncedAt ? isoDate(sfConn.lastSyncedAt) : null;
  const freshnessById = perAccountFreshness(
    supported.map((a) => ({
      id: a.id,
      isLinkedFeed: a.provider === 'simplefin' || a.provider === 'plaid',
      type: a.type,
      newestTxnDate: newestTxnByAccount.has(a.id) ? isoDate(newestTxnByAccount.get(a.id)!) : null,
      connectionLastSyncedAt: a.provider === 'simplefin' ? sfLastSynced : null,
    })),
    today,
  );
  for (const v of views) v.freshness = freshnessById[v.id] ?? null;

  return {
    ...groupAccounts(views),
    paymentAccountId: user?.paymentAccountId ?? null,
    trend,
    cardBilling,
    simplefin: {
      connected: sfConn !== null,
      lastSyncedAt: sfConn?.lastSyncedAt ?? null,
      health: classifyFreshness(sfConn?.lastSyncedAt ? isoDate(sfConn.lastSyncedAt) : null, today),
    },
    // The unfiltered rows are already in hand, so the disclosure costs no extra query.
    withheld: summarizeWithheldAccounts(accounts),
  };
}

/**
 * What the currency guard is withholding for this user — the dashboard's disclosure input
 * (#135 residual: a non-USD account must not vanish silently from the headline figures).
 * The where-clause is the exact DB complement of the guard's
 * `OR: [{ currency: null }, { currency: 'USD' }]` predicate, and the pure summarizer
 * re-applies `isSupportedCurrency`, so the disclosure can never disagree with the withhold.
 */
export async function getWithheldAccountSummary(userId: string): Promise<WithheldAccountSummary> {
  const rows = await prisma.account.findMany({
    where: { userId, NOT: { OR: [{ currency: null }, { currency: 'USD' }] } },
    select: { currency: true },
  });
  return summarizeWithheldAccounts(rows);
}
