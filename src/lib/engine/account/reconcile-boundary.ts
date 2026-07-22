/**
 * Cross-provider reconciliation boundary — the money core (TASKS Wave 4.6 slice 3;
 * docs/PROVIDER_RECONCILIATION_ARCHITECTURE.md §5, invariants R1/R2/R7/R8).
 *
 * Pure. Applied ONCE, in the shared assembler (`getFinanceSnapshot`), so spending,
 * cash-needed, radar, digest, trends, the assistant, and the net-worth series all
 * inherit it with no per-engine change. For each ACTIVE reconciliation link
 * (predecessor = stale row, successor = live row for the SAME real account):
 *
 *  - Balance (R2): the predecessor contributes 0 — its `currentBalanceCents` (and
 *    `availableBalanceCents`, when present) are zeroed on a copy. The row itself
 *    STAYS in `accounts`: removing it would orphan its balance-snapshot history
 *    (netWorthSeries drops snapshots whose account is missing) and strip its
 *    pre-cutover transactions out of every account-id join (recurring, coach).
 *  - Transactions (R1): the predecessor is authoritative exactly over its own
 *    covered span. It keeps rows with `date <= cutoverDate`; the successor keeps
 *    rows OUTSIDE the predecessor's claim `[predecessor's first txn date,
 *    min(cutoverDate, predecessor's last txn date)]`. So the successor's deeper
 *    backfill (Plaid reaches years further back than a 90-day SimpleFIN window)
 *    is NEVER dropped (critic cycle-1 F2), a cutover past the predecessor's last
 *    data claims nothing extra (F4), and inside the claim each calendar date is
 *    owned by exactly one side — no overlap, no fuzzy matching.
 *  - Balance snapshots (F3): snapshots are STOCKS, not flows — a lone observation
 *    is always a correct single contribution, so nothing is dropped unless BOTH
 *    sides observed the same real account on the SAME date. On an exact-date
 *    collision the predecessor's copy wins on/before the cutover, the successor's
 *    after — one contribution per date, and never a fabricated dip in the
 *    net-worth trend where only one side has data.
 *  - `paymentAccountId`: if the user's designated funding account is a predecessor,
 *    it is remapped to its successor (following chains to the terminal live side).
 *    Without this, cash-needed and the forecast would fund from a zeroed balance —
 *    a fabricated shortfall.
 *  - `supersededAccountIds` (critic cycle-1 F1): the effective predecessors, so
 *    funding-account FALLBACK resolution (`resolvePaymentAccount`, the forecast
 *    anchor) can skip a zeroed predecessor when no payment account is designated —
 *    the old row sorts first by creation order and would otherwise be picked.
 *
 * Defensive inertness (never drop money on bad input): a link is IGNORED — both
 * sides count fully, exactly today's behavior — when either side is absent from
 * the account list (deleted or currency-withheld, R7), when it is degenerate
 * (predecessor === successor), when the two sides' types differ (a cross-type link
 * would sign-flip the predecessor's history in the net-worth series), or when it
 * participates in or leads into a direction cycle (A→B and B→A both active would
 * otherwise zero BOTH balances and drop a real account from net worth). The confirm
 * action refuses or auto-undoes these shapes at write time; this engine guards the
 * same invariants at read time so a historical or racing row can never corrupt a
 * figure (docs/lessons/a-guard-must-read-what-it-guards).
 *
 * Golden safety (R8): with no effective links the INPUT arrays are returned by
 * reference, untouched — byte-identical demo output by construction. With links,
 * only affected rows are copied; every untouched row keeps its identity.
 */
import { type ISODate, compareDates, isoDate } from '@/lib/dates';

export interface ReconciliationLinkLike {
  predecessorAccountId: string;
  successorAccountId: string;
  /** YYYY-MM-DD; validated by the confirm action before it is ever stored. */
  cutoverDate: string;
}

export interface BoundaryAccountLike {
  id: string;
  type: string;
  currentBalanceCents: number;
  availableBalanceCents?: number | null;
}

