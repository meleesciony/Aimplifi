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
import { type ExcludableTxn, isExcludedFromTotals } from '@/lib/engine/transactions/exclude';
import { reimbursementState } from '@/lib/engine/transactions/reimbursement';
import type { RowOrigin } from '@/lib/engine/transactions/origin';

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
  /**
   * Who owns this row — 'bank' when a feed delivered it, 'entered' when the reader
   * did (`rowOrigin`, engine/transactions/origin.ts). REQUIRED rather than
   * optional: an absent value would default to the reader owning the row, which is
   * the direction that OFFERS a status write on a row the next sync overwrites —
   * a control that looks obeyed and is not.
   */
  descriptorOrigin: RowOrigin;
  isTransfer: boolean;
  /**
   * U.20: whether this row sits on a day the boundary released to BOTH sides of
   * the combined pair it belongs to, so a transaction both connections reported
   * is listed here twice.
   *
   * REQUIRED. The register is the surface that lists the two identical rows, and
   * until now it carried no reconciliation vocabulary at all — `transaction-list`
   * had zero occurrences of reconcil/combined/cutover, so the reader's only clue
   * that two lines were one purchase was the account name. A default of false
   * would let the next row-building path reintroduce exactly that silence.
   */
  onHandoverDay: boolean;
  /**
   * The reader's own memo, verbatim, or null. REQUIRED rather than optional: a row
   * shape that can silently omit it would let a surface render "no note" for a row
   * that has one, and the note exists precisely so a charge is not a mystery.
   */
  note: string | null;
  /**
   * The tax drawer the reader put this row in — a `TaxClass` slug, or null when
   * untagged. Stored and carried as a plain string; every surface narrows it through
   * `isTaxClass` (src/lib/engine/tax/classes.ts) so an unrecognized value reads as
   * untagged rather than as a class it is not.
   */
  taxClass: string | null;
  /**
   * The row's own review flag, straight from the stored column — REQUIRED, not
   * optional, because an optional one would read as "not flagged" at exactly the
   * caller that forgot to set it, which is the direction that hides work from the
   * reader (owner request, 2026-07-27: "make it easier to see unclassified items
   * in activity").
   *
   * NOT the whole of "unclassified" on its own — see `isUnclassifiedTxn`.
   */
  needsReview: boolean;
  /**
   * O.15: the reader excluded this row from every money total. REQUIRED, not
   * optional, for the same reason as `needsReview`: an optional flag would read
   * as "counts" at exactly the caller that forgot to select it — and the badge
   * this flag drives is the register's only honesty about a row the totals
   * no longer show.
   */
  excludeFromTotals: boolean;
  /**
   * O.15 refund tracker: null (untracked) | 'awaiting' | 'received'. Narrowed
   * through `reimbursementState` (engine/transactions/reimbursement.ts) so an
   * unrecognized stored value reads as untracked, never as a state it is not.
   * REQUIRED for the same reason as `excludeFromTotals`.
   */
  reimbursement: string | null;
  /**
   * O.15: set when this row is one PIECE of a split. REQUIRED so the action
   * menu can say "already one piece of a split" instead of silently offering a
   * second split — the same forgot-to-set failure direction as the flags above.
   */
  splitParentId: string | null;
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
  /**
   * The inbox's suggestion ladder, mirrored per row (TASKS O.9d / DECISIONS
   * #333): what the app thinks an UNFILED row is — our pipeline's verdict, else
   * Plaid's persisted guess, else a proposal from the reader's own correction
   * history — rendered as a labelled chip with a one-tap `✓ Confirm`. Null for
   * a row that already has a category (it answers the question itself) and for
   * rows the inbox's own gates skip. REQUIRED, not optional, for the same
   * reason as `needsReview`: an optional field would read as "nothing to
   * suggest" at exactly the caller that forgot to compute it.
   *
   * `reason` is the evidence sentence (history proposals only) — a proposal
   * that cannot be checked is a guess wearing a confident face.
   */
  suggestion: {
    kind: 'ruleset' | 'provider' | 'history';
    categoryId: string;
    categoryName: string;
    reason: string | null;
  } | null;
  /**
   * Fixed vs discretionary for Plan guilt-free (DECISIONS #376/#378). Derived
   * from the filed category (+ per-user Fixed overrides). REQUIRED so a register
   * row never silently omits the class the reader is asked to confirm.
   * `out-of-scope` = transfers / income / uncategorized — not a Fixed dial.
   */
  spendClass: 'fixed' | 'guilt-free' | 'out-of-scope';
  /**
   * C.16 (audit F8) — true when the READER set this row's class themselves
   * (the dial, or their own explicit rule's `setSpendClass`), false when it is
   * the app's guess. Derived from `spendClassOverride !== null`: every writer
   * of the override is reader-authored — the dial
   * (server/transaction-flags-actions.ts) and rule stamps (keyword-rules.ts,
   * plus the pipeline's pass-through on ingest, which is non-null ONLY for an
   * explicit non-learned rule — pipeline.ts). No machine guess ever lands
   * there, so the marker needs no provenance column. REQUIRED rather than
   * optional: an absent value would read as "our guess" on exactly the row the
   * reader decided — the F8 failure this field exists to end.
   */
  spendClassReaderSet: boolean;
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
  /** O.15: show ONLY rows in this reimbursement state (the coach's outstanding
   *  line links here — a figure that names rows must open on those rows). */
  reimbursement?: 'awaiting' | 'received' | null;
  /** Show ONLY rows that still need a category decision (`isUnclassifiedTxn`).
   *  A separate axis from `type` and from `categoryId` on purpose: it is a question
   *  about whether the app has decided, not about what it decided. */
  unclassified?: boolean;
  /**
   * W.7 / DECISIONS #383: Fixed or Discretionary bucket — the register control
   * that lets a Plan / Spending heading open every transaction under that
   * heading. Only `fixed` and `guilt-free` are filterable (`out-of-scope` is
   * the residual, not a bucket heading).
   */
  spendClass?: 'fixed' | 'guilt-free' | null;
}

