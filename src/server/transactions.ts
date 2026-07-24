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
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { type NetWorthSeriesPoint, netWorthSeries } from '@/lib/engine/networth/series';
import {
  type ReconciliationCandidate,
  type SuspectedDuplicatePair,
  detectDuplicateAccounts,
  detectReconciliationCandidates,
} from '@/lib/engine/account/duplicates';
import { duplicatePairDismissKey, getDismissedDuplicateKeys } from '@/server/duplicate-dismissal';
import {
  type ReconciliationLinkLike,
  applyReconciliationBoundary,
  effectiveReconciliationLinks,
} from '@/lib/engine/account/reconcile-boundary';
import { getActiveReconciliations, getReconciliationTxnKeep, isAccountLive } from '@/server/reconciliation';
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
  /** Distinct accounts for the filter dropdown (id + name). */
  accountOptions: { id: string; name: string }[];
  /** Pagination state for the current (filtered) page (ROADMAP #8). */
  pageInfo: PageInfo;
  /** Set only when the filter names a merchant AND the profile has something
   *  honest to say (viewer-only: computed from the viewer's own rows). */
  lens: MerchantLensView | null;
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
  const rawTxns = await prisma.transaction.findMany({
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

  // Reconciliation boundary (slice-6 critics B-F1/C-1): the register was the one
  // transaction surface reading Prisma directly, so a reconciled pair's overlap rows
  // double-counted here — rows AND summary totals — while the dashboard, reports, and
  // trends (snapshot-fed) counted them once, on the same screenload. Apply the
  // assembler's EXACT R1 ownership rule before anything derives from the row set:
  // merchant counts, provenance, the lens, the summary, pagination, and the account
  // dropdown all inherit it. No active links → constant-true fast path (R8).
  const keepsReconciled = await getReconciliationTxnKeep(userId);
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
  const predictions = await prisma.categoryPrediction.findMany({
    where: { userId },
    select: { transactionId: true, source: true, predictedCategoryId: true, labeledAt: true },
  });
  const predByTxn = new Map(predictions.map((p) => [p.transactionId, p]));

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

  // Account options come from the full (unfiltered) set so the dropdown is stable.
  const seen = new Map<string, string>();
  for (const r of rows) if (!seen.has(r.accountId)) seen.set(r.accountId, r.accountName);
  const accountOptions = [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => (a.name < b.name ? -1 : 1));

  return { rows: items, summary, accountOptions, pageInfo: info, lens };
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
   *  `health` grades how recently the connection last synced (Gap 1 §3). */
  simplefin: { connected: boolean; lastSyncedAt: string | null; health: FreshnessResult };
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
    }[];
  };
  /** What the currency guard withheld — drives the disclosure banner (#135 residual). */
  withheld: WithheldAccountSummary;
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
  const [user, accounts, snapshots, statements, autopays, sfConn, plaidItems, newestByAccount, activeReconciliations, dismissedDupKeys] =
    await Promise.all([
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
    getActiveReconciliations(userId),
    // Pairs the user has marked "not a duplicate" — filtered out of the advisory warning below.
    getDismissedDuplicateKeys(userId),
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
    name: a.name,
    type: a.type,
    mask: a.mask,
    currentBalanceCents: a.currentBalanceCents,
    manual: a.provider === 'manual',
    provider: a.provider,
    deletable:
      (a.provider === 'simplefin' || a.provider === 'plaid') &&
      syncedDeleteBlockReason({ provider: a.provider, plaidItemId: a.plaidItemId }, deleteCtx) === null,
    // Which bank feeds this row — the duplicate warning needs it to offer "Disconnect <bank>"
    // for a both-live pair, where deleting is (correctly) refused because the next sync would
    // just bring the row back.
    plaidItemId: a.provider === 'plaid' ? a.plaidItemId ?? null : null,
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
  const reconciliationCandidates: ReconciliationCandidateView[] = detectReconciliationCandidates(
    supported.map((a) => ({
      id: a.id,
      provider: a.provider,
      name: a.name,
      type: a.type,
      mask: a.mask,
      currentBalanceCents: a.currentBalanceCents,
      currency: a.currency,
      plaidItemId: a.plaidItemId, // C-10: two items' rows for the same bank are eligible pairs
      hasLiveConnection: isAccountLive({ provider: a.provider, plaidItemId: a.plaidItemId }, conns),
      // L.10: lets a SAME-provider pair (two connections at one bank, one now disconnected) be
      // proposed on proven identity — the state a half-finished combine leaves behind.
      identity: identityOf(a),
    })),
  )
    .filter(
      (c) =>
        !reconciledPairKeys.has(pairKey(c.predecessor.id, c.successor.id)) &&
        !effectivePredIds.has(c.predecessor.id) &&
        // A pair the user dismissed as "not a duplicate" must not re-surface as a combine
        // candidate once one side goes non-live — the candidate card is "the actionable version
        // of the same message", so an explicit "these are different" judgment binds BOTH surfaces
        // (dup-veto critic DUP-DISMISS-1). Same key + sort as the duplicates-warning filter.
        !dismissedDupKeys.has(duplicatePairDismissKey(c.predecessor.id, c.successor.id)),
    )
    .map((c) => ({ ...c, predecessorTxnSpan: spanByAccount.get(c.predecessor.id) ?? null }));
  const candidatePairKeys = new Set(reconciliationCandidates.map((c) => pairKey(c.predecessor.id, c.successor.id)));

  // Both-live duplicate connections (TASKS L.6 / L.10). Suppressed for a pair the user has
  // already judged — an explicit "not a duplicate" dismissal binds this surface exactly as it
  // binds the warning and the candidate card, and an already-reconciled pair is resolved rather
  // than offered again. Only the currency-supported rows take part, so the offer can never name
  // an account the page is withholding.
  const combinableConnections: CombineConnectionsProposal[] = suppressCombineProposals(
    combinableConnectionsFor(userId, plaidItems, accounts),
    {
      supportedAccountIds: new Set(supported.map((a) => a.id)),
      dismissedPairKeys: dismissedDupKeys,
      reconciledPairKeys,
      linkedPredecessorIds: effectivePredIds,
    },
  );
  const uncombinableConnections = uncombinableConnectionsFor(userId, plaidItems, accounts, {
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
  const reconciliations: ReconciledPairView[] = effective.flatMap((l) => {
    const p = acctById.get(l.predecessorAccountId);
    const s = acctById.get(l.successorAccountId);
    const id = idByPredecessor.get(l.predecessorAccountId);
    if (!p || !s || id === undefined) return [];
    return [
      {
        id,
        cutoverDate: l.cutoverDate,
        predecessor: { id: p.id, name: p.name, mask: p.mask, provider: p.provider },
        successor: { id: s.id, name: s.name, mask: s.mask, provider: s.provider },
      },
    ];
  });

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
          .map((a) => ({ name: a.name, mask: a.mask })),
      })),
    },
    // The unfiltered rows are already in hand, so the disclosure costs no extra query.
    withheld: summarizeWithheldAccounts(accounts),
    // Advisory duplicate warning. Suppressed for a pair that is already reconciled (R6 — resolved,
    // not a warning) OR that has a live continue-candidate (the candidate card is the actionable
    // version of the same message; showing both would double-message one pair). A both-live genuine
    // duplicate has no candidate and still warns. Undoing a link brings its pair back here next load.
    duplicates: detectDuplicateAccounts(
      supported.map((a) => ({
        id: a.id,
        provider: a.provider,
        name: a.name,
        type: a.type,
        mask: a.mask,
        currentBalanceCents: a.currentBalanceCents,
        currency: a.currency,
        plaidItemId: a.plaidItemId, // C-10: same-bank-relinked (two items) both-live pairs warn
      })),
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
    }),
    reconciliations,
    reconciliationCandidates,
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
export async function getWithheldAccountSummary(userId: string): Promise<WithheldAccountSummary> {
  const rows = await prisma.account.findMany({
    where: { userId, NOT: { OR: [{ currency: null }, { currency: 'USD' }] } },
    select: { currency: true },
  });
  return summarizeWithheldAccounts(rows);
}