export interface BoundaryDatedRowLike {
  accountId: string;
  date: string;
}

export interface ReconciliationBoundaryInput<
  A extends BoundaryAccountLike,
  T extends BoundaryDatedRowLike,
  B extends BoundaryDatedRowLike,
> {
  paymentAccountId: string | null;
  accounts: readonly A[];
  transactions: readonly T[];
  balanceSnapshots: readonly B[];
  links: readonly ReconciliationLinkLike[];
}

export interface ReconciliationBoundaryResult<
  A extends BoundaryAccountLike,
  T extends BoundaryDatedRowLike,
  B extends BoundaryDatedRowLike,
> {
  paymentAccountId: string | null;
  accounts: readonly A[];
  transactions: readonly T[];
  balanceSnapshots: readonly B[];
  /** Effective predecessors — funding-account fallbacks must not pick these. */
  supersededAccountIds: readonly string[];
}

/**
 * The links that actually take effect: both sides present, non-degenerate,
 * same account type, and not part of (or leading into) a direction cycle —
 * conservative both ways, since an ambiguous shape must fall back to "both
 * sides count fully", never to a dropped figure. Exported so slice 5's
 * advisory suppression and display layer consult the SAME effectiveness rule
 * the money boundary uses — a link this function drops changes no figure and
 * must not suppress the duplicate warning either.
 */
export function effectiveReconciliationLinks<A extends BoundaryAccountLike>(
  accounts: readonly A[],
  links: readonly ReconciliationLinkLike[],
): ReconciliationLinkLike[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const structural = links.filter((l) => {
    if (l.predecessorAccountId === l.successorAccountId) return false;
    const pred = byId.get(l.predecessorAccountId);
    const succ = byId.get(l.successorAccountId);
    if (!pred || !succ) return false; // deleted or currency-withheld side → inert (R7)
    return pred.type === succ.type; // cross-type would sign-flip series history
  });

  // Cycle guard: walk pred → succ edges; any link on OR leading into a cycle is
  // inert. With `predecessorAccountId` unique there is at most one outgoing edge
  // per node, so a simple visited-walk per link suffices and terminates.
  const succOf = new Map(structural.map((l) => [l.predecessorAccountId, l.successorAccountId]));
  return structural.filter((l) => {
    const seen = new Set<string>([l.predecessorAccountId]);
    let cursor: string | undefined = l.successorAccountId;
    while (cursor !== undefined) {
      if (seen.has(cursor)) return false; // came back around → cycle → inert
      seen.add(cursor);
      cursor = succOf.get(cursor);
    }
    return true;
  });
}

export function applyReconciliationBoundary<
  A extends BoundaryAccountLike,
  T extends BoundaryDatedRowLike,
  B extends BoundaryDatedRowLike,
