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
 *    undone without storing the original id). Double-count-safe because detected
 *    scheduled rows are full-replaced to a SINGLE payment account, so a re-keyed
 *    predecessor row never collides with an equivalent successor row.
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

  // Cycle guard: walk pred → succ edges; any link on OR leading into a cycle is
  // inert. With `predecessorAccountId` unique there is at most one outgoing edge
  // per node, so a simple visited-walk per link suffices and terminates.
  const succOf = new Map(structural.map((l) => [l.predecessorAccountId, l.successorAccountId]));
  const acyclic = structural.filter((l) => {
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
 * Chain traversal maps over EFFECTIVE links (slice-6 critic A-F1/A-F4): claims
 * and snapshot collisions must compose across a CHAIN (A→B→C), not just across
 * direct links — the terminal successor's deep backfill re-imports history the
 * ORIGINAL predecessor already holds, two links away, and a direct-only check
 * double-counted it. `upstreamsOf(X)` = every account whose chain of links leads
 * INTO X; `downstreamsOf(X)` = the chain from X to the terminal successor; the
 * terminal remap is the slice-3 payment-account/re-key walk. All cycle-free by
 * construction (effective links only), visited-guarded anyway.
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
  const { upstreamsOf, downstreamsOf, remapToTerminal } = chainMaps(links);
  const keepsTxn = txnKeepRule(links, cutover, txnSpan);

  // F3 rule for balance snapshots, composed transitively (A-F4): drop only on
  // an exact-date collision with a chain counterpart; the OLDER side's cutover
  // picks the winner — upstream wins on/before its cutover, downstream after.
  const keepsSnapshot = (accountId: string, date: string): boolean => {
    for (const p of upstreamsOf(accountId)) {
      const predHasDate = snapshotDates.get(p)?.has(date) ?? false;
      if (predHasDate && compareDates(isoDate(date), cutover.get(p) as ISODate) <= 0) return false;
    }
    const cutSelf = cutover.get(accountId);
    if (cutSelf !== undefined) {
      for (const s of downstreamsOf(accountId)) {
        const succHasDate = snapshotDates.get(s)?.has(date) ?? false;
        if (succHasDate && compareDates(isoDate(date), cutSelf) > 0) return false;
      }
    }
    return true;
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