/**
 * Does this row still need a category decision from the reader?
 *
 * THE UNION IS THE POINT. `needsReview` and "sitting in the uncategorized
 * placeholder" are provably DIFFERENT populations in this codebase — `backfill.ts`
 * has to union all three states (`needsReview: true`, `categoryId: null`,
 * `categoryId: 'uncategorized'`) and `tests/unit/backfill.test.ts` locks a row that
 * is uncategorized WITHOUT being flagged. A filter offering only one of them would
 * quietly hide the other, which is the same failure the owner reported: work he
 * cannot see. (`categoryId` is normalized to 'uncategorized' by the server read, so
 * the null case arrives here already folded in.)
 *
 * Exported and shared so the register's filter, its count and any future surface
 * ask ONE question rather than three that can drift apart.
 */
export function isUnclassifiedTxn(t: Pick<TxnView, 'needsReview' | 'categoryId'>): boolean {
  return t.needsReview || t.categoryId === 'uncategorized';
}

/**
 * How many rows the "Needs a category" control would show IF the reader pressed it
 * right now — which is the only number it may print, because the number is the
 * button's promise and pressing it is how the promise is kept.
 *
 * It counts through the rest of the caller's filter and drops exactly ONE axis:
 * `unclassified` itself. Both halves of that are load-bearing.
 *
 * - Dropping `unclassified` is what keeps the control legible once it is ON. A
 *   count taken through the WHOLE filter would collapse to the page's own length
 *   and stop telling the reader anything they cannot already see.
 * - Keeping every OTHER axis is what stops the count becoming a claim the click
 *   cannot keep. Counting over the unfiltered register printed a global figure on
 *   a filtered view: with a date range applied the control read "16" and pressing
 *   it produced one row, and with a category applied it read "16" directly above
 *   "No transactions match these filters" — the app contradicting itself on one
 *   screen. That is not an edge case: `categoryRegisterHref` (O.5) sends readers
 *   into this register pre-filtered by category AND month, so arriving filtered is
 *   the designed path.
 *
 * A filter-scoped count is also the only one consistent with the rest of the page:
 * the summary tiles are already computed over the filtered set, so the global
 * count was the odd figure out, not the standard one.
 */
