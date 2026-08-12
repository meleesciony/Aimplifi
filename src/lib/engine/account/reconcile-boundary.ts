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
 *    is always a correct single contribution, so nothing is dropped unless MORE
 *    THAN ONE row observed the same real account on the SAME date. Exactly one
 *    survives per (supersession COMPONENT, date) — the component, not the chain,
 *    because a link's "same real account" claim is transitive and two stale rows
 *    can share one live successor (U.9). The side whose ownership window most
 *    tightly contains the date wins: still-covering sides first (earliest cutover),
 *    then the live terminal row, then closed windows (latest cutover). An EQUAL
 *    cutover is broken by chain DEPTH, never by account id — a chain's two links may
 *    legitimately share a cutover, and the mid-chain window is then empty, so ranking
 *    by id handed the date to a row that owns nothing and moved a real figure on cuid
 *    order (U.9 critic P0-1). Account id is the last resort and settles only true
 *    siblings, which are symmetric. One contribution per date, order-independent, and
 *    never a fabricated dip in the net-worth trend where only one side has data.
 *  - `paymentAccountId`: if the user's designated funding account is a predecessor,
 *    it is remapped to its successor (following chains to the terminal live side).
 *    Without this, cash-needed and the forecast would fund from a zeroed balance —
 *    a fabricated shortfall.
 *  - `supersededAccountIds` (critic cycle-1 F1): the effective predecessors, so
 *    funding-account FALLBACK resolution (`resolvePaymentAccount`, the forecast
 *    anchor) can skip a zeroed predecessor when no payment account is designated —
 *    the old row sorts first by creation order and would otherwise be picked.
 *  - `statements` (slice 4, R4): RE-KEY the predecessor's statements onto the terminal
 *    successor, keeping only those the successor does not already cover (cycleEnd NEWER
 *    than every statement the successor already has, or the successor has none). The
 *    naive "drop them all" is WRONG when the live successor is on the ESTIMATE path — a
 *    fresh Plaid reconnect that hasn't generated a statement yet: dropping the
 *    predecessor's real CURRENT statement silently demotes that owed amount to the
 *    successor's next-cycle estimate, dropping it from the cash-needed headline and the
 *    5-day reminder window (critic cycle-2). Re-keying hands the successor its own real
 *    current statement; the cycleEnd filter drops the stale OVERLAP statements the live
 *    successor authoritatively owns (so the coach cleared-streak, which reads
 *    `snap.statements`, never double-counts an overlap cycle, and a stale statement never
 *    overrides the live due). cash-needed picks ONE current statement per card, so
 *    re-keying never double-counts a due; the engine additionally skips the superseded
 *    account so no phantom obligation survives on the estimate/autopay path.
 *  - `scheduled` (slice 4, F6): the predecessor's ScheduledTransaction rows
 *    (paycheck, recurring bills) are RE-KEYED onto the terminal successor. After
 *    the payment account remaps predecessor→successor, forecast/radar/cash-needed
 *    all pin their scheduled filter to the successor id, so a row still keyed to
 *    the predecessor silently falls out of the projection (a dropped income/bill).
 *    Re-keying at READ time keeps it reversible: undo clears the link and the rows
 *    count on the predecessor exactly as before (a write-time re-key could not be
 *    undone without storing the original id). Double-count-safe — but NOT for the
 *    reason this comment gave until L.25, which was that detected rows are
 *    full-replaced to a SINGLE payment account. They are not: since L.25 the writer
 *    emits expense rows for every cash account. Re-derived, the guarantee now rests
 *    on two facts, both in `detectRecurring`/`refreshRecurringForUser`: detection
 *    groups by MERCHANT, so one merchant yields exactly one series and therefore at
 *    most one row (its `accountId` is `last.accountId`, one account by construction);
 *    and the full replace deletes every detected row for the USER, not per account,
 *    so no stale sibling survives a refresh to collide with a re-keyed one. In
 *    addition `refreshRecurringForUser` now excludes superseded predecessors
 *    outright, so after any refresh there is no predecessor row left to re-key.
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

