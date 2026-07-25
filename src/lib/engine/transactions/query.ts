/**
 * Pure transaction query engine: deterministic filtering, sorting, and summary
 * totals for the transaction register, plus account grouping for the accounts
 * page. No I/O, no React, no DB — operates on structural view rows the server
 * maps Prisma data into. Unit-tested against hand-verified values.
 *
 * Money conventions (see src/lib/money.ts): transactions are signed cents
 * (outflow negative, inflow positive); account balances are stored positive and
 * the account `type` decides asset vs liability. Transfers between the user's
 * own accounts are NEVER income or expense (engine-wide rule) and so are
 * excluded from inflow/outflow/net totals.
 */
import { type Cents, cents } from '@/lib/money';
import { compareDates, isoDate } from '@/lib/dates';
import type { FreshnessResult } from '@/lib/engine/sync/health';
import type { ProvenanceVerdict } from '@/lib/engine/categorize/provenance';

export interface TxnView {
  id: string;
  date: string; // YYYY-MM-DD
  accountId: string;
  accountName: string;
  /** Display name: canonical merchant if known, else a cleaned descriptor. */
  merchantName: string;
  rawDescriptor: string;
  categoryId: string;
  categoryName: string;
  amountCents: number; // signed: outflow negative, inflow positive
  status: string; // PENDING | POSTED
  isTransfer: boolean;
  /** Owning merchant row id, if known — needed for "always for this merchant". */
  merchantId?: string | null;
  /** False for aggregate pseudo-merchants (Zelle/checks) — no merchant-wide rule. */
  ruleEligible?: boolean;
  /** How many of the user's transactions share this merchant (for the "apply to N" bar). */
  merchantCount?: number;
  /**
   * How this row's category was decided (Why-This-Category §3.1). The server
   * computes it once from the persisted CategoryPrediction via
   * `describeProvenance`; the UI renders `provenance.label` VERBATIM and never
   * re-derives an origin. An `ai-guess` verdict (`needsConfirm: true`) is the
   * only kind routed to a visible confirm affordance.
   */
  provenance: ProvenanceVerdict;
}

export type FlowType = 'all' | 'income' | 'expense' | 'transfer';

export interface TxnFilter {
  /** Case-insensitive substring over merchantName / rawDescriptor / categoryName. */
  search?: string | null;
  accountId?: string | null;
  categoryId?: string | null;
  /** Case-insensitive EXACT match on merchantName (Merchant Pattern Lens,
   *  DECISIONS #250) — never substring: "Costco" must not match "Costco Gas". */
  merchant?: string | null;
  type?: FlowType;
  from?: string | null; // inclusive YYYY-MM-DD lower bound
  to?: string | null; // inclusive YYYY-MM-DD upper bound
}

export interface TxnSummary {
  count: number;
  /** Sum of positive, non-transfer amounts. */
  inflowCents: Cents;
  /** Sum of magnitudes of negative, non-transfer amounts (positive number). */
  outflowCents: Cents;
  /** inflowCents − outflowCents (transfers excluded). */
  netCents: Cents;
}