export function countUnclassified(rows: readonly TxnView[], filter: TxnFilter = {}): number {
  return filterTransactions(rows, { ...filter, unclassified: false }).filter(isUnclassifiedTxn).length;
}

/**
 * The register's date bounds, narrowed by the SET-DEFINING axes only (TASKS
 * K.4, decided in DECISIONS #436). The register answers "History available
 * from …" off the same two values the empty state reasons against (the
 * pair-equality property K.3's e2e locks), and K.3's critic found that pair
 * breaking one filter later: a reader narrowed to a card whose history starts
 * INSIDE the chosen window got the register's GLOBAL bound printed above "No
 * transactions match these filters" — the bound described the register, the
 * view described the card, and nothing joined them.
 *
 * Scope = account + category + unclassified: the axes that change WHICH ROWS
 * EXIST (where the money is, and what it is filed as). The MATCH axes — type,
 * class, search, merchant, reimbursement, the window itself — never move the
 * bound: toggling them changes which rows MATCH within the set, not where the
 * set begins, and a depth line that jumped on every toggle would mislead in
 * the opposite direction. The predicates are the same per-axis ones
 * `filterTransactions` applies, so a scoped bound and a filtered view can
 * never disagree about what belongs to the set. A scoped oldest is a lower
 * bound on every further-narrowed subset, which keeps `registerEmptyReason`'s
 * window branches sound under every remaining filter.
 */
export function scopedDateBounds(
  rows: readonly TxnView[],
  scope: { accountId?: string | null; categoryId?: string | null; unclassified?: boolean },
): { oldest: string | null; newest: string | null } {
  let oldest: string | null = null;
  let newest: string | null = null;
  for (const t of rows) {
    if (scope.accountId && t.accountId !== scope.accountId) continue;
    if (scope.categoryId && t.categoryId !== scope.categoryId) continue;
    if (scope.unclassified && !isUnclassifiedTxn(t)) continue;
    if (oldest === null || t.date < oldest) oldest = t.date;
    if (newest === null || t.date > newest) newest = t.date;
  }
  return { oldest, newest };
}

export interface TxnSummary {
  count: number;
  /**
   * U.20: how many of the rows these figures are summed from fall on a day the
   * boundary released to both sides of a combined pair.
   *
   * The caption above these totals enumerates what moves them ("Totals include
   * pending charges and exclude transfers…"), which reads as the COMPLETE rule
   * and omitted the one rule that counts a real transaction more than once. An
   * exhaustive-sounding sentence that is not exhaustive is the defect
   * `closing-a-gap-shrinks-the-disclosure-that-described-it` names.
   */
  countedOnHandoverDays: number;
  /** Sum of positive, non-transfer amounts. */
  inflowCents: Cents;
  /** Sum of magnitudes of negative, non-transfer amounts (positive number). */
  outflowCents: Cents;
  /** inflowCents − outflowCents (transfers excluded). */
  netCents: Cents;
  /**
   * O.15 (critic P2-1): rows in THIS summary's set the money figures dropped
   * as reader-excluded. Set-scoped like the figures themselves — the caption's
   * disclosure branches on this, never on the page slice, because an excluded
   * row on page 3 moves page 1's totals.
   */
  excludedCount: number;
}

/**
 * Register order: pending first (Mint / Simplifi — they stay at the top until
 * the bank clears them), then most-recent-first among each tier, with a stable
 * id tiebreak so order is fully deterministic.
 */