/** Any row owned by an account — scheduled rows scope by id alone. */
export interface BoundaryAccountScopedRowLike {
  accountId: string;
}

/** A statement row — scoped by account, plus the cycle-close date the R4 rule reads. */
export interface BoundaryStatementRowLike extends BoundaryAccountScopedRowLike {
  cycleEnd: string;
}

export interface BoundaryDatedRowLike extends BoundaryAccountScopedRowLike {
  date: string;
}

export interface ReconciliationBoundaryInput<
  A extends BoundaryAccountLike,
  T extends BoundaryDatedRowLike,
  B extends BoundaryDatedRowLike,
  S extends BoundaryStatementRowLike,
  Sc extends BoundaryAccountScopedRowLike,
> {
  paymentAccountId: string | null;
  accounts: readonly A[];
  transactions: readonly T[];
  balanceSnapshots: readonly B[];
  statements: readonly S[];
  scheduled: readonly Sc[];
  links: readonly ReconciliationLinkLike[];
}

export interface ReconciliationBoundaryResult<
  A extends BoundaryAccountLike,
  T extends BoundaryDatedRowLike,
  B extends BoundaryDatedRowLike,
  S extends BoundaryStatementRowLike,
  Sc extends BoundaryAccountScopedRowLike,
> {
  paymentAccountId: string | null;
  accounts: readonly A[];
  transactions: readonly T[];
  balanceSnapshots: readonly B[];
  /** Predecessor statements dropped (R4); untouched rows keep their identity. */
  statements: readonly S[];
  /** Predecessor scheduled rows re-keyed to the terminal successor (F6). */
  scheduled: readonly Sc[];
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

  // Out-degree guard (U.9 critic finding 3): a predecessor with TWO successors says
  // one stale row was continued onto two different live accounts — mutually exclusive
  // claims, and the shape silently breaks the component key (`chainMaps` builds
  // `succOf` with `new Map`, so the LAST edge wins and the other successor keys its
  // own component; measured: two survivors for one real account, the exact U.9 defect
  // through a different door). `predecessorAccountId @unique` makes this unreachable
  // from the database, which is precisely why it must be guarded HERE too: this file
  // already re-checks the cycle and monotonicity invariants at read time although both
  // are refused at write time (docs/lessons/a-guard-must-read-what-it-guards), and the
  // component key's soundness now rests on out-degree <= 1. Same doctrine as those
  // guards: the ambiguous shape goes INERT — every link out of that predecessor drops
  // and all the rows count fully, a visible advisory-covered double, never a silent
  // drop or a wrong winner.
  const outDegree = new Map<string, number>();
  for (const l of structural) {
    outDegree.set(l.predecessorAccountId, (outDegree.get(l.predecessorAccountId) ?? 0) + 1);
  }
  const singleExit = structural.filter((l) => (outDegree.get(l.predecessorAccountId) ?? 0) === 1);

  // Cycle guard: walk pred → succ edges; any link on OR leading into a cycle is
  // inert. Out-degree is now <= 1 by the guard above, so a simple visited-walk per
  // link suffices and terminates.
  const succOf = new Map(singleExit.map((l) => [l.predecessorAccountId, l.successorAccountId]));
  const acyclic = singleExit.filter((l) => {
    const seen = new Set<string>([l.predecessorAccountId]);
    let cursor: string | undefined = l.successorAccountId;
    while (cursor !== undefined) {
      if (seen.has(cursor)) return false; // came back around → cycle → inert
      seen.add(cursor);
      cursor = succOf.get(cursor);
    }
    return true;
  });

  // Chain-monotonicity guard (slice-6 critic B-F4): the confirm action refuses a
  // downstream cutover earlier than any upstream cutover, but two RACING confirms
  // on Postgres can commit a non-monotone chain the write-time guard never saw —
  // and in that shape the window (downstream cutover, upstream cutover] is kept by
  // BOTH the upstream predecessor and the terminal successor (a double-count).
  // Read-time backstop, same doctrine as the cycle guard: drop the DOWNSTREAM link
  // of any pair where a transitive upstream link's cutover exceeds its own — the
  // pair falls back to "both count fully" (advisory-covered duplicate), never to a
  // dropped or doubled figure. Evaluated against the acyclic set so the walk
  // terminates; conservative in pathological shapes by design.
  const linksIntoPred = new Map<string, ReconciliationLinkLike[]>();
  for (const l of acyclic) {
    const list = linksIntoPred.get(l.successorAccountId) ?? [];
    list.push(l);
    linksIntoPred.set(l.successorAccountId, list);
  }
  return acyclic.filter((l) => {
    const own = isoDate(l.cutoverDate);
    const queue = [...(linksIntoPred.get(l.predecessorAccountId) ?? [])];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const up = queue.pop() as ReconciliationLinkLike;
      if (seen.has(up.predecessorAccountId)) continue;
      seen.add(up.predecessorAccountId);
      if (compareDates(isoDate(up.cutoverDate), own) > 0) return false; // non-monotone → inert
      queue.push(...(linksIntoPred.get(up.predecessorAccountId) ?? []));
    }
    return true;
  });
}