>(input: ReconciliationBoundaryInput<A, T, B>): ReconciliationBoundaryResult<A, T, B> {
  const links = effectiveReconciliationLinks(input.accounts, input.links);
  if (links.length === 0) {
    // Golden fast path (R8): no effective links → the exact input references.
    const { paymentAccountId, accounts, transactions, balanceSnapshots } = input;
    return { paymentAccountId, accounts, transactions, balanceSnapshots, supersededAccountIds: [] };
  }

  // Stored cutovers were validated at write time; isoDate here is a brand cast
  // that would throw loudly on a corrupt row rather than mis-compare it.
  const cutover = new Map<string, ISODate>(links.map((l) => [l.predecessorAccountId, isoDate(l.cutoverDate)]));

  // Predecessor transaction claims [first, min(cutover, last)], from the RAW
  // input so the result is independent of link evaluation order. A predecessor
  // with no transactions claims nothing — the successor then keeps everything.
  const txnSpan = new Map<string, { first: ISODate; last: ISODate }>();
  for (const t of input.transactions) {
    if (!cutover.has(t.accountId)) continue;
    const d = isoDate(t.date);
    const span = txnSpan.get(t.accountId);
    if (!span) txnSpan.set(t.accountId, { first: d, last: d });
    else {
      if (compareDates(d, span.first) < 0) span.first = d;
      if (compareDates(d, span.last) > 0) span.last = d;
    }
  }

  // Exact snapshot dates each linked account has, from the RAW input — a
  // snapshot is only ever dropped in favor of the other side's SAME-DATE copy.
  const linkedIds = new Set<string>();
  for (const l of links) {
    linkedIds.add(l.predecessorAccountId);
    linkedIds.add(l.successorAccountId);
  }
  const snapshotDates = new Map<string, Set<string>>();
  for (const b of input.balanceSnapshots) {
    if (!linkedIds.has(b.accountId)) continue;
    const set = snapshotDates.get(b.accountId) ?? new Set<string>();
    set.add(b.date);
    snapshotDates.set(b.accountId, set);
  }

  // R2: a predecessor's balance contributes 0. Copy-on-write; untouched rows
  // keep their identity (golden safety is structural, not incidental).
  const accounts = input.accounts.map((a) =>
    cutover.has(a.id)
      ? { ...a, currentBalanceCents: 0, ...('availableBalanceCents' in a ? { availableBalanceCents: 0 } : {}) }
      : a,
  );

  // R1 for transactions. Per link: predecessor keeps date <= cutover; successor
  // keeps dates OUTSIDE the predecessor's claim. An account holding both roles
  // (chain A→B→C) composes by AND: B owns exactly (claim end of A, cutover of
  // B→C].
  const keepsTxn = (accountId: string, date: string): boolean => {
    for (const l of links) {
      if (l.predecessorAccountId === accountId) {
        if (compareDates(isoDate(date), cutover.get(accountId) as ISODate) > 0) return false;
      }
      if (l.successorAccountId === accountId) {
        const span = txnSpan.get(l.predecessorAccountId);
        if (!span) continue; // predecessor has no transactions → no claim
        const cut = cutover.get(l.predecessorAccountId) as ISODate;
        const claimEnd = compareDates(cut, span.last) < 0 ? cut : span.last;
        const d = isoDate(date);
        if (compareDates(d, span.first) >= 0 && compareDates(d, claimEnd) <= 0) return false;
      }
    }
    return true;
  };

  // F3 rule for balance snapshots: drop only on an exact-date collision with
  // the linked counterpart; the cutover picks the winner.
  const keepsSnapshot = (accountId: string, date: string): boolean => {
    for (const l of links) {
      if (l.predecessorAccountId === accountId) {
        const succHasDate = snapshotDates.get(l.successorAccountId)?.has(date) ?? false;
        if (succHasDate && compareDates(isoDate(date), cutover.get(accountId) as ISODate) > 0) return false;
      }
      if (l.successorAccountId === accountId) {
        const predHasDate = snapshotDates.get(l.predecessorAccountId)?.has(date) ?? false;
        if (predHasDate && compareDates(isoDate(date), cutover.get(l.predecessorAccountId) as ISODate) <= 0)
          return false;
      }
    }
    return true;
  };

  return {
    paymentAccountId: remapPaymentAccountId(input.paymentAccountId, links),
    accounts,
    transactions: input.transactions.filter((t) => keepsTxn(t.accountId, t.date)),
    balanceSnapshots: input.balanceSnapshots.filter((b) => keepsSnapshot(b.accountId, b.date)),
    supersededAccountIds: links.map((l) => l.predecessorAccountId),
  };
}

/**
 * A payment account that has been superseded funds nothing — follow the chain to
 * the terminal live side. Cycle-free by construction (called with effective links
 * only), but the visited guard keeps it total on any input.
 */
function remapPaymentAccountId(
  paymentAccountId: string | null,
  links: readonly ReconciliationLinkLike[],
): string | null {
  if (paymentAccountId === null) return null;
  const succOf = new Map(links.map((l) => [l.predecessorAccountId, l.successorAccountId]));
  const seen = new Set<string>();
  let current = paymentAccountId;
  while (succOf.has(current) && !seen.has(current)) {
    seen.add(current);
    current = succOf.get(current) as string;
  }
  return current;
}