export function sortByDateDesc(rows: readonly TxnView[]): TxnView[] {
  return [...rows].sort((a, b) => {
    const aPending = a.status === 'PENDING' ? 0 : 1;
    const bPending = b.status === 'PENDING' ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;
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
    if (filter.unclassified && !isUnclassifiedTxn(t)) return false;
    if (filter.reimbursement && reimbursementState(t.reimbursement) !== filter.reimbursement) return false;
    if (filter.accountId && t.accountId !== filter.accountId) return false;
    if (filter.categoryId && t.categoryId !== filter.categoryId) return false;
    if (filter.spendClass && t.spendClass !== filter.spendClass) return false;
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

/**
 * The minimum a row must expose for the register's money totals to be computed
 * from it. `TxnView` satisfies it, and the calendar's posted half (TASKS K.1)
 * feeds its lean rows through the SAME `summarizeTransactions` below — one
 * function, so the two surfaces cannot disagree on a total by construction
 * (H.8's rule: a reader that describes what the register shows applies the
 * register's own math, not a re-implementation of it).
 */
export interface TotalableTxn extends ExcludableTxn {
  isTransfer: boolean;
  amountCents: number;
  /**
   * U.20: whether this row sits on a day the reconciliation boundary released to
   * both sides of a combined pair.
   *
   * Optional as a TYPE, but no longer because of /calendar: this docblock used to
   * name the calendar's lean row shape as the reason, and U.24 closed that — both
   * production callers (`getTransactions`'s `TxnView` and
   * `buildPostedCalendarMonth`'s `PostedTxnLike`) now carry the flag as a REQUIRED
   * field on their own row types, resolved at the server boundary that holds
   * `accountId`. What the optionality still buys is the structural minimum this
   * interface exists to be: a caller totalling rows that belong to no combined
   * pair at all need not invent the field. An absent value counts as "not
   * released" — the correct answer for a row whose pair membership is unknown, and
   * a silence each concrete row type is required to break for itself.
   */
  onHandoverDay?: boolean;
}

export function summarizeTransactions(rows: readonly TotalableTxn[]): TxnSummary {
  let inflow = 0;
  let outflow = 0;
  let excluded = 0;
  let handovers = 0;
  for (const t of rows) {
    if (isExcludedFromTotals(t)) excluded += 1;
    if (t.isTransfer) continue; // transfers are neither income nor expense
    // O.15: excluded rows stay LISTED (and counted as rows) but leave the
    // money figures, the same direction as every other total in the app.
    if (isExcludedFromTotals(t)) continue;
    // U.20: counted AFTER the two gates above and before the sums, so it counts
    // exactly the rows the money figures are summed from. A released row the
    // reader has excluded from totals cannot move those figures, so claiming it
    // might would be a disclosure about money that did not move. The `!== 0`
    // gate is the same rule one case over (critic cycle): a $0 verification
    // hold passes both gates and is summed — adding zero — so without it the
    // caption warned about a row whose doubling cannot move any tile.
    if (t.onHandoverDay === true && t.amountCents !== 0) handovers += 1;
    if (t.amountCents > 0) inflow += t.amountCents;
    else if (t.amountCents < 0) outflow += -t.amountCents;
  }
  return {
    count: rows.length,
    countedOnHandoverDays: handovers,
    inflowCents: cents(inflow),
    outflowCents: cents(outflow),
    netCents: cents(inflow - outflow),
    excludedCount: excluded,
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
  /** What the reader sees: the user's own name for the account when he set one, else the
   *  feed's (TASKS L.7 — resolved by `accountLabel` at the server boundary, never here). */
  name: string;
  /** The bank's own string, when the surface needs it as EVIDENCE (the duplicate and
   *  continue-an-account cards) or to prefill the rename box. Absent on surfaces that
   *  build an AccountView without one — they simply have nothing to disclose. */
  feedName?: string;
  /** The user's stored nickname, null when he never set one. Drives the rename control's
   *  "reset to my bank's name" affordance; NEVER an input to any comparison. */
  displayName?: string | null;
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