/**
 * Chain traversal maps over EFFECTIVE links (slice-6 critic A-F1/A-F4): transaction
 * CLAIMS must compose across a CHAIN (A→B→C), not just across direct links — the
 * terminal successor's deep backfill re-imports history the ORIGINAL predecessor
 * already holds, two links away, and a direct-only check double-counted it.
 * `upstreamsOf(X)` = every account whose chain of links leads INTO X;
 * `downstreamsOf(X)` = the chain from X to the terminal successor; the terminal
 * remap is the slice-3 payment-account/re-key walk. All cycle-free by construction
 * (effective links only), visited-guarded anyway.
 *
 * Snapshot collisions are NO LONGER decided by these two walks (U.9): they compose
 * over the whole connected COMPONENT, because two accounts can be the same real
 * account without either being upstream or downstream of the other. `downstreamsOf`
 * still serves that rule — its length is an account's DEPTH, which is what orders
 * two chain members whose cutovers are equal.
 */
function chainMaps(links: readonly ReconciliationLinkLike[]): {
  upstreamsOf: (id: string) => string[];
  downstreamsOf: (id: string) => string[];
  remapToTerminal: (id: string) => string;
} {
  const succOf = new Map(links.map((l) => [l.predecessorAccountId, l.successorAccountId]));
  const predsOf = new Map<string, string[]>();
  for (const l of links) {
    const list = predsOf.get(l.successorAccountId) ?? [];
    list.push(l.predecessorAccountId);
    predsOf.set(l.successorAccountId, list);
  }
  const upstreamsOf = (id: string): string[] => {
    const out: string[] = [];
    const queue = [...(predsOf.get(id) ?? [])];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const p = queue.pop() as string;
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
      queue.push(...(predsOf.get(p) ?? []));
    }
    return out;
  };
  const downstreamsOf = (id: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>([id]);
    let cursor = succOf.get(id);
    while (cursor !== undefined && !seen.has(cursor)) {
      seen.add(cursor);
      out.push(cursor);
      cursor = succOf.get(cursor);
    }
    return out;
  };
  const remapToTerminal = (id: string): string => {
    const seen = new Set<string>();
    let current = id;
    while (succOf.has(current) && !seen.has(current)) {
      seen.add(current);
      current = succOf.get(current) as string;
    }
    return current;
  };
  return { upstreamsOf, downstreamsOf, remapToTerminal };
}

