/**
 * Server-side transaction & account reads for the register and accounts pages.
 * Every query is row-ownership scoped by userId (via the owning account).
 * Display formatting (merchant/category names) happens here; the pure query
 * engine in src/lib/engine/transactions/query.ts does the filtering/totals.
 */
import { prisma } from '@/lib/db';
import { isRuleEligibleMerchant } from '@/lib/engine/categorize/assign';
import { buildMerchantProfile } from '@/lib/engine/merchant/profile';
import { type MerchantLensCopy, merchantLensCopy, thinHistoryNote } from '@/lib/engine/merchant/lens-copy';
import { detectRecurring } from '@/lib/engine/recurring/detect';
import { summarizeRecurring } from '@/lib/engine/recurring/summary';
import { categoryName } from '@/lib/engine/categorize/categories';
import { type PredictionSource, describeProvenance } from '@/lib/engine/categorize/provenance';
import { registerDisplayName } from '@/lib/engine/transactions/display-name';
import { rowOrigin } from '@/lib/engine/transactions/origin';
import { categorize } from '@/lib/engine/categorize/pipeline';
import { proposalReason } from '@/lib/engine/categorize/propose';
import { registerSuggestionFor } from '@/lib/engine/categorize/register-suggestion';
import { loadCorrectionInputs, loadUserRules } from '@/server/rules';
import { getThresholdTuning } from '@/server/tuning';
import { getCategoryMeta } from '@/server/category-meta';
import { getRecurringBillMerchantCanonicals } from '@/server/recurring-bill-merchants';
import { similarTransactionsWhere } from '@/server/triage';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { classifySpendClass } from '@/lib/engine/spending-plan/spend-class';

/**
 * The label a row shows for its category — the reader's own vocabulary first.
 *
 * ONE resolver for the register, the detail view and split parts, because these
 * three drifted from the pickers the moment a rename existed (O.17, found by two
 * independent critics). The joined `Category.name` is the LAST resort: for a
 * built-in it is the global canonical name, which is precisely the wrong answer
 * for a reader who renamed it, so it serves only a row whose category is missing
 * from the per-user meta.
 */
function categoryLabel(
  id: string | null | undefined,
  meta: ReadonlyMap<string, { name: string }> | null,
  joined?: string | null,
): string {
  if (!id) return categoryName(null);
  return meta?.get(id)?.name ?? joined ?? categoryName(id);
}
import { cents, formatCents } from '@/lib/money';
import { type NetWorthSeriesPoint, netWorthSeries } from '@/lib/engine/networth/series';
import { trendHistoryFloor } from '@/lib/engine/networth/snapshot-plan';
import {
  type AmbiguousReconciliationGroup,
  type ReconciliationCandidate,
  type SuspectedDuplicatePair,
  detectDuplicateAccounts,
  detectReconciliationCandidates,
} from '@/lib/engine/account/duplicates';
import {
  type LinkAuditVerdict,
  auditConfirmedLinks,
} from '@/lib/engine/account/link-audit';
import { duplicatePairDismissKey, getDismissedDuplicateKeys } from '@/server/duplicate-dismissal';
import {
  type ReconciliationLinkLike,
  applyReconciliationBoundary,
  effectiveReconciliationLinks,
  handoverKey,
  reconciliationTxnKeepFilter,
} from '@/lib/engine/account/reconcile-boundary';
import {
  type AccountDepthFact,
  type ConnectionDepth,
  connectionHistoryDepth,
} from '@/lib/engine/account/connection-depth';
import {
  activeSupersededPredecessorIds,
  getActiveReconciliations,
  getReconciliationBoundary,
  isAccountLive,
} from '@/server/reconciliation';
import {
  type CombineBlockedView,
  combinableConnectionsFor,
  combinePairKey,
  suppressCombineProposals,
  uncombinableConnectionsFor,
} from '@/server/combine-connections';
import type { CombineConnectionsProposal } from '@/lib/engine/account/combine-connections';
import {
  type WithheldAccountSummary,
  isSupportedCurrency,
  summarizeWithheldAccounts,
} from '@/lib/providers/currency';
import { businessToday } from '@/lib/business-today';
import { isoDate } from '@/lib/dates';
import { syncedDeleteBlockReason } from '@/server/account-delete';
import type { DroppedAccountInput } from '@/lib/engine/account/feed-dropped-view';
import { type FreshnessResult, classifyFreshness, perAccountFreshness } from '@/lib/engine/sync/health';
import {
  type AccountView,
  type AccountsSummary,
  type PageInfo,
  type TxnFilter,
  type TxnSummary,
  type TxnView,
  SPENDING_ACCOUNT_TYPES,
  countUnclassified,
  filterTransactions,
  groupAccounts,
  isLiabilityType,
  paginate,
  scopedDateBounds,
  sortByDateDesc,
  summarizeTransactions,
} from '@/lib/engine/transactions/query';
import { isDemoUser } from '@/lib/demo-user';
import { accountLabel } from '@/lib/engine/account/display-name';
import type { CountedInsteadOf } from '@/lib/engine/account/balance-history-view';
import {
  SPLIT_BLOCKED_CHILD,
  SPLIT_BLOCKED_REIMBURSED,
  SPLIT_BLOCKED_TOO_SMALL,
  SPLIT_BLOCKED_TRANSFER,
} from '@/lib/engine/transactions/actions';
import { findOffsettingInflow, reimbursementState } from '@/lib/engine/transactions/reimbursement';
import { getRecurringOverrides } from '@/server/recurring-overrides';

/** Merchant Pattern Lens view (AI plan §Later #19, DECISIONS #250): rendered
 *  narration for the merchant the register is filtered to. Null when the
 *  engine honestly abstains (aggregate pseudo-merchant, no qualifying charges). */
export interface MerchantLensView {
  /** Canonical display name (row casing, never the URL param's). */
  merchant: string;
  copy: MerchantLensCopy;
  /** Present below the pattern floor — replaces the pattern lines. */
  thinNote: string | null;
}

export interface TransactionsResult {
  rows: TxnView[];
  summary: TxnSummary;
  /** The register's filterable set for the account dropdown: the user's
   *  spending accounts through `registerAccountWhere` (one author with the row
   *  query), INCLUDING accounts with zero rows — an active filter must always
   *  be visible in the control that expresses it. */
  accountOptions: { id: string; name: string }[];
  /**
   * The `?account=` axis resolved against the reader's own accounts, for
   * `registerEmptyReason` and the filter bar's account chip. `null` when the
   * axis is off or names a spending account (the dropdown expresses those);
   * 'not-here' when the account exists but the register's basis excludes its
   * type (the mortgage dead-end, owner 2026-08-11); 'unknown' when no account
   * of the reader's has this id.
   */
  accountFilter:
    | null
    | { kind: 'not-here'; id: string; name: string; type: string }
    | { kind: 'no-rows'; name: string }
    | { kind: 'unknown' };
  /** Pagination state for the current (filtered) page (ROADMAP #8). */
  pageInfo: PageInfo;
  /** Set only when the filter names a merchant AND the profile has something
   *  honest to say (viewer-only: computed from the viewer's own rows). */
  lens: MerchantLensView | null;
  /**
   * How many rows the "Needs a category" control would show if the reader pressed
   * it right now — see `countUnclassified` for why that is the only number it may
   * print. Counted through `filter` with the `unclassified` axis dropped, so it
   * agrees with the click while still saying something the page does not already
   * show once the control is on.
   *
   * Rows, not merchant groups. The nav badge counts GROUPS (server/triage.ts), so a
   * reader with 40 loose rows across 3 merchants sees "3" there; on the register,
   * where the rows themselves are the thing being looked at, the row count is the
   * number that matches what the reader is scrolling past. The two figures are
   * allowed to differ because each is reachable by pressing the thing that prints
   * it — which is precisely the property the pre-filter count failed.
   */
  unclassifiedCount: number;
  /**
   * Date of the oldest transaction in the reader's FULL visible set (pre-filter),
   * or null when there are none. The register's period presets name windows like
   * "last year"; this is the date that says how much history exists to fill them
   * (a bank linked last month cannot show last year), so the picker can disclose
   * its own real bound instead of returning a partial window wearing a
   * complete-sounding name.
   */
  oldestDate: string | null;
  /**
   * Date of the NEWEST transaction in that same pre-filter set, or null when
   * there are none. The twin of `oldestDate`, and it exists for the same reason
   * one step further on (owner report 2026-08-06): a chosen window that sits
   * entirely outside [oldest, newest] returns zero rows, and without both bounds
   * the register can only blame the filters for it. With them it can name WHICH
   * zero this is — see `registerEmptyReason`.
   */
  newestDate: string | null;
}

/** Rows per register page. */
const PAGE_SIZE = 100;

/**
 * The four per-user loaders the O.9d suggestion ladder needs. Passed in rather
 * than loaded per row: the register maps thousands of rows from ONE load, and
 * the detail view (O.13b) maps one row from the same four, so the two surfaces
 * cannot answer "what is this row?" from different inputs.
 */
interface SuggestionLadderInputs {
  userRules: Awaited<ReturnType<typeof loadUserRules>>;
  tuning: Awaited<ReturnType<typeof getThresholdTuning>>;
  meta: Awaited<ReturnType<typeof getCategoryMeta>>;
  corrections: Awaited<ReturnType<typeof loadCorrectionInputs>>;
}

/** The stored facts the ladder and the provenance resolver read off one row. */
interface SuggestibleRow {
  categoryId: string | null;
  isTransfer: boolean;
  reviewPinned: boolean;
  rawDescriptor: string;
  amountCents: number;
  date: string;
  accountId: string;
  providerCategoryId: string | null;
}

/**
 * The O.9d chip for one row, or null — see registerSuggestionFor for the ladder.
 *
 * Module-level (was a closure inside getTransactions until O.13b) so the
 * transaction detail view computes it from the identical code path. A second
 * implementation here would be the register and the detail page disagreeing
 * about what the app thinks an unfiled row is, on two screens one click apart.
 */