/** Most-recent-first, with a stable id tiebreak so order is fully deterministic. */
export function sortByDateDesc(rows: readonly TxnView[]): TxnView[] {
  return [...rows].sort((a, b) => {
    const byDate = compareDates(isoDate(b.date), isoDate(a.date));
    if (byDate !== 0) return byDate;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

function matchesType(t: TxnView, type: FlowType): boolean {
  switch (type) {
    case 'income':
      return !t.isTransfer && t.amountCents > 0;
    case 'expense':
      return !t.isTransfer && t.amountCents < 0;
    case 'transfer':
      return t.isTransfer;
    case 'all':
    default:
      return true;
  }
}

export function filterTransactions(rows: readonly TxnView[], filter: TxnFilter = {}): TxnView[] {
  const needle = filter.search?.trim().toLowerCase() ?? '';
  const merchant = filter.merchant?.trim().toLowerCase() ?? '';
  const from = filter.from ? isoDate(filter.from) : null;
  const to = filter.to ? isoDate(filter.to) : null;
  const type = filter.type ?? 'all';

  return rows.filter((t) => {
    if (!matchesType(t, type)) return false;
    if (filter.accountId && t.accountId !== filter.accountId) return false;
    if (filter.categoryId && t.categoryId !== filter.categoryId) return false;
    if (merchant && t.merchantName.toLowerCase() !== merchant) return false;
    if (from && compareDates(isoDate(t.date), from) < 0) return false;
    if (to && compareDates(isoDate(t.date), to) > 0) return false;
    if (needle) {
      const hay = `${t.merchantName}\n${t.rawDescriptor}\n${t.categoryName}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

export interface PageInfo {
  /** 1-based current page, clamped to [1, pageCount]. */
  page: number;
  pageSize: number;
  /** Total pages (always ≥ 1, even when empty). */
  pageCount: number;
  /** Total rows across all pages. */
  total: number;
  /** 1-based index of the first row on this page (0 when empty). */
  fromIndex: number;
  /** 1-based index of the last row on this page. */
  toIndex: number;
}

/**
 * Slice `rows` into a 1-based page. `page` and `pageSize` are sanitized (page
 * clamped into range, pageSize floored at 1), so out-of-range input degrades
 * gracefully rather than returning an empty/garbage page.
 */
export function paginate<T>(rows: readonly T[], page: number, pageSize: number): { items: T[]; info: PageInfo } {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const clamped = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (clamped - 1) * size;
  const items = rows.slice(start, start + size);
  return {
    items: [...items],
    info: {
      page: clamped,
      pageSize: size,
      pageCount,
      total,
      fromIndex: total === 0 ? 0 : start + 1,
      toIndex: start + items.length,
    },
  };
}

export function summarizeTransactions(rows: readonly TxnView[]): TxnSummary {
  let inflow = 0;
  let outflow = 0;
  for (const t of rows) {
    if (t.isTransfer) continue; // transfers are neither income nor expense
    if (t.amountCents > 0) inflow += t.amountCents;
    else if (t.amountCents < 0) outflow += -t.amountCents;
  }
  return {
    count: rows.length,
    inflowCents: cents(inflow),
    outflowCents: cents(outflow),
    netCents: cents(inflow - outflow),
  };
}

// ── Accounts page ──────────────────────────────────────────────────────────

// Liability account types — linked (CREDIT/LOAN) plus the manual ones a user can
// add for a complete net worth (DECISIONS #39). Everything else is an asset.
// New types are absent from the seed, so the golden net worth is unchanged.
export const LIABILITY_TYPES: ReadonlySet<string> = new Set([
  'CREDIT',
  'LOAN',
  'MORTGAGE',
  'OTHER_LIABILITY',
]);

// Account types whose transactions are real CASH SPENDING — bank + cards. A
// brokerage's buys/sells/dividends and a loan's interest postings are NOT spending,
// so their transactions are excluded from the register, spending, categorization,
// and recurring views (DECISIONS #62). Net worth still uses EVERY account's balance,
// so investments/loans remain in the net-worth picture. The demo seed attaches
// transactions only to spending accounts, so the golden values are unchanged.
export const SPENDING_ACCOUNT_TYPES: readonly string[] = ['CHECKING', 'SAVINGS', 'CREDIT'];

export interface AccountView {
  id: string;
  name: string;
  type: string; // CHECKING | SAVINGS | CREDIT | INVESTMENT | LOAN | REAL_ESTATE | VEHICLE | CASH | OTHER_ASSET | MORTGAGE | OTHER_LIABILITY
  mask: string | null;
  currentBalanceCents: number; // stored positive
  /** True for user-added manual assets/liabilities (editable; no transactions). */
  manual?: boolean;
  /** Data source: 'demo' | 'plaid' | 'simplefin' | 'manual' (#253). Drives the
   *  disconnected-SimpleFIN delete affordance on /accounts; absent on surfaces
   *  that don't set it. */
  provider?: string;
  /** Per-account connection freshness (Gap 1 §3 follow-up). Null when the account has no
   *  sync feed (manual/demo) or is holdings-valued (INVESTMENT); set for SimpleFIN/Plaid
   *  rows so /accounts can show a "synced N days ago" / reconnect line per account. */
  freshness?: FreshnessResult | null;
  /** Synced rows only (#253/#256): true when the Delete control may render — the
   *  server computes it with the SAME predicate the delete guard enforces
   *  (syncedDeleteBlockReason), so the UI can never promise a delete the action
   *  would refuse. Absent on surfaces that don't set it. */
  deletable?: boolean;
  /** The Plaid connection (item) feeding this row, when provider === 'plaid'. Lets the
   *  duplicate warning offer the ONLY action that actually resolves a both-live duplicate —
   *  disconnecting the bank behind one side — instead of telling the user to "disconnect or
   *  delete" with no control to do it (owner-reported 2026-07-24). Null on non-Plaid rows and
   *  on rows not re-synced since #256; absent on surfaces that don't set it. */
  plaidItemId?: string | null;
  /** YYYY-MM-DD the account's own connection STOPPED returning it (Account.feedDroppedAt), else
   *  null. The row is still counted in every subtotal on purpose (TASKS L.14); this is what lets
   *  the surface say so, instead of painting a frozen balance under a "Synced today" label. */
  feedDroppedAt?: string | null;
  /** True when the bank connection feeding this row still exists. Decides which remedy the
   *  feed-dropped note may name — disconnecting the bank removes the re-tick control while the
   *  row and its stamp deliberately remain (TASKS L.14, critic F-4). */
  connectionLive?: boolean;
}

export interface AccountGroup {
  kind: 'asset' | 'liability';
  accounts: AccountView[];
  /** Assets: total balance. Liabilities: total owed (positive magnitude). */
  subtotalCents: Cents;
}

export interface AccountsSummary {
  assets: AccountGroup;
  liabilities: AccountGroup;
  /** assets.subtotal − liabilities.subtotal. */
  netWorthCents: Cents;
}

export function isLiabilityType(type: string): boolean {
  return LIABILITY_TYPES.has(type);
}

/**
 * Split accounts into assets vs liabilities with subtotals and net worth.
 * Ordering within a group is preserved from the input (callers pre-sort).
 */
export function groupAccounts(accounts: readonly AccountView[]): AccountsSummary {
  const assets: AccountView[] = [];
  const liabilities: AccountView[] = [];
  let assetTotal = 0;
  let liabilityTotal = 0;
  for (const a of accounts) {
    if (isLiabilityType(a.type)) {
      liabilities.push(a);
      liabilityTotal += a.currentBalanceCents;
    } else {
      assets.push(a);
      assetTotal += a.currentBalanceCents;
    }
  }
  return {
    assets: { kind: 'asset', accounts: assets, subtotalCents: cents(assetTotal) },
    liabilities: { kind: 'liability', accounts: liabilities, subtotalCents: cents(liabilityTotal) },
    netWorthCents: cents(assetTotal - liabilityTotal),
  };
}