/**
 * The ONE R1 transaction ownership rule (built from effective links + claim
 * spans; used by the assembler AND by reconciliationTxnKeepFilter). Predecessor
 * keeps date <= cutover; every account keeps only dates OUTSIDE each TRANSITIVE
 * upstream predecessor's claim (A-F1). A mid-chain account composes both roles
 * by AND: B owns exactly (claim end of A, cutover of B→C].
 */
function txnKeepRule(
  links: readonly ReconciliationLinkLike[],
  cutover: ReadonlyMap<string, ISODate>,
  txnSpan: ReadonlyMap<string, { first: ISODate; last: ISODate }>,
): (accountId: string, date: string) => boolean {
  const { upstreamsOf } = chainMaps(links);
  return (accountId, date) => {
    const cutSelf = cutover.get(accountId);
    if (cutSelf !== undefined) {
      // If the stored cutover predates the predecessor's FIRST transaction
      // (unreachable via confirm, but a later deletion of its earliest manual
      // row can move the first date past it), dropping `date > cutover` would
      // erase the ENTIRE history with no successor copies (critic A-F8). The
      // claim goes degenerate instead: the predecessor keeps everything —
      // balance still zeroed; the failure direction is a visible, advisory-
      // covered double, never a silent loss.
      const spanSelf = txnSpan.get(accountId);
      const degenerate = spanSelf !== undefined && compareDates(cutSelf, spanSelf.first) < 0;
      if (!degenerate && compareDates(isoDate(date), cutSelf) > 0) return false;
    }
    for (const p of upstreamsOf(accountId)) {
      const span = txnSpan.get(p);
      if (!span) continue; // that predecessor has no transactions → no claim
      const cut = cutover.get(p) as ISODate;
      if (compareDates(cut, span.first) < 0) continue; // degenerate claim (A-F8)
      const claimEnd = compareDates(cut, span.last) < 0 ? cut : span.last;
      const d = isoDate(date);
      if (compareDates(d, span.first) >= 0 && compareDates(d, claimEnd) <= 0) return false;
    }
    return true;
  };
}

/**
 * pred id → TERMINAL live successor id, over effective links only (slice-6 critic C-5).
 * The assistant's account-balance answer folds a matched superseded predecessor onto the
 * account that actually carries the money — without this, "how much is in my old
 * checking" answered the boundary-zeroed "$0.00" ghost, and a type query counted one
 * real account as two.
 */
export function terminalSuccessorMap<A extends BoundaryAccountLike>(
  accounts: readonly A[],
  links: readonly ReconciliationLinkLike[],
): Map<string, string> {
  const eff = effectiveReconciliationLinks(accounts, links);
  const { remapToTerminal } = chainMaps(eff);
  return new Map(eff.map((l) => [l.predecessorAccountId, remapToTerminal(l.predecessorAccountId)]));
}

/**
 * pred id → terminal successor over EVERY live link, with only the cycle guard
 * `chainMaps` already carries — deliberately NOT filtered by
 * `effectiveReconciliationLinks` (H.7 cycle-2 critic P1-1, executed).
 *
 * The effectiveness rule exists to protect MONEY FIGURES, and its documented
 * doctrine is to fail OPEN: an ambiguous link shape falls back to "both sides
 * count fully", because for a reader the failure is a visible double that the
 * duplicate disclosure already covers. That default inverts for a caller asking
 * a question about IDENTITY rather than about money. The transfer sweep uses
 * this map to refuse pairing a row against its own duplicate, so an inert link
 * there means the two copies of one real account silently pair again and REAL
 * money leaves every total — the 45-of-73 artifact H.7 exists to kill. And it is
 * reachable without crafted data: both providers rewrite `Account.type` and
 * `currency` on every ordinary sync, so a feed reclassifying checking → money
 * market makes a confirmed link cross-type and inert.
 *
 * A confirmed link is the user's statement that two rows are the same account.
 * That statement does not stop being true because the feed renamed a type, so
 * identity reads every `undoneAt: null` link; refusing to pair is safe in both
 * directions, which is exactly why the conservative choice here is the opposite
 * of the boundary's.
 */