function suggestionForRow(t: SuggestibleRow, inputs: SuggestionLadderInputs): TxnView['suggestion'] {
  // Cost gate only — the engine re-checks both conditions. A filed row never
  // needs the pipeline run, and the full register can hold thousands of rows.
  if ((t.categoryId ?? 'uncategorized') !== 'uncategorized') return null;
  if (t.isTransfer && !t.reviewPinned) return null;
  const out = categorize(
    { rawDescriptor: t.rawDescriptor, amountCents: t.amountCents, date: t.date, accountId: t.accountId },
    inputs.userRules,
    { flaggedBps: inputs.tuning.flaggedBps },
  );
  const s = registerSuggestionFor(
    {
      currentCategoryId: t.categoryId ?? 'uncategorized',
      isTransfer: t.isTransfer,
      reviewPinned: t.reviewPinned,
      pipelineCategoryId: out.categoryId,
      providerCategoryId: t.providerCategoryId,
      txn: { rawDescriptor: t.rawDescriptor, amountCents: t.amountCents },
    },
    inputs.corrections,
  );
  if (s === null) return null;
  const label = categoryName(s.categoryId, inputs.meta);
  return {
    kind: s.kind,
    categoryId: s.categoryId,
    categoryName: label,
    reason: s.proposal
      ? proposalReason(s.proposal, {
          categoryLabel: label,
          amount:
            s.proposal.matchedAmountCents === null
              ? null
              : formatCents(cents(Math.abs(s.proposal.matchedAmountCents))),
        })
      : null,
  };
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
/**
 * The register's row basis, as ONE expression (TASKS K.1). Spending accounts
 * only — bank + cards; brokerage/loan activity isn't spending (#62). Currency
 * guard (DECISIONS #135): exclude non-USD accounts so the register + its
 * account dropdown match /accounts and net worth, which withhold them (no FX).
 * Split PARENT containers excluded — their children carry the real amounts.
 *
 * Shared by `getTransactions`, the calendar's posted read below, and the CSV
 * import depth confirmation (H.2) so every surface queries the same rows by
 * construction; a second copy of this clause is how a reader starts
 * disagreeing with the register (H.8).
 */
export const registerAccountWhere = (userId: string) => ({
  userId,
  type: { in: [...SPENDING_ACCOUNT_TYPES] },
  OR: [{ currency: null }, { currency: 'USD' as const }],
});

export const registerRowWhere = (userId: string) => ({
  account: registerAccountWhere(userId),
  isSplitParent: false,
});

/**
 * The calendar's posted half (TASKS K.1): lean register-basis rows for one
 * month window, plus the register's own history bounds. Reuses the register's
 * exact where-clause AND the R1 reconciliation keep, so the day totals the
 * calendar prints (through the shared `summarizeTransactions`) equal the
 * register summary for the same window by construction — the K.1 gate. The
 * bounds are computed over the KEPT set: a bound read off disowned rows would
 * name a date whose rows the register refuses to show (the K.3 direction).
 */
export interface PostedCalendarRead {
  rows: {
    date: string;
    amountCents: number;
    isTransfer: boolean;
    excludeFromTotals: boolean;
    /** PENDING rows stay in the figures (the register's summary counts them — the gate requires
     *  it) but must be NAMED wherever the surface says "posted" (critics K.1 F-1). */
    pending: boolean;
    /** U.24: the (account, day) pairs the R1 keep above RELEASED to both sides of a combined
     *  pair (U.13) — resolved HERE because this is the layer holding `accountId`, exactly as
     *  the register resolves it at its own boundary (U.20). The calendar's rows are lean by
     *  design, so the pairing cannot be re-derived downstream. */
    onHandoverDay: boolean;
  }[];
  oldestPostedDate: string | null;
  newestPostedDate: string | null;
}

export async function getPostedCalendarRows(
  userId: string,
  from: string, // inclusive YYYY-MM-DD
  to: string, // inclusive YYYY-MM-DD
): Promise<PostedCalendarRead> {
  // Full history on purpose: the bounds must span the whole register, and the register itself
  // loads every row per call (see getTransactions) — this select is a strict subset of that work.
  const raw = await prisma.transaction.findMany({
    where: registerRowWhere(userId),
    select: { accountId: true, date: true, amountCents: true, isTransfer: true, excludeFromTotals: true, status: true },
  });
  // U.31: keep + handover keys from ONE read of the link table (`getReconciliationBoundary`)
  // — the two used to be fetched by separate sequential calls that each independently
  // re-read the links, the exact shape `getAccountsView` (below, critic F-4) already argued
  // against: a confirm/undo landing between the two awaits could desync the keep from the
  // handover set. Fetched together, never derived from one another: the keep answers "does
  // this row survive", which is true of BOTH copies on a released day and of every ordinary
  // row — it cannot tell them apart.
  const { keepsReconciled, handoverKeys } = await getReconciliationBoundary(userId);
  const kept = raw.filter((t) => keepsReconciled(t.accountId, t.date));
  let oldestPostedDate: string | null = null;
  let newestPostedDate: string | null = null;
  for (const r of kept) {
    if (oldestPostedDate === null || r.date < oldestPostedDate) oldestPostedDate = r.date;
    if (newestPostedDate === null || r.date > newestPostedDate) newestPostedDate = r.date;
  }
  return {
    rows: kept
      .filter((r) => r.date >= from && r.date <= to)
      .map((r) => ({
        date: r.date,
        amountCents: r.amountCents,
        isTransfer: r.isTransfer,
        excludeFromTotals: r.excludeFromTotals,
        pending: r.status === 'PENDING',
        onHandoverDay: handoverKeys.has(handoverKey(r.accountId, r.date)),
      })),
    oldestPostedDate,
    newestPostedDate,
  };
}

export async function getTransactions(userId: string, filter: TxnFilter = {}, page = 1): Promise<TransactionsResult> {
  const rawTxns = await prisma.transaction.findMany({
    where: registerRowWhere(userId),
    // Join the category row as a BACKSTOP only. The displayed label is resolved
    // through the per-user meta below, because a built-in the reader RENAMED
    // (O.17) keeps the canonical `Category.name` in the DB — the rename is an
    // overlay row — so trusting this join printed the old name on the register
    // while the row's own picker printed the new one. Two names for one bucket,
    // side by side. Found by both O.17 critics independently (DECISIONS #350).
    // `provider` joined for `rowOrigin` (O.15 slice 7): the register's action menu
    // must know whether a feed owns this row before offering a status write.
    include: { account: { select: { id: true, name: true, displayName: true, provider: true } }, merchant: true, category: { select: { name: true } } },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
  });

  // Reconciliation boundary (slice-6 critics B-F1/C-1): the register was the one
  // transaction surface reading Prisma directly, so a reconciled pair's overlap rows
  // double-counted here — rows AND summary totals — while the dashboard, reports, and
  // trends (snapshot-fed) counted them once, on the same screenload. Apply the
  // assembler's EXACT R1 ownership rule before anything derives from the row set:
  // merchant counts, provenance, the lens, the summary, and pagination all inherit
  // it. (The account DROPDOWN no longer derives from rows — since U.3 it lists the
  // filterable Account set, and inherits the reconciliation rule as the
  // superseded-predecessor exclusion below instead.) No active links →
  // constant-true fast path (R8).
  // U.31: keep + handover keys from ONE read of the link table — see the comment on the
  // identical fetch in `getPostedCalendarRows` above.
  //
  // U.20: the (account, day) pairs the keep below deliberately RELEASED to both
  // sides of a combined pair (U.13) — the register is the surface that lists the
  // two identical rows, so it is the one place the flag must ride every row.
  // Account-scoped, same as every panel since U.16's second critic cycle: an
  // unscoped date set would mark ordinary rows on accounts in no pair at all.
  const { keepsReconciled, handoverKeys } = await getReconciliationBoundary(userId);
  const txns = rawTxns.filter((t) => keepsReconciled(t.accountId, t.date));

  // How many transactions share each merchant — drives the "apply to N" count
  // on the register's "Always" action (DECISIONS #42).
  const merchantCounts = new Map<string, number>();
  for (const t of txns) {
    if (t.merchantId) merchantCounts.set(t.merchantId, (merchantCounts.get(t.merchantId) ?? 0) + 1);
  }

  // Category provenance (Why-This-Category §3.1): the persisted prediction row is
  // the 1:1 record of HOW each category was decided. One query, keyed by
  // transactionId; a row with no prediction (user-dictated / pre-#190 history)
  // resolves to an honest 'user-set' / 'not-recorded' — never a guessed origin.
  //
  // Rules/tuning/meta/corrections feed the per-row suggestion ladder (O.9d) —
  // the SAME loaders getTriageGroups uses, so the register and the inbox can
  // never answer the "what is this row?" question from different inputs.
  // `loadCorrectionInputs` is demo-fenced at its own definition (#332).
  const [predictions, userRules, tuning, meta, corrections, fixedMerchants] = await Promise.all([
    prisma.categoryPrediction.findMany({
      where: { userId },
      select: { transactionId: true, source: true, predictedCategoryId: true, labeledAt: true },
    }),
    loadUserRules(userId),
    getThresholdTuning(userId),
    getCategoryMeta(userId),
    loadCorrectionInputs(userId),
    getRecurringBillMerchantCanonicals(userId),
  ]);
  const predByTxn = new Map(predictions.map((p) => [p.transactionId, p]));

  const ladder: SuggestionLadderInputs = { userRules, tuning, meta, corrections };

  const rows: TxnView[] = txns.map((t) => ({
    id: t.id,
    date: t.date,
    accountId: t.accountId,
    accountName: accountLabel(t.account),
    merchantName: registerDisplayName(t),
    rawDescriptor: t.rawDescriptor,
    categoryId: t.categoryId ?? 'uncategorized',
    categoryName: categoryLabel(t.categoryId, meta, t.category?.name),
    amountCents: t.amountCents,
    status: t.status,
    // O.15 slice 7: who owns this row, on the one shared basis the detail view's
    // provenance line uses. The status control is offered only where no feed will
    // overwrite the answer.
    descriptorOrigin: rowOrigin({ providerRef: t.providerRef, accountProvider: t.account.provider }),
    isTransfer: t.isTransfer,
    // U.20: kept next to the keep-filter above that created the possibility —
    // a row survives the filter AND sits on a released day only when the
    // boundary kept both sides' copies on purpose.
    onHandoverDay: handoverKeys.has(handoverKey(t.accountId, t.date)),
    note: t.note,
    taxClass: t.taxClass,
    // O.15: stored flags, verbatim — the badge and the menu render from these.
    excludeFromTotals: t.excludeFromTotals,
    reimbursement: t.reimbursement,
    splitParentId: t.splitParentId,
    // The stored flag, verbatim. Half of "unclassified" (see `isUnclassifiedTxn`);
    // the other half is the row sitting in the 'uncategorized' placeholder above.
    needsReview: t.needsReview,
    merchantId: t.merchantId,
    ruleEligible: isRuleEligibleMerchant(t.rawDescriptor),
    merchantCount: t.merchantId ? merchantCounts.get(t.merchantId) : undefined,
    // Resolve from the RAW stored facts (not the 'uncategorized' display
    // fallback above): the P1-3 divergence guard compares the prediction's
    // predictedCategoryId against the transaction's live categoryId, so both
    // must be the true DB values. `source` is a free String? in the DB; the
    // resolver is total over unknown strings (→ not-recorded), so the cast is safe.
    provenance: describeProvenance({
      source: (predByTxn.get(t.id)?.source ?? null) as PredictionSource | null,
      hasPredictionRow: predByTxn.has(t.id),
      txnConfidenceBps: t.confidenceBps ?? 0,
      userLabeled: predByTxn.get(t.id)?.labeledAt != null,
      predictedCategoryId: predByTxn.get(t.id)?.predictedCategoryId ?? null,
      currentCategoryId: t.categoryId ?? null,
    }),
    suggestion: suggestionForRow(t, ladder),
    // #397: Fixed / Discretionary per ROW — the reader's verdict on this
    // transaction wins, else the guess (recurring-bill merchant → fixed, else
    // the category's taxonomy flag). Same classifier as /budgets and Plan.
    spendClass: classifySpendClass(
      {
        accountId: t.accountId,
        date: t.date,
        amountCents: t.amountCents,
        categoryId: t.categoryId,
        isTransfer: t.isTransfer,
        status: t.status,
        rawDescriptor: t.rawDescriptor,
        excludeFromTotals: t.excludeFromTotals,
        spendClassOverride: t.spendClassOverride,
      },
      meta,
      fixedMerchants,
    ),
    // C.16 (F8): the register can say whether the class is the reader's own
    // setting — the ONLY writers of the override are the reader (the dial) and
    // the reader's explicit rules (see TxnView.spendClassReaderSet).
    spendClassReaderSet: t.spendClassOverride !== null,
  }));

  // Merchant Pattern Lens (DECISIONS #250): computed from the viewer's FULL row
  // set (pre-filter — the profile is all-history by design), only when the
  // filter names a merchant. The recurring engine supplies the cadence line,
  // fed POSTED-only rows — the exact getRecurring predicate — so the lens and
  // /recurring read the same series (#250 critic F2: a PENDING charge must
  // never move "typically" or manufacture a phantom price change). Note the
  // lens groups by the row's stored merchant canonical (what the register
  // shows); the radar re-normalizes rawDescriptor — identical unless a stored
  // canonical predates a KNOWN_MERCHANTS edit (recorded residual, STATUS).
  let lens: MerchantLensView | null = null;
  if (filter.merchant?.trim()) {
    const today = businessToday(userId);
    const profile = buildMerchantProfile(
      rows.map((r) => ({
        date: r.date,
        amountCents: r.amountCents,
        merchant: r.merchantName,
        status: r.status,
        isTransfer: r.isTransfer,
        excludeFromTotals: r.excludeFromTotals, // O.15: lens money figures obey the basis
      })),
      filter.merchant,
      today,
    );
    if (profile) {
      const series = detectRecurring(
        txns
          .filter((t) => t.status === 'POSTED')
          .map((t) => ({
            id: t.id,
            accountId: t.accountId,
            date: t.date,
            amountCents: t.amountCents,
            rawDescriptor: t.rawDescriptor,
            isTransfer: t.isTransfer,
          })),
        today,
        // O.13f: the merchant lens captions this payee with its cadence and
        // monthly rate, so it must read the reader's own verdicts too — a payee he
        // declared a bill is captioned as one here, and one he demoted loses the
        // caption instead of keeping it on the single page that re-detects locally.
        await getRecurringOverrides(userId),
      );
      // Expense series only: the profile describes CHARGES, so an income
      // series' cadence (a deposit schedule) must never caption it.
      const item =
        summarizeRecurring(series, today).items.find(
          (s) => !s.isIncome && s.merchantCanonical.toLowerCase() === profile.merchant.toLowerCase(),
        ) ?? null;
      lens = {
        merchant: profile.merchant,
        copy: merchantLensCopy(
          profile,
          item
            ? {
                cadence: item.cadence,
                typicalAmountCents: item.typicalAmountCents,
                nextExpectedAt: item.nextExpectedAt,
                active: item.active,
              }
            : null,
        ),
        thinNote: thinHistoryNote(profile.chargeCount),
      };
    }
  }

  const filtered = sortByDateDesc(filterTransactions(rows, filter));

  // Summary totals are over the FULL filtered set (accurate); the page slice keeps
  // the DOM light (rendering 800+ interactive rows delays hydration). Page
  // navigation (ROADMAP #8) lets the user reach EVERY filtered row, replacing the
  // old silent "most recent 200" cap.
  const summary = summarizeTransactions(filtered);
  const { items, info } = paginate(filtered, page, PAGE_SIZE);

  // Account options are the register's FILTERABLE SET — the user's spending
  // accounts, from the Account table through the register's own scope
  // expression (`registerAccountWhere`, one author with the row query). Not
  // from rows-present: a just-linked checking account with zero rows used to
  // vanish from this dropdown, so filtering to it showed "All accounts" while
  // a filter was active — the banner above ("the controls below say which")
  // was false exactly when the reader most needed it (owner report
  // 2026-08-11, the mortgage dead-end slice). Its zero-row register view now
  // names itself honestly ('account-empty' below), so listing it is an
  // affordance rather than a dead end. Active superseded PREDECESSORS are
  // excluded on the same basis /transactions/new, /rules and /import use —
  // reconciliation disowns their rows, so offering the name beside its
  // successor's would be a near-duplicate whose selection can only show a
  // zero the reader cannot act on (U.3 critic, finding #8).
  const [filterableAccounts, supersededIds] = await Promise.all([
    prisma.account.findMany({
      where: registerAccountWhere(userId),
      select: { id: true, name: true, displayName: true },
    }),
    activeSupersededPredecessorIds([userId]),
  ]);
  const accountOptions = filterableAccounts
    .filter((a) => !supersededIds.has(a.id))
    .map((a) => ({ id: a.id, name: accountLabel(a) }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));

  // Resolve the `?account=` axis against the reader's own accounts so the
  // empty state can name WHICH zero this is (`registerEmptyReason`):
  // 'not-here' for an account the basis excludes (a LOAN / MORTGAGE /
  // INVESTMENT id returns zero rows BY CONSTRUCTION — until this slice the
  // page blamed "these filters" for it), 'no-rows' for an in-basis account
  // the register holds nothing for (the same dead end one type-class over —
  // U.3 critic, finding #2), 'unknown' for an id that is not the reader's.
  // Scoped to userId — another user's account id resolves to 'unknown', never
  // to a name.
  let accountFilter: TransactionsResult['accountFilter'] = null;
  if (filter.accountId) {
    const option = accountOptions.find((a) => a.id === filter.accountId);
    if (option) {
      // `rows` is the register's own kept pre-filter set, so "has no rows"
      // here agrees byte-for-byte with what every filter combination on this
      // account could ever show.
      if (!rows.some((r) => r.accountId === filter.accountId)) {
        accountFilter = { kind: 'no-rows', name: option.name };
      }
    } else {
      const acct = await prisma.account.findFirst({
        where: { id: filter.accountId, userId },
        select: { id: true, name: true, displayName: true, type: true, currency: true },
      });
      if (!acct) {
        accountFilter = { kind: 'unknown' };
      } else if (SPENDING_ACCOUNT_TYPES.includes(acct.type) && isSupportedCurrency(acct.currency)) {
        // In the register's type+currency basis yet absent from the options:
        // the only remaining exclusion is the superseded-predecessor rule,
        // whose KEPT rows are zero by construction — so 'no-rows' is the true
        // statement, and 'not-here' would make the copy layer derive a false
        // currency story from the spending type (U.3 critic follow-up).
        accountFilter = { kind: 'no-rows', name: accountLabel(acct) };
      } else {
        accountFilter = { kind: 'not-here', id: acct.id, name: accountLabel(acct), type: acct.type };
      }
    }
  }

  // Through the caller's filter with the `unclassified` axis dropped — see
  // `countUnclassified`. Not over `rows`: a global figure printed on a filtered
  // view is a promise the click cannot keep. Not over `filtered` either, or it
  // would just restate the page's own length once the control is on.
  const unclassifiedCount = countUnclassified(rows, filter);

  // Over the pre-filter set, narrowed by the SET-DEFINING axes only (account,
  // category, unclassified — K.4, DECISIONS #436): the span describes the set
  // the reader is browsing, never `filtered`. The F10 defect was a bound that
  // did not: a reader narrowed to a card whose history starts INSIDE the chosen
  // window printed the register's GLOBAL oldest above "No transactions match
  // these filters" — both sentences true, neither about the view. Scoped, the
  // bound is a lower bound on every further-narrowed subset, so the window
  // branches of `registerEmptyReason` stay sound. The match axes (type, class,
  // search, merchant, reimbursement, the window) never move the line — they
  // select WITHIN the set; a depth line that jumped on every toggle would
  // mislead in the other direction. Explicit scan rather than trusting the
  // sort: an ordering change upstream must not silently move the disclosed
  // bound.
  const { oldest: oldestDate, newest: newestDate } = scopedDateBounds(rows, {
    accountId: filter.accountId,
    categoryId: filter.categoryId,
    unclassified: filter.unclassified,
  });

  return { rows: items, summary, accountOptions, accountFilter, pageInfo: info, lens, unclassifiedCount, oldestDate, newestDate };
}

/** One piece of a split, as the detail view lists it. */
export interface SplitPartView {
  id: string;
  amountCents: number;
  categoryId: string;
  categoryName: string;
}

/**
 * Everything the transaction detail page (TASKS O.13b) renders about ONE row.
 *
 * `row` is the SAME `TxnView` the register renders, mapped by the same
 * expressions — so the payee, the category name and the provenance badge cannot
 * say one thing in the list and another on the page it links to.
 */
export interface TransactionDetailView {
  row: TxnView;
  /** This row was split by hand: its children carry the money, it carries none. */
  isSplitParent: boolean;
  /** The pieces, when this row is a split parent (empty otherwise). */
  parts: SplitPartView[];
  /** Set when this row is itself one piece of a split — links back to the container. */
  splitParentId: string | null;
  /** Why a split is not offered on this row, or null when it is. */
  splitBlockedReason: string | null;
  /**
   * Where `rawDescriptor` CAME FROM — the only honest basis for the provenance
   * line. A manual or CSV row's descriptor is text the reader typed, and a
   * manual account has no statement at all, so calling it "your statement" would
   * be a sentence about the bank generated from the reader's own keystrokes
   * (critic cycle 1, P1). 'bank' means a real feed (Plaid / SimpleFIN).
   */
  descriptorOrigin: 'bank' | 'entered';
  /**
   * O.15: when this row's reimbursement is 'received', the inflow that most
   * plausibly paid it back — a display-time SUGGESTION from
   * `findOffsettingInflow` (exact opposite amount, on/after the purchase,
   * within the 90-day window), never a stored link and never part of any
   * figure. Null when untracked, still awaiting, or nothing matches.
   */
  reimbursementMatch: { id: string; date: string; amountCents: number; merchantName: string } | null;
  /**
   * #397: how many transactions share this row's payee — the count on the
   * spend-class dial's "All N <payee>" scope choice, computed on the action's
   * OWN targeting basis (`similarTransactionsWhere`, reconciliation-filtered)
   * so the number confirmed is the set the write touches. Null when there is
   * no merchant-wide scope (merchantless / aggregate payee, split container).
   */
  spendClassSiblingCount: number | null;
}

/**
 * O.15: the "likely this deposit" suggestion for a RECEIVED reimbursement.
 * Candidates are the exact opposite amount on any of the user's spending
 * accounts — the pure matcher applies the window/status/kind rules and picks
 * deterministically. One narrow query, only on the 'received' state.
 */
async function reimbursementMatchFor(
  userId: string,
  t: { id: string; date: string; amountCents: number; reimbursement: string | null },
): Promise<TransactionDetailView['reimbursementMatch']> {
  if (reimbursementState(t.reimbursement) !== 'received' || t.amountCents >= 0) return null;
  const candidates = await prisma.transaction.findMany({
    where: {
      account: { userId, type: { in: [...SPENDING_ACCOUNT_TYPES] }, OR: [{ currency: null }, { currency: 'USD' }] },
      amountCents: -t.amountCents,
      date: { gte: t.date },
    },
    include: { merchant: true },
  });
  const match = findOffsettingInflow(
    { id: t.id, date: t.date, amountCents: t.amountCents, reimbursement: t.reimbursement },
    candidates.map((c) => ({
      id: c.id,
      date: c.date,
      amountCents: c.amountCents,
      reimbursement: c.reimbursement,
      isTransfer: c.isTransfer,
      isSplitParent: c.isSplitParent,
      status: c.status,
    })),
  );
  if (!match) return null;
  const row = candidates.find((c) => c.id === match.id);
  return {
    ...match,
    merchantName: row ? registerDisplayName(row) : '',
  };
}

/**
 * One transaction, by id, scoped to its owner — the read behind
 * `/transactions/[id]`. Returns null for an id that is not this user's, so the
 * page 404s rather than confirming that someone else's transaction exists.
 *
 * Deliberately does NOT apply the register's `isSplitParent: false` exclusion.
 * The register hides a split container because listing it beside its children
 * would double-count the money; the detail page shows exactly one row and no
 * totals, and the container is the only place "undo this split" can live.
 */
export async function getTransactionDetail(
  userId: string,
  transactionId: string,
): Promise<TransactionDetailView | null> {
  const t = await prisma.transaction.findFirst({
    where: {
      id: transactionId,
      account: { userId, type: { in: [...SPENDING_ACCOUNT_TYPES] }, OR: [{ currency: null }, { currency: 'USD' }] },
    },
    include: {
      account: { select: { id: true, name: true, displayName: true, provider: true } },
      merchant: true,
      category: { select: { name: true } },
    },
  });
  if (!t) return null;

  // The register withholds a reconciled duplicate's rows (the assembler's R1
  // ownership rule); a page that rendered one would be a fully editable
  // transaction that every total in the app treats as nonexistent — the
  // "one question, one basis" divergence, reachable by bookmark or a stale link.
  // Withheld here means not found, exactly as the register means it.
  // U.31: keep + handover keys from ONE read of the link table — see the comment on the
  // identical fetch in `getPostedCalendarRows` above. U.20: `handoverKeys` is the same
  // released-day flag the register rows carry, from the same account-scoped set — a
  // detail page reached from a marked row must not silently drop the one fact that
  // explains its twin.
  const { keepsReconciled, handoverKeys } = await getReconciliationBoundary(userId);
  if (!keepsReconciled(t.accountId, t.date)) return null;

  // The suggestion ladder only ever fires on an UNFILED row — `suggestionForRow`
  // returns null on its first line otherwise — so a filed row was loading four
  // per-user datasets, including the reader's entire correction history, purely to
  // discard them (critic cycle 2, F8). The gate is the ladder's own first
  // condition, kept next to it so the two cannot drift.
  const needsLadder = (t.categoryId ?? 'uncategorized') === 'uncategorized';
  const [prediction, userRules, tuning, meta, corrections, fixedMerchants, children] = await Promise.all([
    prisma.categoryPrediction.findFirst({
      where: { userId, transactionId: t.id },
      select: { source: true, predictedCategoryId: true, labeledAt: true },
    }),
    needsLadder ? loadUserRules(userId) : null,
    needsLadder ? getThresholdTuning(userId) : null,
    // NOT gated on `needsLadder`. It was, while it only fed the ladder; O.17 makes
    // it decide the row's own LABEL, and a FILED row is exactly the case the gate
    // excluded — so a renamed category printed its canonical name on every filed
    // transaction's detail page. A gate must move with the thing it guards.
    getCategoryMeta(userId),
    needsLadder ? loadCorrectionInputs(userId) : null,
    getRecurringBillMerchantCanonicals(userId),
    prisma.transaction.findMany({
      // `account: { userId }` is redundant today (the parent is ownership-verified
      // above and a child is only ever created on its parent's account) but this
      // file's header promises EVERY query carries the scope, and a promise with
      // one exception is not a promise.
      where: { splitParentId: t.id, account: { userId } },
      select: { id: true, amountCents: true, categoryId: true, category: { select: { name: true } } },
      orderBy: { id: 'asc' },
    }),
  ]);

  const row: TxnView = {
    id: t.id,
    date: t.date,
    accountId: t.accountId,
    accountName: accountLabel(t.account),
    merchantName: registerDisplayName(t),
    rawDescriptor: t.rawDescriptor,
    categoryId: t.categoryId ?? 'uncategorized',
    categoryName: categoryLabel(t.categoryId, meta, t.category?.name),
    amountCents: t.amountCents,
    status: t.status,
    // O.15 slice 7: who owns this row, on the one shared basis the detail view's
    // provenance line uses. The status control is offered only where no feed will
    // overwrite the answer.
    descriptorOrigin: rowOrigin({ providerRef: t.providerRef, accountProvider: t.account.provider }),
    isTransfer: t.isTransfer,
    onHandoverDay: handoverKeys.has(handoverKey(t.accountId, t.date)),
    note: t.note,
    taxClass: t.taxClass,
    // O.15: stored flags, verbatim — the badge and the menu render from these.
    excludeFromTotals: t.excludeFromTotals,
    reimbursement: t.reimbursement,
    splitParentId: t.splitParentId,
    needsReview: t.needsReview,
    merchantId: t.merchantId,
    ruleEligible: isRuleEligibleMerchant(t.rawDescriptor),
    // merchantCount is deliberately absent: it drives the register's "apply to N"
    // copy, and the register derives it from the reconciliation-filtered set it
    // has already loaded. A second count computed here could differ by a
    // reconciled duplicate — so this page offers "just this once" and sends
    // every durable, all-rows instruction to /rules, which previews its own count.
    provenance: describeProvenance({
      source: (prediction?.source ?? null) as PredictionSource | null,
      hasPredictionRow: prediction !== null,
      txnConfidenceBps: t.confidenceBps ?? 0,
      userLabeled: prediction?.labeledAt != null,
      predictedCategoryId: prediction?.predictedCategoryId ?? null,
      currentCategoryId: t.categoryId ?? null,
    }),
    suggestion:
      userRules && tuning && meta && corrections
        ? suggestionForRow(t, { userRules, tuning, meta, corrections })
        : null,
    spendClass: classifySpendClass(
      {
        accountId: t.accountId,
        date: t.date,
        amountCents: t.amountCents,
        categoryId: t.categoryId,
        isTransfer: t.isTransfer,
        status: t.status,
        rawDescriptor: t.rawDescriptor,
        excludeFromTotals: t.excludeFromTotals,
        spendClassOverride: t.spendClassOverride,
        // C.16 (F7): the classifier MUST see the container flag. Before this
        // line, a split parent fell through to its override/guess here while
        // the block's reason chip said 'split-parent' — a live class control
        // an inch below copy saying the row is in no total, which is the F7
        // audit finding this slice closes. The register map needs no
        // equivalent: the register never loads containers, only pieces.
        isSplitParent: t.isSplitParent,
      },
      meta,
      fixedMerchants,
    ),
    // C.16 (F8): same basis as the register map above — override means the
    // reader (or their explicit rule) set this class, never a machine guess.
    spendClassReaderSet: t.spendClassOverride !== null,
  };

  // The refusals `splitTransaction` enforces, said in advance and in the reader's
  // words. Stated rather than hidden: a control that vanishes with no sentence is
  // indistinguishable from one we forgot to build.
  //
  // The first cut covered only the split CHILD while the docblock claimed it
  // covered them all (critic cycle 1, P2). The transfer case is not the action's
  // refusal but ours: `splitTransaction` would happily split a transfer, and the
  // two children would carry categories that no spending total ever reads,
  // because every one of them drops `isTransfer` rows first. A control that
  // produces nothing observable is worse than an absent one.
  // The sentences now live in engine/transactions/actions.ts (O.15), because the
  // action menu shows the SAME refusals — imported here so the split section and
  // the menu can never say different things about one row.
  const splitBlockedReason = t.isSplitParent
    ? null // the parent renders its pieces + undo instead
    : t.splitParentId !== null
      ? SPLIT_BLOCKED_CHILD
      : t.isTransfer
        ? SPLIT_BLOCKED_TRANSFER
        : reimbursementState(t.reimbursement) !== null
          ? SPLIT_BLOCKED_REIMBURSED // O.15 P1-2: a split erases the money-owed claim
          : Math.abs(t.amountCents) < 2
            ? SPLIT_BLOCKED_TOO_SMALL
            : null;

  return {
    row,
    isSplitParent: t.isSplitParent,
    parts: children.map((c) => ({
      id: c.id,
      amountCents: c.amountCents,
      categoryId: c.categoryId ?? 'uncategorized',
      categoryName: categoryLabel(c.categoryId, meta, c.category?.name),
    })),
    splitParentId: t.splitParentId,
    splitBlockedReason,
    // The ROW decides, not the account (critic cycle 2, F3) — reasoning and the
    // demo exception now live with the shared basis in engine/transactions/origin,
    // because O.15 slice 7 gave this fact a second consumer (the status control,
    // which may only offer a write on a row no feed will overwrite).
    descriptorOrigin: rowOrigin({ providerRef: t.providerRef, accountProvider: t.account.provider }),
    reimbursementMatch: await reimbursementMatchFor(userId, t),
    spendClassSiblingCount: await spendClassSiblingCountOf(userId, t, keepsReconciled),
  };
}

/**
 * #397: the "All N <payee>" count for the detail page's spend-class dial.
 * Counted on the bulk action's own where, then reconciliation-filtered —
 * the register's merchantCounts are built from the kept set, and a count
 * here that disagreed with the write would be the silent over-match this
 * page's rules exist to prevent.
 */
async function spendClassSiblingCountOf(
  userId: string,
  t: { merchantId: string | null; rawDescriptor: string; isSplitParent: boolean },
  keepsReconciled: (accountId: string, date: string) => boolean,
): Promise<number | null> {
  const aggregate = normalizeMerchant(t.rawDescriptor).aggregate;
  if (t.isSplitParent || t.merchantId === null || aggregate) return null;
  const siblings = await prisma.transaction.findMany({
    where: similarTransactionsWhere(
      userId,
      { merchantId: t.merchantId, rawDescriptor: t.rawDescriptor, aggregate },
      { onlyNeedsReview: false },
    ),
    select: { id: true, accountId: true, date: true },
  });
  return siblings.filter((s) => keepsReconciled(s.accountId, s.date)).length;
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

/** One active cross-provider reconciliation, enriched for the /accounts "combined accounts"
 *  disclosure + Undo (Wave 4.6 slice 5). The predecessor's balance is already zeroed by the
 *  boundary; this row is what the UI renders as the single logical account it became. */
export interface ReconciledPairView {
  /** AccountReconciliation.id — the Undo target. */
  id: string;
  cutoverDate: string; // YYYY-MM-DD
  predecessor: { id: string; name: string; mask: string | null; provider: string };
  successor: { id: string; name: string; mask: string | null; provider: string };
  /** U.15: would the app propose this pair TODAY? `unsupported` is the only actionable verdict —
   *  see `src/lib/engine/account/link-audit.ts` for what each one may and may not claim. */
  auditVerdict: LinkAuditVerdict;
  /** The reasons behind `auditVerdict`, already phrased for a reader. Facts, never conclusions. */
  auditEvidence: string[];
}

export interface AccountsView extends AccountsSummary {
  paymentAccountId: string | null;
  /** The business "today" for this user — the default + max for a reconciliation cutover date. */
  today: string; // YYYY-MM-DD
  /** Net worth over time (DECISIONS #40), oldest → newest, ending at today. */
  trend: NetWorthSeriesPoint[];
  /** Per-account billing for manual credit cards, keyed by account id. */
  cardBilling: Record<string, ManualCardBilling>;
  /** SimpleFIN bank-sync connection status (ROADMAP: cheaper Plaid alternative).
   *  `health` grades how recently the connection last synced (Gap 1 §3).
   *  `orphaned` (K.2b): non-null exactly when SimpleFIN accounts exist but the connection row
   *  does not — i.e. the connection was removed while the disconnect flow deliberately kept the
   *  data. The connect front door must then read as a RECONNECT with the accounts named, never
   *  as first-time setup; `lastDataAt` is the newest transaction date across those accounts
   *  (when updates stopped), null when none of them holds a row. */
  simplefin: {
    connected: boolean;
    lastSyncedAt: string | null;
    health: FreshnessResult;
    orphaned: { count: number; lastDataAt: string | null } | null;
    /** How far back the SimpleFIN feed's own history reaches (TASKS H.1(b)), on the identical
     *  rule the Plaid connection cards use. Without it /accounts answers "how far back does this
     *  go" for some connections and stays silent for others, with no rule a reader could infer —
     *  and on the owner's live corpus the silent half is the DEEPER one (25 accounts reaching
     *  2026-03-25, older than seven of the eight Plaid connections that print a date). */
    historyDepth: ConnectionDepth;
  };
  /** Plaid bank connections (#256) — one row per linked item, for the per-bank
   *  Disconnect control. Empty for users with no Plaid links. */
  plaid: {
    items: {
      itemId: string;
      institution: string | null;
      lastSyncedAt: string | null;
      /** The accounts under this connection (name + last-4), so two same-bank connections —
       *  e.g. a member's own Chase plus their spouse's Chase — are distinguishable on /accounts
       *  (owner-reported 2026-07-23: two identical "Plaid: Chase" rows couldn't be told apart). */
      accounts: { name: string; mask: string | null }[];
      /** How far back this connection's history actually reaches (TASKS H.1(b)) — computed
       *  through the app's OWN R1 keep rule, so the date can never contradict the register. */
      historyDepth: ConnectionDepth;
    }[];
  };
  /** What the currency guard withheld — drives the disclosure banner (#135 residual). */
  withheld: WithheldAccountSummary;
  /** Whether the Rename control may render (TASKS L.7). False for the shared demo user, whose
   *  rows every visitor sees: `renameAccount` refuses him server-side, and a control that is
   *  always refused — under copy reading "only you see this name" on a row nobody owns — is
   *  worse than no control. The fence stays on the server; this hides the door. */
  canRename: boolean;
  /** Suspected same-account-via-two-providers pairs (DECISIONS #192). Advisory only — the
   *  app has no cross-provider dedup, so these double-count until the user disconnects one.
   *  A pair with an ACTIVE reconciliation is suppressed here (R6) — it is resolved, not a warning. */
  duplicates: SuspectedDuplicatePair[];
  /** Active cross-provider reconciliations (Wave 4.6 slice 5). Each renders as one logical
   *  account with an inline disclosure + Undo; the predecessor is shown at $0.00 (its row is
   *  folded out of the asset/liability groups by the client, its balance counted on the successor). */
  reconciliations: ReconciledPairView[];
  /** Cross-provider "continue this account?" proposals (R3): exactly one live side, not yet linked.
   *  Empty unless a duplicate pair has one connected + one disconnected provider. */
  reconciliationCandidates: ReconciliationCandidateView[];
  /** Stale rows that matched MORE THAN ONE live account, so no proposal was offered (TASKS L.9).
   *  Rendered as a disclosure with no Confirm control: the app has concluded something — "it is
   *  one of these and we cannot tell which" — and rendering nothing would read as no conclusion. */
  reconciliationAmbiguities: AmbiguousReconciliationGroup[];
  /** BOTH-live duplicate connections at one bank (TASKS L.6 / L.10): two Plaid connections
   *  pulling the same proven account, which R3 can never propose because neither side is stale.
   *  The card offers to disconnect one and continue the account on the other. Empty for the
   *  ordinary one-connection-per-bank case. */
  combinableConnections: CombineConnectionsProposal[];
  /** Pairs that LOOK like duplicates to the reader but produced no offer, each with the reason.
   *  Rendering nothing when the app has CONCLUDED something is how the first version of this
   *  feature read as "nothing shipped" to the owner — an absence is not an answer. */
  uncombinableConnections: CombineBlockedView[];
}

/** A candidate enriched with the predecessor's full-history transaction span (slice 6): the
 *  confirm card's honest claim-span disclosure, the cutover DEFAULT (span end — the spec-§6
 *  "predecessor's last transaction" rule; `today` maximized the straddle window, critic
 *  A-F10/C-12) and the editable minimum (span start, so an early pick fails client-side
 *  instead of round-tripping to the server refusal, critic C-13). Null span = no rows. */
export type ReconciliationCandidateView = ReconciliationCandidate & {
  predecessorTxnSpan: { first: string; last: string } | null;
};

/** Every account, grouped into assets vs liabilities with net worth + trend. */
export async function getAccountsView(userId: string): Promise<AccountsView> {
  const [user, accounts, snapshots, statements, autopays, sfConn, plaidItems, newestByAccount, plaidFeedFloors, activeReconciliations, dismissedDupKeys, registerFloors] =
    await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { paymentAccountId: true } }),
    prisma.account.findMany({ where: { userId }, orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
    prisma.balanceSnapshot.findMany({
      // Windowed since U.4 — see `trendHistoryFloor`. Wider than anything the
      // page renders, so this bounds a payload that now grows monthly without
      // capping what a reader can see.
      where: { account: { userId }, date: { gte: trendHistoryFloor(businessToday(userId)) } },
      // `accountType` is the class the balance was READ under (U.6) — the trend
      // signs each row by it, never by what the account has since become.
      select: { accountId: true, date: true, balanceCents: true, accountType: true },
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
    prisma.plaidItem.findMany({
      where: { userId },
      // institutionId / lastSyncError / createdAt feed the L.10 combine planner — the same rows
      // this view already loads, so the card costs no extra query.
      select: {
        itemId: true,
        institution: true,
        institutionId: true,
        lastSyncedAt: true,
        lastSyncError: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    // Newest transaction date per account — the per-row freshness reference (Gap 1 §3
    // follow-up). One grouped query rather than N per-account reads. `_min` added in
    // slice 6: with `_max` it is each account's full-history span, which the confirm
    // card needs for the honest claim-span disclosure + the cutover default/min bounds.
    prisma.transaction.groupBy({ by: ['accountId'], where: { account: { userId } }, _min: { date: true }, _max: { date: true } }),
    // Each plaid account's oldest FEED-DELIVERED row — `providerRef` non-null, because manual
    // and CSV rows say nothing about how far a connection's own feed reaches, and the combine
    // ranking below must not let one backdated hand-typed row decide which connection an
    // irreversible revoke proposes to keep (H.6c critic P1, executed). Deliberately a separate
    // groupBy from the all-rows span above, whose per-row freshness/claim-span jobs need every
    // row.
    prisma.transaction.groupBy({
      by: ['accountId'],
      where: { account: { userId, provider: 'plaid' }, providerRef: { not: null } },
      _min: { date: true },
    }),
    getActiveReconciliations(userId),
    // Pairs the user has marked "not a duplicate" — filtered out of the advisory warning below.
    getDismissedDuplicateKeys(userId),
    // Each account's oldest row THE REGISTER WOULD LIST, for the per-connection history-depth
    // line (TASKS H.1(b)). Deliberately its own aggregate rather than a reuse of the all-rows
    // span above: that one feeds per-row freshness and the claim-span disclosure, which need
    // every row, while a depth line that counts rows /transactions refuses to show is a
    // /accounts date the register contradicts on the same screenload (critic F-1, executed).
    // `registerRowWhere` IS the register's own predicate — shared, not restated.
    prisma.transaction.groupBy({ by: ['accountId'], where: registerRowWhere(userId), _min: { date: true } }),
  ]);

  // Currency guard (DECISIONS #135): withhold non-USD accounts from the /accounts page so its
  // subtotals and net-worth trend match the dashboard headline, which excludes them (no FX).
  // Null-currency (demo / manual / legacy) is assumed USD → golden-safe no-op.
  const supported = accounts.filter((a) => isSupportedCurrency(a.currency));
  // Delete affordance (#253/#256): computed with the SAME predicate the delete
  // action enforces inside its transaction, so the UI never promises a delete
  // the guard would refuse (a guard must read what it guards).
  const deleteCtx = {
    simplefinConnected: sfConn !== null,
    plaidItemIds: plaidItems.map((i) => i.itemId),
  };
  const views: AccountView[] = supported.map((a) => ({
    id: a.id,
    // The label the reader sees (TASKS L.7). `feedName` below keeps the bank's own string
    // for the identity surfaces on this same page, which are asking a question about it.
    name: accountLabel(a),
    feedName: a.name,
    displayName: a.displayName,
    type: a.type,
    mask: a.mask,
    currentBalanceCents: a.currentBalanceCents,
    manual: a.provider === 'manual',
    provider: a.provider,
    deletable:
      (a.provider === 'simplefin' || a.provider === 'plaid') &&
      syncedDeleteBlockReason(
        { provider: a.provider, plaidItemId: a.plaidItemId, feedDroppedAt: a.feedDroppedAt },
        deleteCtx,
      ) === null,
    // The feed stopped carrying this row (TASKS L.14). Its balance still counts in every subtotal
    // on this page — that is the decision, not an oversight — so the row has to say so itself.
    feedDroppedAt: a.feedDroppedAt,
    // Whether the owning bank is STILL CONNECTED, which decides which remedy the note may name:
    // `PlaidUpdateButton` renders once per PlaidItem, so "reopen Add or fix accounts" is a real
    // instruction only while that item exists (critic F-4). Computed from the same `deleteCtx`
    // rows the delete affordance uses, so the note and the controls can never disagree.
    connectionLive:
      a.provider === 'simplefin'
        ? deleteCtx.simplefinConnected
        : a.provider === 'plaid' && a.plaidItemId !== null
          ? deleteCtx.plaidItemIds.includes(a.plaidItemId)
          : false,
    // Which bank feeds this row — the duplicate warning needs it to offer "Disconnect <bank>"
    // for a both-live pair, where deleting is (correctly) refused because the next sync would
    // just bring the row back.
    plaidItemId: a.provider === 'plaid' ? a.plaidItemId ?? null : null,
  }));
  // Sorted by the label the reader sees, not by the feed's name (TASKS L.7): the query
  // orders by `name`, so a renamed account would otherwise sit in the alphabetical slot of a
  // string no longer on screen. `id` breaks ties so the order stays deterministic.
  views.sort((x, y) => x.type.localeCompare(y.type) || x.name.localeCompare(y.name) || x.id.localeCompare(y.id));

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

  // Per-account connection freshness (Gap 1 §3 follow-up). The engine decides which
  // accounts get a result (SimpleFIN/Plaid feeds, non-INVESTMENT); manual/demo rows and
  // brokerages come back null and render no line. A linked account's CONNECTION sync floors
  // its reference date so a quiet-but-live feed doesn't false-alarm (health.ts mostRecentDate).
  // Assigned onto `views` BEFORE the reconciliation boundary so its copy-on-write predecessor
  // rows carry it.
  //
  // OWNER-REPORTED 2026-07-24: this floor was supplied for SimpleFIN ONLY — Plaid passed a
  // hardcoded null — so every Plaid account fell back to its newest TRANSACTION date. Accounts
  // that legitimately have no recent transactions (a mortgage, a loan, a quiet card) therefore
  // read "Not synced yet" / "Last synced 10 days ago" / "No new data in 15 days — you may need
  // to reconnect" while the connection row on the SAME page said it synced today. That is a
  // false claim about live data (the #277 class). Plaid now supplies its own item's
  // lastSyncedAt, matched by the account's plaidItemId.
  const newestTxnByAccount = new Map<string, string>();
  for (const g of newestByAccount) if (g._max.date) newestTxnByAccount.set(g.accountId, g._max.date);
  const sfLastSynced = sfConn?.lastSyncedAt ? isoDate(sfConn.lastSyncedAt) : null;
  // itemId → that bank's last SUCCESSFUL sync date (YYYY-MM-DD string column, like SimpleFIN's).
  const plaidSyncedByItem = new Map(
    plaidItems.map((i) => [i.itemId, i.lastSyncedAt ? isoDate(i.lastSyncedAt) : null] as const),
  );
  const freshnessById = perAccountFreshness(
    supported.map((a) => ({
      id: a.id,
      isLinkedFeed: a.provider === 'simplefin' || a.provider === 'plaid',
      type: a.type,
      newestTxnDate: newestTxnByAccount.has(a.id) ? isoDate(newestTxnByAccount.get(a.id)!) : null,
      connectionLastSyncedAt:
        a.provider === 'simplefin'
          ? sfLastSynced
          : // A row whose plaidItemId predates #256 (never re-synced) has no linkage yet and keeps
            // the transaction-date fallback; the next account sync stamps it and this self-heals.
            a.provider === 'plaid' && a.plaidItemId
            ? plaidSyncedByItem.get(a.plaidItemId) ?? null
            : null,
      // Overrides both reference dates above: the bank syncing today says nothing about an
      // account it has stopped sending (TASKS L.14).
      feedDroppedAt: a.feedDroppedAt ? isoDate(a.feedDroppedAt) : null,
      // PROVEN-removed only (K.2b): a SimpleFIN row with no connection row (the model is one
      // connection per user, so its absence is definitive for every simplefin account), or a
      // Plaid row whose stamped itemId matches no live item (removeItem stamps linkage before
      // deleting, so a dangling ref only arises via a delete path). `plaidItemId: null` is
      // UNKNOWN — pre-#256 rows keep the fallback path rather than being told their
      // connection is gone (the false direction; locked in accounts-freshness.test.ts).
      connectionRemoved:
        a.provider === 'simplefin'
          ? sfConn === null
          : a.provider === 'plaid' && a.plaidItemId != null
            ? !plaidSyncedByItem.has(a.plaidItemId)
            : false,
    })),
    today,
  );
  for (const v of views) v.freshness = freshnessById[v.id] ?? null;

  // Cross-provider reconciliation (Wave 4.6 slice 5). This is the LAST Prisma-direct per-account
  // money surface — the dashboard + assistant already read the boundary-adjusted snapshot — so
  // apply the SAME `applyReconciliationBoundary` engine here. /accounts can then never disagree
  // with the dashboard on a reconciled predecessor's balance, subtotal, or net-worth trend (F5).
  // Liveness is derived from the SAME `isAccountLive` the confirm action re-checks in-tx, so a
  // proposal and its guard can't disagree (docs/lessons/a-guard-must-read-what-it-guards).
  const conns = { simplefinConnected: sfConn !== null, plaidItemIds: new Set(plaidItems.map((i) => i.itemId)) };
  const activeLinks: ReconciliationLinkLike[] = activeReconciliations.map((r) => ({
    predecessorAccountId: r.predecessorAccountId,
    successorAccountId: r.successorAccountId,
    cutoverDate: r.cutoverDate,
  }));
  // The links that actually take effect (both sides present, same type, acyclic) — the SAME rule
  // the boundary zeroes on. A candidate for, or a duplicate warning about, an already-effective
  // pair is keyed off exactly this set, so display and money can never drift apart.
  const effective = effectiveReconciliationLinks(views, activeLinks);
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const reconciledPairKeys = new Set(effective.map((l) => pairKey(l.predecessorAccountId, l.successorAccountId)));

  // Candidates use RAW balances + the live-connection map (before any zeroing) so the #192 balance
  // signal still fires; already-reconciled pairs are dropped (resolved, not proposals). A predecessor
  // already in ANY effective link is dropped too (slice-6 critic C-8): offering "A → C" while A → B is
  // active would let one tap silently RE-TARGET a confirmed decision via the upsert slot — if the user
  // wants a different successor they undo first, explicitly.
  const effectivePredIds = new Set(effective.map((l) => l.predecessorAccountId));
  const spanByAccount = new Map(
    newestByAccount.flatMap((g) =>
      g._min.date != null && g._max.date != null ? [[g.accountId, { first: g._min.date, last: g._max.date }] as const] : [],
    ),
  );

  // ── Per-connection history depth (TASKS H.1(b)) ─────────────────────────────────────────
  // The R1 keep rule is WINDOWED, so an account's raw `_min.date` can be a row no register
  // shows and `spanByAccount` alone cannot answer this. Built from rows ALREADY IN HAND — the
  // shared engine closure over `views` + `activeLinks` + the spans `newestByAccount` already
  // carries — rather than `getReconciliationTxnKeep`, which would re-issue three queries this
  // function has already awaited AND re-read the links, so a confirm/undo landing between the
  // two reads could desync the closure from the account set it is meant to bound (critic F-4,
  // proven identical across 22 probes).
  const keepsReconciled = reconciliationTxnKeepFilter(
    views,
    activeLinks,
    [...spanByAccount].map(([accountId, s]) => ({ accountId, first: s.first, last: s.last })),
  );
  // Only accounts that appear in a link can lose anything (R8: with no effective link the
  // closure keeps everything), so the row scan is scoped to those — every other account's raw
  // floor IS its owned floor, already in hand at zero extra cost.
  const linkTouched = new Set(activeLinks.flatMap((l) => [l.predecessorAccountId, l.successorAccountId]));
  // The keep rule reads nothing but (accountId, date), so that is all this selects. `distinct`
  // is NOT a bound on what the database fetches — Prisma dedupes client-side and emits no
  // DISTINCT on either datasource (critic F-5 captured the SQL on SQLite and on Neon), so this
  // is row-sized and grows with history depth. It is skipped entirely when nothing is linked,
  // which is every user who has never combined two accounts.
  const linkedDates = linkTouched.size
    ? await prisma.transaction.findMany({
        where: { ...registerRowWhere(userId), accountId: { in: [...linkTouched] } },
        select: { accountId: true, date: true },
      })
    : [];
  const earliestOwnedLinked = new Map<string, string>();
  for (const r of linkedDates) {
    if (!keepsReconciled(r.accountId, r.date)) continue;
    // A MIN over the kept dates, deliberately not "the first row wins on an ORDER BY": the
    // dev/test datasource is SQLite and production is PostgreSQL (DECISIONS #35), and row
    // order is not a guarantee this surface should be resting a rendered date on.
    const best = earliestOwnedLinked.get(r.accountId);
    if (best === undefined || r.date < best) earliestOwnedLinked.set(r.accountId, r.date);
  }
  // Every floor below is register-visible by construction — both reads carry `registerRowWhere`.
  const registerFloorByAccount = new Map(
    registerFloors.flatMap((g) => (g._min.date != null ? [[g.accountId, g._min.date] as const] : [])),
  );
  const accountDepthFact = (a: { id: string; type: string; currency: string | null }): AccountDepthFact => ({
    // The account-level half of the register's basis. An account outside it holds rows the
    // register never lists, so it may neither supply a date nor make its connection look empty.
    inRegisterBasis: SPENDING_ACCOUNT_TYPES.includes(a.type) && isSupportedCurrency(a.currency),
    // Investment, loan and mortgage accounts never send transactions — there is no
    // `/investments/transactions` ingest in this app, and both providers say so in their own
    // words. Separates "nothing yet" from "nothing ever", which on the live corpus is the
    // difference between a true sentence and a promise that never resolves on FOUR of the
    // owner's thirteen connections (copy critic F1, measured).
    neverTransactional: !SPENDING_ACCOUNT_TYPES.includes(a.type),
    earliestOwned: linkTouched.has(a.id)
      ? earliestOwnedLinked.get(a.id) ?? null
      : registerFloorByAccount.get(a.id) ?? null,
    holdsRows: registerFloorByAccount.has(a.id),
  });
  // An account's institution lives on its CONNECTION row, so the identity ladder (L.10) reads it
  // through the item map. Supplied for every row; the ladder itself refuses cross-provider and
  // abstains where the institution is unknown, so a non-Plaid row simply never proves anything.
  const itemById = new Map(plaidItems.map((i) => [i.itemId, i]));
  const identityOf = (a: (typeof accounts)[number]) => {
    const item = a.plaidItemId ? itemById.get(a.plaidItemId) : undefined;
    return {
      provider: a.provider,
      // The live connection is authoritative; the row's own stamp is the last-known value for
      // a row whose connection has been disconnected (and deleted) — see plaid.ts removeItem.
      institutionId: item?.institutionId ?? a.institutionId ?? null,
      institutionName: item?.institution ?? a.institutionName ?? null,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      currency: a.currency,
      persistentAccountId: a.persistentAccountId,
      connectionId: a.plaidItemId ?? null,
    };
  };
  // TASKS L.7. The three views below ask an identity question ("are these the same account?").
  // They print the name the USER chose — otherwise he cannot match the sentence to a row on
  // this page — and they identify the account by the provider + last-4 they already carry,
  // which is the evidence the question actually rests on. An earlier version appended the
  // bank's own name to each label; it stacked two parentheticals inside prompts and aria
  // labels ("Delete X (your bank calls this Y) (Plaid ····0977)?") and asserted a bank for
  // MANUAL rows, which have none (critic F5). The bank's string is disclosed once, on the
  // account row itself. Applied AFTER detection: every comparison above compares feed names.
  const labelById = new Map(supported.map((a) => [a.id, accountLabel(a)]));
  const displayLabel = (id: string, fallback: string) => labelById.get(id) ?? fallback;
  // L.9: whether the painted name is the USER'S nickname (display rules that repair bank
  // formatting must not edit it — critic P2-3).
  const userNamedById = new Map(supported.map((a) => [a.id, a.displayName != null]));

  const detected = detectReconciliationCandidates(
    supported.map((a) => ({
      id: a.id,
      provider: a.provider,
      name: a.name,
      type: a.type,
      mask: a.mask,
      currentBalanceCents: a.currentBalanceCents,
      currency: a.currency,
      // L.9: the registration veto reads the provider's own subtype where there is one, so a
      // Plaid Roth can never be proposed against a Plaid Traditional even if both names are bare.
      subtype: a.subtype,
      plaidItemId: a.plaidItemId, // C-10: two items' rows for the same bank are eligible pairs
      hasLiveConnection: isAccountLive({ provider: a.provider, plaidItemId: a.plaidItemId }, conns),
      // L.10: lets a SAME-provider pair (two connections at one bank, one now disconnected) be
      // proposed on proven identity — the state a half-finished combine leaves behind.
      identity: identityOf(a),
    })),
    {
      // Passed INTO the engine (TASKS L.9) rather than filtered out here, because the engine's
      // one-predecessor-many-successors rule has to see the set that will actually render:
      // dismissing the wrong pair is precisely how the user resolves an ambiguity, and a
      // post-filter would leave the survivor withheld forever.
      excludePair: (predecessorId, successorId) =>
        reconciledPairKeys.has(pairKey(predecessorId, successorId)) ||
        effectivePredIds.has(predecessorId) ||
        // …and the SUCCESSOR role too (critic P1, executed): an effective predecessor is zeroed,
        // folded and client-filtered off the account list, so it is never a continuation target —
        // its terminal successor is. Without this, a folded row that came back LIVE (its provider
        // reconnected) could be named inside an ambiguity group as "one of your live accounts" —
        // a row that is not on screen — and dismissing the rival would release a candidate whose
        // confirm auto-undoes the user's earlier combine.
        effectivePredIds.has(successorId) ||
        // A pair the user dismissed as "not a duplicate" must not re-surface as a combine
        // candidate once one side goes non-live — the candidate card is "the actionable version
        // of the same message", so an explicit "these are different" judgment binds BOTH surfaces
        // (dup-veto critic DUP-DISMISS-1). Same key + sort as the duplicates-warning filter.
        dismissedDupKeys.has(duplicatePairDismissKey(predecessorId, successorId)),
    },
  );
  const reconciliationCandidates: ReconciliationCandidateView[] = detected.candidates.map((c) => ({
    ...c,
    predecessor: {
      ...c.predecessor,
      name: displayLabel(c.predecessor.id, c.predecessor.name),
      userNamed: userNamedById.get(c.predecessor.id) === true,
    },
    successor: {
      ...c.successor,
      name: displayLabel(c.successor.id, c.successor.name),
      userNamed: userNamedById.get(c.successor.id) === true,
    },
    predecessorTxnSpan: spanByAccount.get(c.predecessor.id) ?? null,
  }));
  // Within a confidence rank, order by the PAINTED names (the F8 rule): the engine sorted by the
  // feed's strings, which a rename leaves behind.
  const confidenceRank: Record<string, number> = { high: 0, medium: 1 };
  reconciliationCandidates.sort(
    (p, q) =>
      (confidenceRank[p.confidence] ?? 1) - (confidenceRank[q.confidence] ?? 1) ||
      p.successor.name.localeCompare(q.successor.name) ||
      p.predecessor.name.localeCompare(q.predecessor.name) ||
      p.successor.id.localeCompare(q.successor.id),
  );
  const candidatePairKeys = new Set(reconciliationCandidates.map((c) => pairKey(c.predecessor.id, c.successor.id)));

  // Both-live duplicate connections (TASKS L.6 / L.10). Suppressed for a pair the user has
  // already judged — an explicit "not a duplicate" dismissal binds this surface exactly as it
  // binds the warning and the candidate card, and an already-reconciled pair is resolved rather
  // than offered again. Only the currency-supported rows take part, so the offer can never name
  // an account the page is withholding.
  // Each plaid account's oldest FEED-delivered row — the depth evidence `keepRank` ranks on
  // (TASKS H.6c), so the prominent Combine button proposes keeping the connection whose own feed
  // reaches further back (the deepen flow's whole point).
  const earliestTxnByAccount = new Map(
    plaidFeedFloors.flatMap((g) => (g._min.date != null ? [[g.accountId, g._min.date] as const] : [])),
  );
  const combinableConnections: CombineConnectionsProposal[] = suppressCombineProposals(
    combinableConnectionsFor(userId, plaidItems, accounts, earliestTxnByAccount),
    {
      supportedAccountIds: new Set(supported.map((a) => a.id)),
      dismissedPairKeys: dismissedDupKeys,
      reconciledPairKeys,
      linkedPredecessorIds: effectivePredIds,
    },
  );
  const uncombinableConnections = uncombinableConnectionsFor(userId, plaidItems, accounts, earliestTxnByAccount, {
    offeredItemPairKeys: new Set(
      combinableConnections.map((p) => combinePairKey(p.recommended.keepItemId, p.recommended.dropItemId)),
    ),
    dismissedPairKeys: dismissedDupKeys,
    reconciledPairKeys,
  });

  // A pair with a combine OFFER must not also raise the advisory warning: the offer is the
  // actionable version of the same message, and #192's card would tell the same user to
  // "disconnect one side" while the card above already does exactly that in one tap.
  const combinablePairKeys = new Set(
    combinableConnections.flatMap((proposal) =>
      [proposal.recommended, proposal.alternative].flatMap((d) =>
        d === null ? [] : d.pairs.map((p) => pairKey(p.predecessorAccountId, p.successorAccountId)),
      ),
    ),
  );

  // The money boundary: predecessor balance → 0, colliding predecessor snapshots dropped. Fed the
  // SAME accounts + snapshots + links as the dashboard's snapshot assembly, with the row types
  // /accounts doesn't render (txns/statements/scheduled) empty — the account + snapshot outputs
  // depend only on accounts+snapshots+links, so the balances and trend match the dashboard exactly.
  const boundary = applyReconciliationBoundary({
    paymentAccountId: user?.paymentAccountId ?? null,
    accounts: views,
    transactions: [],
    balanceSnapshots: snapshots,
    statements: [],
    scheduled: [],
    links: activeLinks,
  });
  const adjustedViews = boundary.accounts;
  const trend = netWorthSeries({ snapshots: boundary.balanceSnapshots, accounts: adjustedViews, today });

  // Enrich each effective link for the "combined accounts" disclosure + Undo (names/masks from the
  // RAW rows, so the predecessor still reads by its own name). Ineffective links (deleted/withheld
  // side) render nothing — the predecessor then counts normally, exactly as R7 requires.
  const acctById = new Map(accounts.map((a) => [a.id, a]));
  const idByPredecessor = new Map(activeReconciliations.map((r) => [r.predecessorAccountId, r.id]));

  // U.15: re-audit every confirmed link against TODAY's rules. Nothing re-examined one of these
  // rows after it was written, so a pair the detector has since learned to refuse kept being
  // honoured — measured on real data at nine wrong links, four of which the shipped detector
  // would already refuse to propose (docs/lessons/prevention-is-not-a-remedy.md).
  //
  // Fed the FEED's `name`, exactly as the duplicate detector below is (the audit reads account
  // numbers out of that string, and a user's nickname need not carry them) — and over `supported`,
  // the same currency-filtered set, so the audit and the boundary agree about which links are inert.
  const auditByLinkId = new Map(
    auditConfirmedLinks(
      supported.map((a) => ({
        id: a.id,
        provider: a.provider,
        name: a.name,
        type: a.type,
        mask: a.mask,
        currentBalanceCents: a.currentBalanceCents,
        currency: a.currency,
        subtype: a.subtype,
        plaidItemId: a.plaidItemId,
      })),
      activeReconciliations,
    ).map((r) => [r.link.id, r]),
  );

  const reconciliations: ReconciledPairView[] = effective.flatMap((l) => {
    const p = acctById.get(l.predecessorAccountId);
    const s = acctById.get(l.successorAccountId);
    const id = idByPredecessor.get(l.predecessorAccountId);
    if (!p || !s || id === undefined) return [];
    const audited = auditByLinkId.get(id);
    return [
      {
        id,
        cutoverDate: l.cutoverDate,
        predecessor: { id: p.id, name: accountLabel(p), mask: p.mask, provider: p.provider },
        successor: { id: s.id, name: accountLabel(s), mask: s.mask, provider: s.provider },
        auditVerdict: audited?.verdict ?? 'not-checkable',
        auditEvidence: audited?.evidence ?? [],
      },
    ];
  });

  // Advisory duplicate warning. Suppressed for a pair that is already reconciled (R6 — resolved,
  // not a warning) OR that has a live continue-candidate (the candidate card is the actionable
  // version of the same message; showing both would double-message one pair). A both-live genuine
  // duplicate has no candidate and still warns. Undoing a link brings its pair back here next load.
  const duplicatesList = detectDuplicateAccounts(
    supported.map((a) => ({
      id: a.id,
      provider: a.provider,
      name: a.name,
      type: a.type,
      mask: a.mask,
      currentBalanceCents: a.currentBalanceCents,
      currency: a.currency,
      subtype: a.subtype, // L.9: a Roth and a Traditional are never one account, so never warn
      plaidItemId: a.plaidItemId, // C-10: same-bank-relinked (two items) both-live pairs warn
    })),
  ).map((d) => ({
    ...d,
    a: { ...d.a, name: displayLabel(d.a.id, d.a.name) },
    b: { ...d.b, name: displayLabel(d.b.id, d.b.name) },
  })).sort(
    // Re-sorted on the PAINTED name (critic F8): the detector orders pairs by the feed's
    // string, so once a rename makes the two diverge the list order stops matching the list.
    (p, q) => p.a.name.localeCompare(q.a.name) || p.b.name.localeCompare(q.b.name) || p.a.id.localeCompare(q.a.id),
  ).filter((d) => {
    const k = pairKey(d.a.id, d.b.id);
    // A pair involving an EFFECTIVE predecessor never warns (slice-6, with C-8): that row is
    // zeroed and folded, so it cannot double-count with anyone — a warning about it would be
    // noise about an already-resolved account (undo restores it, and then the warning too).
    return (
      !reconciledPairKeys.has(k) &&
      !candidatePairKeys.has(k) &&
      !combinablePairKeys.has(k) &&
      !effectivePredIds.has(d.a.id) &&
      !effectivePredIds.has(d.b.id) &&
      // …and not a pair the user has explicitly dismissed as "not a duplicate" (owner-reported:
      // the warning had no cancel). Order-independent key, same sort as pairKey.
      !dismissedDupKeys.has(duplicatePairDismissKey(d.a.id, d.b.id))
    );
  });

  // L.9 ambiguity groups, mapped to view models. Every pair in a RENDERED group is on the
  // duplicate notice above by construction — every notice filter is mirrored in the engine's
  // excludePair (a dismissed/reconciled/folded pair never reaches a group), and an
  // identity-proven pair (which fires no heuristic signal and so has no notice) is hoisted OUT
  // of groups as an offer — so the card's how-to may name the notice's "Not a duplicate"
  // control without per-pair membership plumbing (cycle-2 critic P2-5 verified the invariant
  // unreachable to break; it is locked in reconcile-surfaces.test.ts).
  const reconciliationAmbiguities: AmbiguousReconciliationGroup[] = detected.ambiguous
    .map((g) => ({
      predecessor: {
        ...g.predecessor,
        name: displayLabel(g.predecessor.id, g.predecessor.name),
        userNamed: userNamedById.get(g.predecessor.id) === true,
      },
      successors: g.successors
        .map((s) => ({
          ...s,
          name: displayLabel(s.id, s.name),
          userNamed: userNamedById.get(s.id) === true,
        }))
        // Painted-name order (the F8 rule, applied to the card whose job is telling accounts
        // apart): the engine sorted by the FEED's string.
        .sort((x, y) => x.name.localeCompare(y.name) || x.id.localeCompare(y.id)),
    }))
    // …and the groups themselves order by the predecessor's painted name (cycle-2 critic P2-6).
    .sort((p, q) => p.predecessor.name.localeCompare(q.predecessor.name) || p.predecessor.id.localeCompare(q.predecessor.id));

  return {
    ...groupAccounts(adjustedViews),
    // The boundary-remapped id (slice-6 critic A-F7): if the designated funding account is a
    // superseded predecessor, every money engine funds from its successor — returning the raw
    // stored id here would badge the zeroed $0.00 row as "payment account" while cash-needed
    // funds from the successor, a cross-surface contradiction on the same screen.
    paymentAccountId: boundary.paymentAccountId,
    today,
    trend,
    cardBilling,
    simplefin: {
      connected: sfConn !== null,
      lastSyncedAt: sfConn?.lastSyncedAt ?? null,
      health: classifyFreshness(sfConn?.lastSyncedAt ? isoDate(sfConn.lastSyncedAt) : null, today),
      // Every simplefin account: the connection is one-per-user (`SimpleFinConnection.userId` is
      // unique), so provider IS the linkage here — there is no per-item id to group by.
      historyDepth: connectionHistoryDepth(accounts.filter((a) => a.provider === 'simplefin').map(accountDepthFact)),
      // K.2b: rows that came through a connection that no longer exists, counted over ALL
      // simplefin accounts (a currency-withheld row's connection is just as gone; the notice
      // copy claims "stopped updating", never on-page visibility — sabotage-e-locked in
      // accounts-freshness.test.ts) MINUS active superseded predecessors (critic P1-2: a
      // reconciled-away row is frozen by design — the product's own migration flow ends here,
      // and a user who migrated on purpose must not get a permanent reconnect nag; same
      // exclusion every frozen-disclosure surface applies, K.1 P0-1 precedent).
      // All-superseded ⇒ null ⇒ the plain first-time door.
      orphaned: (() => {
        if (sfConn !== null) return null;
        const sfAccounts = accounts.filter(
          (a) => a.provider === 'simplefin' && !effectivePredIds.has(a.id),
        );
        if (sfAccounts.length === 0) return null;
        let lastDataAt: string | null = null;
        for (const a of sfAccounts) {
          const d = newestTxnByAccount.get(a.id);
          if (d && (lastDataAt === null || d > lastDataAt)) lastDataAt = d;
        }
        return { count: sfAccounts.length, lastDataAt: lastDataAt ? isoDate(lastDataAt) : null };
      })(),
    },
    plaid: {
      // Attach each connection's accounts (name + last-4) so two same-bank connections are
      // distinguishable. `accounts` carries every row; only this item's Plaid accounts have a
      // matching plaidItemId, so the filter naturally selects them.
      // Explicit field list, not a spread: this row crosses to the client, and the columns the
      // combine planner needs (institutionId, lastSyncError, createdAt) are server-side inputs,
      // not things the connection list renders.
      items: plaidItems.map((item) => ({
        itemId: item.itemId,
        institution: item.institution,
        lastSyncedAt: item.lastSyncedAt,
        accounts: accounts
          .filter((a) => a.plaidItemId === item.itemId)
          .map((a) => ({ name: accountLabel(a), mask: a.mask })),
        // Over the SAME accounts this card names one line above — the engine, not the caller,
        // decides which of them may set a date (a withheld or non-spending account is passed in
        // and excluded there). Feeding it a pre-filtered list instead would make a connection
        // whose accounts are all outside the register indistinguishable from one with no
        // accounts at all, and those are different sentences.
        historyDepth: connectionHistoryDepth(
          accounts.filter((a) => a.plaidItemId === item.itemId).map(accountDepthFact),
        ),
      })),
    },
    // The unfiltered rows are already in hand, so the disclosure costs no extra query.
    withheld: summarizeWithheldAccounts(accounts),
    canRename: !isDemoUser(userId),
    duplicates: duplicatesList,
    reconciliations,
    reconciliationCandidates,
    reconciliationAmbiguities,
    combinableConnections,
    uncombinableConnections,
  };
}

/**
 * What the currency guard is withholding for this user — the dashboard's disclosure input
 * (#135 residual: a non-USD account must not vanish silently from the headline figures).
 * The where-clause is the exact DB complement of the guard's
 * `OR: [{ currency: null }, { currency: 'USD' }]` predicate, and the pure summarizer
 * re-applies `isSupportedCurrency`, so the disclosure can never disagree with the withhold.
 */
/**
 * What the in-place detail panel on /accounts renders for ONE account (the
 * mortgage dead-end slice, owner 2026-08-11): the account types the register
 * excludes by construction (`accountRowDestination` → 'detail') open here
 * instead of a structurally-empty /transactions.
 *
 * Loaded only when a panel is OPEN (`/accounts?detail=<id>`). The cost this
 * avoids is the CLIENT payload — serializing every account's history into the
 * page to render none of it, the exact dead weight O.20b measured on
 * /dashboard. (The DB cost is not the argument: `getAccountsView` on the same
 * request already reads every snapshot for the trend — U.3 critic, #11.)
 *
 * `history` is the same BalanceSnapshot store the page's net-worth trend is
 * drawn from. Since U.4 a live account accrues one row per calendar month, so
 * this panel is no longer empty for real users — and two consequences of that
 * are load-bearing:
 *
 *  - WHICH ROWS THE TREND COUNTS is decided here by the SAME
 *    `applyReconciliationBoundary` the trend runs (TASKS U.5), never by a
 *    second rule written for this panel: the boundary keeps one side of a
 *    same-dated collision between combined accounts, and a row it drops is
 *    still SHOWN (it was genuinely read for this account) carrying
 *    `countsInNetWorth: false`. Dropping it instead would delete a true
 *    observation; printing it unmarked is what U.5 filed — the panel's
 *    per-row "counted as" marker and its notes are COUNTING claims, and they
 *    were false for exactly these rows.
 *  - The boundary's inputs mirror the trend's: non-USD accounts withheld
 *    (#135) so a link whose side the trend never sees stays inert here too
 *    (R7), and the collision scan is deliberately UNWINDOWED — this panel
 *    renders the full history, and a row evaluated without its counterpart in
 *    the input would be marked counted when it is not.
 *  - A row outside the trend's 19-month render window is still COUNTED. That
 *    window bounds a payload (U.4), it is not a counting rule, and marking
 *    those rows would assert a second, false thing.
 *  - A row is what the app HELD on that date, which for an account whose feed
 *    has gone quiet is a value it last actually read before `feedDroppedAt`.
 *    That is why `feedDroppedAt` travels with the history: the panel marks the
 *    carried-forward rows instead of printing them as observations.
 *
 * Scoped to `userId` IN THE QUERY — a stale or foreign id resolves to null,
 * never to another user's balances.
 */
export interface AccountDetailView {
  id: string;
  /** Recorded balances, oldest first, each carrying the CLASS it was read under
   *  (U.6) — the panel signs a row by its own `accountType`, not by what the
   *  account is today, because both providers rewrite `Account.type` on every
   *  ordinary sync. `accountType: null` is a row written before that column
   *  existed; those alone fall back to the account's current class.
   *
   *  `countsInNetWorth` is the reconciliation boundary's own verdict on the row
   *  (U.5), REQUIRED so a future reader must answer it rather than inherit a
   *  default — the U.6 lesson about an optional field a `select` can silently
   *  drop. False means: this balance was read for this account, and your net
   *  worth counts the combined account's balance for that date instead.
   *
   *  `countedInstead` is THAT balance, carried per row rather than summarised
   *  for the panel, because each dropped date has its own counterpart figure —
   *  two combined records disagree, which is why one has to win.
   *  Null on a counted row, and null whenever the date's owner is not this
   *  account's DIRECT counterpart: the row then states only what is certain
   *  rather than naming a wrong account. That covers a chain (the owner is two
   *  links up) and, since U.9, a SIBLING — a second stale row continued onto the
   *  same live account, which displaces this one while being no counterpart of
   *  it. The set of unnamed-but-uncounted rows is therefore wider than when this
   *  was written; the panel's note explains the class, and the row itself never
   *  guesses. */
  history: {
    date: string;
    balanceCents: number;
    accountType: string | null;
    countsInNetWorth: boolean;
    countedInstead: CountedInsteadOf | null;
  }[];
  /** Loan facts, when the feed supplied them (the demo Auto Loan carries all
   *  three; a synced account may carry none). Absent facts render nothing. */
  aprBps: number | null;
  minimumPaymentCents: number | null;
  dueDayOfMonth: number | null;
  /** YYYY-MM-DD the feed stopped returning this account, or null. Rows dated
   *  after it repeat the last balance the bank actually sent — see the docblock. */
  feedDroppedAt: string | null;
}

export async function getAccountDetail(userId: string, accountId: string): Promise<AccountDetailView | null> {
  const account = await prisma.account.findFirst({
    where: { id: accountId, userId },
    select: { id: true, aprBps: true, minimumPaymentCents: true, dueDayOfMonth: true, feedDroppedAt: true },
  });
  if (!account) return null;
  const [history, accounts, links] = await Promise.all([
    prisma.balanceSnapshot.findMany({
      where: { accountId: account.id },
      orderBy: { date: 'asc' },
      select: { date: true, balanceCents: true, accountType: true },
    }),
    // The boundary's account set, built to the SAME rule the trend's is (#135
    // currency withhold): a link whose side the trend never sees is inert (R7),
    // so including a withheld account here would mark rows uncounted that the
    // trend counts. `currentBalanceCents` is required by the input type and
    // unread by the snapshot rule — the collision verdict depends only on
    // accounts + snapshots + links (the #274 precedent for feeding this engine
    // the rows a surface has and empty arrays for the rest).
    prisma.account.findMany({
      where: { userId },
      select: { id: true, name: true, displayName: true, type: true, currency: true, currentBalanceCents: true },
    }),
    getActiveReconciliations(userId),
  ]);

  const supported = accounts.filter((a) => isSupportedCurrency(a.currency));
  const activeLinks: ReconciliationLinkLike[] = links.map((r) => ({
    predecessorAccountId: r.predecessorAccountId,
    successorAccountId: r.successorAccountId,
    cutoverDate: r.cutoverDate,
  }));
  // Nothing effective → every row counts, and no query beyond the ones above
  // ever runs. This is the ONLY shape the demo can reach (the seed writes no
  // reconciliations), so the golden panel is byte-identical by construction.
  const effective = effectiveReconciliationLinks(supported, activeLinks);
  // An account the currency guard withholds (#135) is in NO net-worth figure at
  // all — `getAccountsView` builds its rows from `supported` only, so this page
  // has no row to hang the panel on and never renders one. There is therefore no
  // honest value for `countsInNetWorth` here: `true` claims a counting that
  // never happens, and `false` would be explained by a combine note about a
  // combine that never happened (both states were shipped and both were caught
  // by the U.5 money critic). The view describes accounts this page counts; for
  // one it does not, the answer is the same null a stale or foreign id gets.
  if (!supported.some((a) => a.id === account.id)) return null;
  // THIS account's direct counterparts — who may be NAMED on a dropped row.
  // (Which rows are dropped is decided over the whole chain below; only the
  // naming is restricted to a direct counterpart, so a chain never attributes a
  // balance to the wrong account.)
  const counterpartIds = new Set(
    effective.flatMap((l) =>
      l.predecessorAccountId === account.id
        ? [l.successorAccountId]
        : l.successorAccountId === account.id
          ? [l.predecessorAccountId]
          : [],
    ),
  );

  let countedDates: ReadonlySet<string> | null = null;
  const keptCounterpartAt = new Map<string, { accountId: string; balanceCents: number; accountType: string | null }[]>();
  if (effective.length > 0) {
    // Scoped to this account and EVERY account in an effective link — not just
    // this one's direct counterparts. `keepsSnapshot` decides a date over the whole
    // supersession COMPONENT (U.9), so the row that displaces one of this account's
    // can belong to an account it never links to directly: in a chain A→B→C a row of
    // C's can be dropped in favour of A's, and two stale rows continued onto ONE live
    // account displace each other while being neither's counterpart. A
    // direct-counterparts-only input hides those accounts and silently returns the
    // wrong verdict AND the wrong counterpart figure (found by the U.5 money critic,
    // reproduced on a 3-link chain). Every component member appears in some link by
    // construction, so this set is exactly the one the boundary consults — the same
    // `linkedIds` it builds internally.
    //
    // UNWINDOWED, deliberately: the trend's 19-month floor is a payload bound on
    // what it RENDERS, but evaluating an old row with its counterpart missing
    // from the input would mark it counted when it is not.
    const linkedIds = new Set(effective.flatMap((l) => [l.predecessorAccountId, l.successorAccountId]));
    const chainIds = [...new Set([account.id, ...linkedIds])];
    const chainRows = await prisma.balanceSnapshot.findMany({
      where: { accountId: { in: chainIds }, account: { userId } },
      select: { accountId: true, date: true, balanceCents: true, accountType: true },
    });
    const kept = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: supported,
      transactions: [],
      balanceSnapshots: chainRows,
      statements: [],
      scheduled: [],
      links: activeLinks,
    }).balanceSnapshots;
    countedDates = new Set(kept.filter((b) => b.accountId === account.id).map((b) => b.date));
    for (const b of kept) {
      if (b.accountId === account.id || !counterpartIds.has(b.accountId)) continue;
      keptCounterpartAt.set(b.date, [...(keptCounterpartAt.get(b.date) ?? []), b]);
    }
  }

  const byId = new Map(supported.map((a) => [a.id, a]));
  const rows = history.map((h) => {
    const counts = countedDates?.has(h.date) ?? true;
    // Read off the boundary's OUTPUT (the rows it KEPT), never re-derived from
    // the collision rule. Exactly one surviving counterpart names itself; a date
    // owned by something further up a chain leaves the row unnamed rather than
    // attributing the balance to the wrong account.
    const winners = counts ? [] : (keptCounterpartAt.get(h.date) ?? []);
    const win = winners.length === 1 ? winners[0] : undefined;
    const winAcct = win === undefined ? undefined : byId.get(win.accountId);
    return {
      ...h,
      countsInNetWorth: counts,
      countedInstead:
        win === undefined || winAcct === undefined
          ? null
          : {
              name: accountLabel(winAcct),
              balanceCents: win.balanceCents,
              // The U.6 rule, applied to the counterpart's row: the class it was
              // READ under decides its sign, falling back to the account's
              // current class only for a row written before that column existed.
              isLiability: isLiabilityType(
                win.accountType === null || win.accountType === '' ? winAcct.type : win.accountType,
              ),
            },
    };
  });

  return {
    id: account.id,
    history: rows,
    aprBps: account.aprBps,
    minimumPaymentCents: account.minimumPaymentCents,
    dueDayOfMonth: account.dueDayOfMonth,
    feedDroppedAt: account.feedDroppedAt,
  };
}

export async function getWithheldAccountSummary(userId: string): Promise<WithheldAccountSummary> {
  const rows = await prisma.account.findMany({
    where: { userId, NOT: { OR: [{ currency: null }, { currency: 'USD' }] } },
    select: { currency: true },
  });
  return summarizeWithheldAccounts(rows);
}

/**
 * What the currency guard withholds from the REGISTER'S basis — the disclosure input for the
 * transactions CSV (U.23), which exports that basis and nothing else.
 *
 * Scoped, not the page-level summary above: a set carries the scope it was built for. The
 * dashboard's summary counts every non-USD account the user has, including a euro brokerage —
 * and a brokerage row is not in this file for a reason that has nothing to do with currency
 * (#62), so announcing it as withheld FROM THIS FILE would be false. That is the same defect
 * U.16's second critic cycle found on the panels and the reason the export route reads the
 * account-scoped handover keys rather than the unscoped dates.
 *
 * Built as the literal COMPLEMENT of `registerAccountWhere`'s own currency clause — the guard
 * expression is destructured out and negated, never retyped — so a change to what the register
 * accepts moves the withhold and its disclosure in one step. `#141` made non-disagreement the
 * design rule for this pair; here it is structural.
 *
 * Only accounts that actually HAVE an exportable row count: a euro account with no transactions
 * costs the file nothing, and a note claiming rows are missing when none exist is the same
 * false alarm in the other direction. That rule used to be stated here as "the U.19 rule — a
 * reader with nothing withheld gets a byte-identical file"; U.25 retired the byte identity
 * (every file now carries an unconditional basis note), and what survives is the part that was
 * always the point: a disclosure fires on the fact it describes, never on the mere existence of
 * the rule that could produce it.
 */
export async function getWithheldRegisterAccountSummary(
  userId: string,
): Promise<WithheldAccountSummary> {
  const { OR: currencyGuard, ...basis } = registerAccountWhere(userId);
  const rows = await prisma.account.findMany({
    // `basis` goes in WHOLE, as one AND member, rather than spread beside sibling keys. Spread
    // into the same literal, any key it later gains that this clause also names — a `NOT`, an
    // `AND` — would be silently overridden by the one written here, and TypeScript permits a
    // later property to shadow a spread without a word. The register would then narrow while
    // this set did not, and the note would start naming accounts the file never could have
    // carried. Removing or renaming `OR` is already caught: the destructure above stops
    // compiling.
    where: {
      AND: [
        basis,
        { NOT: { OR: currencyGuard } },
        { transactions: { some: { isSplitParent: false } } },
      ],
    },
    select: { currency: true },
  });
  return summarizeWithheldAccounts(rows);
}

/**
 * Accounts whose bank has STOPPED sharing them (TASKS L.14) — the dashboard's disclosure input.
 *
 * The mirror image of the currency guard above: those rows are withheld from the figures and the
 * banner says so; these are still IN the figures with a frozen balance, and the banner says that.
 * Both exist for the same reason — a number the reader is about to act on may not mean what it
 * appears to mean, and the app is the only party that knows.
 *
 * TWO exclusions, both of them the SAME rule: a row this notice announces as counted must actually
 * be counted, or the disclosure becomes the very thing it exists to prevent.
 *
 *  · Currency-guarded like the page is, so an account withheld from every total by DECISIONS #135
 *    is not then announced as counted in it.
 *  · Reconciliation-guarded (critic P0-1, executed repro): once a frozen row is superseded by its
 *    live successor, `applyReconciliationBoundary` zeroes its balance and /accounts folds it into
 *    "Combined accounts", so it contributes $0 and is not on the page. Reading raw rows here made
 *    the banner quote a real four-figure balance as "still counted" and send the reader to a page
 *    where the row does not appear. That pairing is not exotic — it is the journey this very
 *    disclosure provokes: the row freezes, the user re-adds the bank, disconnects the old
 *    connection, and accepts "Continue this account". Superseded rows already have their own
 *    disclosure in the combine flow.
 */
export async function getFeedDroppedAccounts(userId: string): Promise<DroppedAccountInput[]> {
  const [rows, supersededIds] = await Promise.all([
    prisma.account.findMany({
      where: {
        userId,
        NOT: { feedDroppedAt: null },
        OR: [{ currency: null }, { currency: 'USD' }],
      },
      orderBy: [{ feedDroppedAt: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, mask: true, type: true, feedDroppedAt: true, currentBalanceCents: true },
    }),
    activeSupersededPredecessorIds([userId]),
  ]);
  const superseded = new Set(supersededIds);
  return rows.flatMap((r) =>
    r.feedDroppedAt && !superseded.has(r.id)
      ? [{ ...r, feedDroppedAt: isoDate(r.feedDroppedAt) }]
      : [],
  );
}