export function accountIdentityMap(links: readonly ReconciliationLinkLike[]): Map<string, string> {
  const { remapToTerminal } = chainMaps(links);
  return new Map(links.map((l) => [l.predecessorAccountId, remapToTerminal(l.predecessorAccountId)]));
}

/** A linked predecessor's FULL-history transaction span (min/max date). */
export interface PredecessorSpanLike {
  accountId: string;
  first: string;
  last: string;
}

/**
 * The windowed-surface filter (slice-6 critics B-F1/C-1/C-2/C-3): the register,
 * CSV export, budgets, recurring detection, and triage page or window their
 * transaction reads, so they cannot feed the whole ledger through
 * `applyReconciliationBoundary` — but they MUST apply the identical R1 rule or
 * they contradict the dashboard on the same screenload. Spans must come from a
 * min/max aggregate over each linked predecessor's FULL history, never from the
 * windowed rows themselves (a-guard-must-read-what-it-guards): a window that
 * clips the predecessor's span would move the claim edge and change ownership.
 * Returns the same closure the assembler uses; with no effective links it keeps
 * everything (R8).
 */
export function reconciliationTxnKeepFilter<A extends BoundaryAccountLike>(
  accounts: readonly A[],
  links: readonly ReconciliationLinkLike[],
  predecessorSpans: readonly PredecessorSpanLike[],
): (accountId: string, date: string) => boolean {
  const eff = effectiveReconciliationLinks(accounts, links);
  if (eff.length === 0) return () => true;
  const cutover = new Map<string, ISODate>(eff.map((l) => [l.predecessorAccountId, isoDate(l.cutoverDate)]));
  const txnSpan = new Map(
    predecessorSpans
      .filter((s) => cutover.has(s.accountId))
      .map((s) => [s.accountId, { first: isoDate(s.first), last: isoDate(s.last) }]),
  );
  return txnKeepRule(eff, cutover, txnSpan);
}

export function applyReconciliationBoundary<
  A extends BoundaryAccountLike,
  T extends BoundaryDatedRowLike,
  B extends BoundaryDatedRowLike,
  S extends BoundaryStatementRowLike,
  Sc extends BoundaryAccountScopedRowLike,
>(input: ReconciliationBoundaryInput<A, T, B, S, Sc>): ReconciliationBoundaryResult<A, T, B, S, Sc> {
  const links = effectiveReconciliationLinks(input.accounts, input.links);
  if (links.length === 0) {
    // Golden fast path (R8): no effective links → the exact input references.
    const { paymentAccountId, accounts, transactions, balanceSnapshots, statements, scheduled } = input;
    return {
      paymentAccountId,
      accounts,
      transactions,
      balanceSnapshots,
      statements,
      scheduled,
      supersededAccountIds: [],
    };
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

  // Chain maps + the shared R1 keep rule (module-level builders so the register
  // filter applies the IDENTICAL rule — see reconciliationTxnKeepFilter).
  const { downstreamsOf, remapToTerminal } = chainMaps(links);
  const keepsTxn = txnKeepRule(links, cutover, txnSpan);

  // F3 rule for balance snapshots, composed over the whole SUPERSESSION COMPONENT
  // (A-F4 chains AND U.9 siblings). A link asserts "these two rows are the same
  // real account", and that assertion is TRANSITIVE: s1 ≡ live and s2 ≡ live makes
  // s1 ≡ s2 even though neither is upstream nor downstream of the other. The old
  // rule walked only `upstreamsOf`/`downstreamsOf`, so two stale rows continued
  // onto ONE live account — the shape the non-unique `successorAccountId` exists
  // for (#274) — were each compared against the successor and never against each
  // other, and on a date both cutovers covered BOTH survived: one real $5,000.00
  // savings account measured as $10,000.00 in the trend (U.9).
  //
  // So the unit of de-duplication is the connected component, and the invariant is
  // exactly ONE surviving snapshot per (component, date). `remapToTerminal` is the
  // component key: effective links are acyclic with out-degree <= 1, so every
  // account in a component walks to the same single terminal live row.
  //
  // The winner is chosen ONLY among accounts that actually have a row on that date,
  // so a lone observation is still never dropped and the trend never gains a
  // fabricated dip. Among the rows that do exist, it is the side whose ownership
  // window most tightly contains the date:
  //   0. sides still covering it (cutover >= date), EARLIEST cutover first — the
  //      chain's own half-open rule (A owns [..cutAB], B owns (cutAB..cutBC]);
  //   1. then the live terminal row, which owns every date past every cutover;
  //   2. then sides whose window already closed, LATEST cutover first — a dead feed
  //      that kept reporting is the last resort, never a second copy.
  //
  // EQUAL cutovers are then broken by CHAIN POSITION, never by account id, and this
  // is load-bearing rather than tidiness (U.9 critic P0-1). Two links of one chain may
  // legitimately share a cutover — the confirm action refuses only a STRICTLY earlier
  // downstream one (`reconciliation.ts`), and both defaulting to today is the ordinary
  // way to get there — and in that shape the mid-chain account's window `(cut..cut]` is
  // EMPTY, so the upstream owns the date outright. Breaking that tie on id made the
  // winner depend on cuid order: the same data moved a trend point by $5,000.00
  // depending only on how two opaque ids happened to sort. `depth` = links between an
  // account and its terminal, so an ancestor always outranks its descendant; before a
  // cutover the older side owns the date (greater depth wins) and after it the newer
  // one does (lesser depth wins). Account id is the last resort and applies only to
  // true SIBLINGS, which are symmetric — there is no fact left to prefer one by.
  const depthOf = new Map<string, number>();
  for (const id of linkedIds) depthOf.set(id, downstreamsOf(id).length);
  const snapshotTier = (accountId: string, date: ISODate): number => {
    const cut = cutover.get(accountId);
    if (cut === undefined) return 1; // the terminal live row — no window of its own
    return compareDates(date, cut) <= 0 ? 0 : 2;
  };
  const outranksForDate = (a: string, b: string, date: ISODate): boolean => {
    const tierA = snapshotTier(a, date);
    const tierB = snapshotTier(b, date);
    if (tierA !== tierB) return tierA < tierB;
    if (tierA === 1) return a < b; // one terminal per component — defensive only
    const cmp = compareDates(cutover.get(a) as ISODate, cutover.get(b) as ISODate);
    if (cmp !== 0) return tierA === 0 ? cmp < 0 : cmp > 0; // covering: earliest; closed: latest
    const depthA = depthOf.get(a) ?? 0;
    const depthB = depthOf.get(b) ?? 0;
    if (depthA !== depthB) return tierA === 0 ? depthA > depthB : depthA < depthB;
    return a < b;
  };
  const snapshotWinner = new Map<string, string>(); // `${componentId}:${date}` → account id
  for (const [accountId, dates] of snapshotDates) {
    const component = remapToTerminal(accountId);
    for (const date of dates) {
      const key = `${component}:${date}`;
      const held = snapshotWinner.get(key);
      if (held === undefined || outranksForDate(accountId, held, isoDate(date))) {
        snapshotWinner.set(key, accountId);
      }
    }
  }
  const keepsSnapshot = (accountId: string, date: string): boolean => {
    if (!linkedIds.has(accountId)) return true; // bystander — no link touches it
    return snapshotWinner.get(`${remapToTerminal(accountId)}:${date}`) === accountId;
  };

  // R4 statements: the latest cycleEnd each SUCCESSOR/bystander already has of its OWN
  // (a predecessor's own statements are excluded — they are what we're re-keying). Used to
  // keep only the predecessor statements the successor does NOT yet cover (critic cycle-2 F-CLAIM2).
  const ownMaxCycleEnd = new Map<string, ISODate>();
  for (const s of input.statements) {
    if (cutover.has(s.accountId)) continue;
    const d = isoDate(s.cycleEnd);
    const cur = ownMaxCycleEnd.get(s.accountId);
    if (cur === undefined || compareDates(d, cur) > 0) ownMaxCycleEnd.set(s.accountId, d);
  }

  // A-F6 (slice 6): two sources can re-key the SAME real cycle onto one terminal
  // successor — sibling predecessors ("same account connected twice", the very
  // shape the non-unique successorAccountId exists for) or two chain generations.
  // Exactly one copy may survive per (terminal, cycleEnd): the one from the source
  // with the LATEST cutover (the most recently authoritative provider), account-id
  // ascending as the tiebreak — so the coach cleared-streak never counts a cycle
  // twice and cash-needed's one-statement-per-card pick is order-independent.
  const rekeyChoice = new Map<string, { rowRef: BoundaryStatementRowLike; sourceId: string; sourceCut: ISODate }>();
  for (const s of input.statements) {
    if (!cutover.has(s.accountId)) continue;
    const to = remapToTerminal(s.accountId);
    const succMax = ownMaxCycleEnd.get(to);
    if (succMax !== undefined && compareDates(isoDate(s.cycleEnd), succMax) <= 0) continue;
    const key = `${to}:${s.cycleEnd}`;
    const cut = cutover.get(s.accountId) as ISODate;
    const cur = rekeyChoice.get(key);
    if (
      cur === undefined ||
      compareDates(cut, cur.sourceCut) > 0 ||
      (compareDates(cut, cur.sourceCut) === 0 && s.accountId < cur.sourceId)
    ) {
      rekeyChoice.set(key, { rowRef: s, sourceId: s.accountId, sourceCut: cut });
    }
  }

  return {
    paymentAccountId: input.paymentAccountId === null ? null : remapToTerminal(input.paymentAccountId),
    accounts,
    transactions: input.transactions.filter((t) => keepsTxn(t.accountId, t.date)),
    balanceSnapshots: input.balanceSnapshots.filter((b) => keepsSnapshot(b.accountId, b.date)),
    // R4: RE-KEY (not drop) the predecessor's statements onto the terminal successor, keeping
    // only those the successor does not already cover — a predecessor statement survives iff
    // its cycleEnd is NEWER than every statement the successor already has (or the successor
    // has none). This preserves the predecessor's CURRENT statement when the live successor
    // hasn't generated one yet (a fresh Plaid reconnect on the estimate path — else the real
    // due silently demotes to the successor's next-cycle estimate, dropping it from the
    // headline and the reminder window, critic cycle-2), while dropping the stale overlap
    // statements the live successor authoritatively owns (no double in the coach cleared-streak,
    // no stale override of the live due). cash-needed picks ONE current statement per card, so
    // re-keying never double-counts a due. Untouched rows keep identity.
    statements: input.statements.flatMap((s): S[] => {
      if (!cutover.has(s.accountId)) return [s];
      const to = remapToTerminal(s.accountId);
      const succMax = ownMaxCycleEnd.get(to);
      if (succMax !== undefined && compareDates(isoDate(s.cycleEnd), succMax) <= 0) return [];
      if (rekeyChoice.get(`${to}:${s.cycleEnd}`)?.rowRef !== s) return []; // A-F6 one copy per cycle
      return [{ ...s, accountId: to }];
    }),
    // F6: re-key the predecessor's scheduled rows onto the terminal successor so the
    // successor's payment-account filter finds them. Untouched rows keep identity.
    scheduled: input.scheduled.map((s) => {
      const to = remapToTerminal(s.accountId);
      return to === s.accountId ? s : { ...s, accountId: to };
    }),
    supersededAccountIds: links.map((l) => l.predecessorAccountId),
  };
}
