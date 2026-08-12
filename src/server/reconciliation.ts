/**
 * Cross-provider account reconciliation — confirm / undo core (TASKS Wave 4.6 slice 2;
 * docs/PROVIDER_RECONCILIATION_ARCHITECTURE.md §4/§8, invariants R7/R9/R10).
 *
 * This module MUTATES the `AccountReconciliation` link table but does NOT itself change
 * any money figure: it records the user's confirmed decision that two `Account` rows are
 * the same real account (predecessor = stale/disconnected, successor = live). The assembler
 * (slice 3) reads active links once and applies the balance-exclusion + date-split there, so
 * every downstream engine inherits the boundary unchanged. Slice-2 tests therefore prove the
 * ACTION contract (authz, TOCTOU, direction, reversibility, cutover bounds); the aggregation
 * invariants R1/R2 land with the assembler.
 *
 * Kept NextAuth-free (takes `userId` + an injected `today`) so it runs under vitest against
 * the real Prisma client, exactly like server/account-delete.ts. The thin `'use server'`
 * wrapper that pulls the session lives in server/reconciliation-actions.ts.
 */
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { type ISODate, compareDates, isoDate } from '@/lib/dates';
import { DEMO_RECONCILE_BLOCKED, isDemoUser } from '@/lib/demo-user';
import type { DuplicateConfidence, ReconciliationMatchSignal } from '@/lib/engine/account/duplicates';
import {
  accountIdentityMap,
  effectiveReconciliationLinks,
  reconciliationHandoverDates,
  reconciliationTxnKeepFilter,
  terminalSuccessorMap,
} from '@/lib/engine/account/reconcile-boundary';
import { isSupportedCurrency } from '@/lib/providers/currency';

export interface ConfirmReconciliationInput {
  predecessorAccountId: string;
  successorAccountId: string;
  cutoverDate: string; // YYYY-MM-DD
  matchSignal: string; // 'mask' | 'balance' | 'name' (validated here)
  confidence: string; // 'high' | 'medium' (validated here)
}

export type ConfirmReconciliationResult =
  /** `autoUndoneReverseId`: the reverse link (this successor as someone's predecessor) that this
   *  confirm dissolved in the same transaction — surfaced so the wrapper can audit-log the
   *  dissolution instead of it happening silently (slice-6 critic B-F5). */
  { ok: true; id: string; autoUndoneReverseId: string | null } | { ok: false; error: string };
export type UndoReconciliationResult = { ok: true } | { ok: false; error: string };

/** The shape slice 3's assembler and slice 5's advisory-suppression consume. */
export interface ActiveReconciliation {
  id: string;
  predecessorAccountId: string;
  successorAccountId: string;
  cutoverDate: string;
}

const MATCH_SIGNALS: ReadonlySet<string> = new Set<ReconciliationMatchSignal>([
  'persistent',
  'mask',
  'balance',
  'name',
]);
const CONFIDENCES: ReadonlySet<string> = new Set<DuplicateConfidence>(['high', 'medium']);

// One generic "not found" for every ownership / scalar-shape refusal — no cross-user oracle
// (a wrong id must be indistinguishable from another user's id), matching account-delete.ts.
const NOT_FOUND = 'Account not found.';

/**
 * Whether an account row still has a LIVE provider connection. This is the SAME derivation the
 * slice-5 caller will use to feed `hasLiveConnection` into the candidate detector, so the
 * proposal and this confirm-time guard can never disagree
 * (docs/lessons/a-guard-must-read-what-it-guards). `SimpleFinConnection` is per-USER (one row),
 * so every SimpleFIN account is live iff that connection exists; a Plaid account is live iff its
 * stamped `plaidItemId` still resolves to an existing `PlaidItem`; manual / demo / unknown
 * providers are never a live sync source (a manual row is predecessor-eligible by design, §4).
 *
 * DELIBERATE conservatism (slice-6 critic B-F7): a broken-but-present connection (e.g. a
 * PlaidItem with `lastSyncError` set) still counts as LIVE. For the R3 money guard that is the
 * only safe direction — treating broken-as-live can only REFUSE a reconciliation ("both still
 * connected" / continuing into it), never zero a balance that is actually live; the refusal
 * message tells the user to disconnect the broken item first, which also clears this state.
 */
export function isAccountLive(
  account: { provider: string; plaidItemId: string | null },
  conns: { simplefinConnected: boolean; plaidItemIds: ReadonlySet<string> },
): boolean {
  switch (account.provider) {
    case 'plaid':
      return account.plaidItemId != null && conns.plaidItemIds.has(account.plaidItemId);
    case 'simplefin':
      return conns.simplefinConnected;
    default:
      return false;
  }
}

/**
 * Confirm a reconciliation: link a stale predecessor to a live successor. Never automatic —
 * only ever called from an explicit user confirm. Idempotent + re-activation-safe via upsert on
 * the `predecessorAccountId @unique` slot: re-confirming (including after an undo) updates the
 * one row and clears `undoneAt`, so R9's round-trip and a later re-link both work without a
 * unique-constraint crash.
 *
 * TOCTOU-closed (R10, #219 idiom): both account ids are re-resolved scoped to `userId` INSIDE the
 * transaction, and liveness is re-derived from the live connection rows in the same transaction —
 * a pre-check snapshot is never trusted. Refuses unless the direction is exactly
 * predecessor=stale, successor=live (R3), because zeroing a still-live balance would fabricate a
 * wrong net worth.
 */
export async function confirmReconciliationFor(
  userId: string,
  input: ConfirmReconciliationInput,
  today: ISODate,
): Promise<ConfirmReconciliationResult> {
  if (isDemoUser(userId)) return { ok: false, error: DEMO_RECONCILE_BLOCKED };

  const { predecessorAccountId, successorAccountId, matchSignal, confidence } = input;
  // 'use server' endpoints take attacker-shaped input: refuse non-scalar args before any query.
  if (
    typeof predecessorAccountId !== 'string' ||
    typeof successorAccountId !== 'string' ||
    typeof input.cutoverDate !== 'string' ||
    typeof matchSignal !== 'string' ||
    typeof confidence !== 'string'
  ) {
    return { ok: false, error: NOT_FOUND };
  }
  if (predecessorAccountId === successorAccountId) {
    return { ok: false, error: 'An account can’t be reconciled with itself.' };
  }
  if (!MATCH_SIGNALS.has(matchSignal) || !CONFIDENCES.has(confidence)) {
    return { ok: false, error: 'That reconciliation signal isn’t recognized.' };
  }
  let cutover: ISODate;
  try {
    cutover = isoDate(input.cutoverDate);
  } catch {
    return { ok: false, error: 'The cutover date isn’t a valid calendar date.' };
  }
  // Cutover ≤ today is date-only and needs no DB read, so check it up front.
  if (compareDates(cutover, today) > 0) {
    return { ok: false, error: 'The cutover date can’t be in the future.' };
  }

  // SERIALIZABLE (slice-6 critics B-F3/B-F4): two racing confirms in opposite directions
  // (A→B ∥ B→A under a connection flap) or onto adjacent chain links each pass their OWN
  // liveness reads, auto-undo scans, and monotonicity checks under READ COMMITTED — neither
  // sees the other's uncommitted row, and both commit, leaving a cycle or a non-monotone
  // chain the write-time guards never saw. Under SERIALIZABLE the read/write overlap is a
  // detected conflict: exactly one transaction aborts (P2034, surfaced as a retryable
  // error). SQLite serializes writes anyway; the read-time engine guards (cycle +
  // monotonicity inertness) remain as defense in depth for historical rows.
  let result: ConfirmReconciliationResult;
  try {
    result = await prisma.$transaction(async (tx): Promise<ConfirmReconciliationResult> => {
    const [pred, succ] = await Promise.all([
      tx.account.findFirst({
        where: { id: predecessorAccountId, userId },
        select: { id: true, provider: true, plaidItemId: true, type: true, currency: true, displayName: true },
      }),
      tx.account.findFirst({
        where: { id: successorAccountId, userId },
        select: { id: true, provider: true, plaidItemId: true, type: true, currency: true, displayName: true },
      }),
    ]);
    // Either id not owned by this user → generic not-found (R10: no cross-user oracle).
    if (!pred || !succ) return { ok: false, error: NOT_FOUND };

    // Same-type only (slice 3): the boundary engine signs balance-snapshot history by
    // account TYPE, so a cross-type link (e.g. CHECKING→CREDIT) would sign-flip the
    // predecessor's contribution in the net-worth series. The #192 detector never
    // proposes cross-type pairs; a crafted request is refused here, and the read-time
    // engine additionally treats any such stored link as inert.
    if (pred.type !== succ.type) {
      return { ok: false, error: 'Those accounts aren’t the same kind, so they can’t be the same account.' };
    }

    // Same-currency only (slice 4, critic cycle-2): the SAME real account can't be USD in
    // one provider and another currency in the other, and a currency-withheld side is inert
    // in the boundary — a crafted cross-currency link would be inert personally but, without
    // this guard, marked superseded by the household exclusion, hiding a real shared account.
    // The #192 detector never proposes a cross-currency pair; refuse it at the source too.
    if ((pred.currency ?? 'USD').toUpperCase() !== (succ.currency ?? 'USD').toUpperCase()) {
      return { ok: false, error: 'Those accounts are in different currencies, so they can’t be the same account.' };
    }

    const [sfConn, plaidItems, firstTxn] = await Promise.all([
      tx.simpleFinConnection.findUnique({ where: { userId }, select: { id: true } }),
      tx.plaidItem.findMany({ where: { userId }, select: { itemId: true } }),
      tx.transaction.findFirst({
        where: { accountId: predecessorAccountId },
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
    ]);
    const conns = {
      simplefinConnected: sfConn !== null,
      plaidItemIds: new Set(plaidItems.map((i) => i.itemId)),
    };

    // R3 at the confirm boundary: successor = the LIVE side we continue into; predecessor = the
    // stale side whose balance stops counting. Any other direction is refused — the detector never
    // proposes it, and a crafted request that zeroed a still-live balance would be a money-integrity
    // bug (a fabricated net worth), the exact harm §2 forbids.
    if (!isAccountLive(succ, conns)) {
      return {
        ok: false,
        error: 'The account you’re continuing into isn’t connected, so there’s nothing live to reconcile to.',
      };
    }
    if (isAccountLive(pred, conns)) {
      return {
        ok: false,
        error: 'Both accounts are still connected — disconnect the old one first, then reconcile.',
      };
    }

    // Cutover must sit within the predecessor's real history: never before its first transaction
    // (would strand pre-cutover rows nothing owns). Stored dates are already validated YYYY-MM-DD.
    if (firstTxn && compareDates(cutover, isoDate(firstTxn.date)) < 0) {
      return { ok: false, error: 'The cutover date can’t be before the old account’s first transaction.' };
    }

    // Chain monotonicity (slice-3 critic F9): in a chain Q→P→S each generation's window starts
    // where the previous ended, so the downstream cutover must be ≥ every upstream one. A new
    // downstream link with an EARLIER cutover would open a window ((new cutover, upstream cutover])
    // that both the oldest and newest generation keep — a silent double-count behind a "reconciled"
    // label. Refused here at creation; since slice 6 the engine ALSO treats a non-monotone chain
    // link as inert at read time (effectiveReconciliationLinks), so a racing/historical row can
    // never open the window. Upstream links = active links whose successor is THIS predecessor.
    const upstream = await tx.accountReconciliation.findFirst({
      where: { userId, successorAccountId: predecessorAccountId, undoneAt: null },
      orderBy: { cutoverDate: 'desc' },
      select: { cutoverDate: true },
    });
    if (upstream && compareDates(cutover, isoDate(upstream.cutoverDate)) < 0) {
      return {
        ok: false,
        error: 'The cutover date can’t be earlier than this account’s previous reconciliation.',
      };
    }

    // Direction-conflict auto-undo (slice 3): an ACTIVE link claiming THIS successor is
    // someone's stale predecessor (X→S) is provably wrong now — we just re-derived S as
    // LIVE inside this transaction. Left in place, A→B + B→A active together would zero
    // BOTH balances and drop a real account from net worth entirely. Undo the reverse
    // link (reversible, ordinary undoneAt), never delete it. Chains (Q→P→S) are NOT
    // conflicts: a link whose SUCCESSOR is our predecessor stays. The dissolved link's id
    // is captured first and returned so the wrapper can audit-log it (critic B-F5) —
    // rewriting a user's earlier confirmed decision must leave a trail.
    const reverse = await tx.accountReconciliation.findFirst({
      where: { userId, predecessorAccountId: successorAccountId, undoneAt: null },
      select: { id: true },
    });
    if (reverse) {
      await tx.accountReconciliation.updateMany({
        where: { id: reverse.id, undoneAt: null },
        data: { undoneAt: new Date() },
      });
    }

    const row = await tx.accountReconciliation.upsert({
      where: { predecessorAccountId },
      create: { userId, predecessorAccountId, successorAccountId, cutoverDate: cutover, matchSignal, confidence },
      update: {
        successorAccountId,
        cutoverDate: cutover,
        matchSignal,
        confidence,
        undoneAt: null,
        confirmedByUserAt: new Date(),
      },
    });
    // The user's own name follows the ACCOUNT, not the connection (TASKS L.7, critic F5) —
    // the rule the combine transaction already applies to autopay. The predecessor's row stops
    // counting, so a nickname left on it is orphaned: the surviving row would revert to the
    // string the bank sends, which is precisely the name he renamed away from, while the
    // "Combined accounts" card beneath it still shows the name he chose. Carried only onto a
    // successor with none of its own — his own name on the live row always wins.
    if (pred.displayName && !succ.displayName) {
      await tx.account.update({ where: { id: succ.id }, data: { displayName: pred.displayName } });
    }

    return { ok: true, id: row.id, autoUndoneReverseId: reverse?.id ?? null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (e) {
    // P2034 = write conflict / deadlock under SERIALIZABLE — the race's designated loser.
    // Clean retryable refusal; the winner's state is consistent and the UI reloads it.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
      return { ok: false, error: 'That change collided with another update — reload and try again.' };
    }
    throw e;
  }
  // The direction-conflict auto-undo above un-supersedes an account exactly the
  // way the explicit undo does, so it owes the same backfill re-arm — otherwise
  // the history a backfill refused while the wrong-direction link was active
  // stays permanently unreachable on precisely the repair flow that fixes the
  // direction (Plaid-mirror critic P1-1, executed). AFTER the transaction: a
  // re-arm inside it would roll back with a conflict loser, and best-effort
  // writes do not belong under SERIALIZABLE.
  if (result.ok && result.autoUndoneReverseId != null) {
    await rearmHistoryBackfills(userId);
  }
  return result;
}

/**
 * Re-arm both providers' deep-history backfills after a link stops superseding an
 * account. An un-superseded account is writable history again, and BOTH backfills
 * (SimpleFIN, H.5; Plaid, its mirror) refuse to write to superseded predecessors —
 * so a connection/item that finished (or skipped) its backfill while the link was
 * active may now be owed one. The backfills are add-only and idempotent, so the
 * worst case is one wasted plan that comes back empty and re-marks itself done;
 * without the re-arm, a backfill would have to treat "every account superseded" as
 * a permanent retry, paying a years-wide fetch and an audit row on every sync
 * forever (H.5 critic cycle 3, P1-1). Unconditional across providers by accepted
 * stance (H.5 cycle-4 P2, recorded open): scoping to the predecessor's provider
 * would save one wasted fetch on the other side and is not worth a second query
 * shape. Best-effort: no undo may fail over re-arming a backfill.
 *
 * ONE AUTHOR for every un-supersede EVENT the server performs — the explicit undo
 * AND `confirmReconciliationFor`'s direction-conflict auto-undo (critic of the
 * Plaid mirror, P1-1: the auto-undo un-superseded without re-arming, stranding the
 * skipped history behind a set flag on exactly the fix-the-direction repair flow).
 * The un-supersede paths NO write performs (successor deletion; feed-driven
 * type/currency drift) are the recorded STATUS open — a state-derived redesign,
 * not another call site of this helper.
 */
async function rearmHistoryBackfills(userId: string): Promise<void> {
  await prisma.simpleFinConnection
    .updateMany({ where: { userId }, data: { historyBackfilledAt: null } })
    .catch(() => {});
  await prisma.plaidItem
    .updateMany({ where: { userId }, data: { historyBackfilledAt: null } })
    .catch(() => {});
}

/**
 * Undo a reconciliation (R9): sets `undoneAt` so the link is inert and both rows count fully
 * again. Scoped `where: { id, userId }` is the authz — another user's id matches zero rows and
 * returns the same generic not-found. Only acts on an ACTIVE link (`undoneAt: null`); undoing an
 * already-undone one is a no-op reported as not-found (the UI only offers Undo on active links).
 */
export async function undoReconciliationFor(
  userId: string,
  reconciliationId: string,
): Promise<UndoReconciliationResult> {
  if (isDemoUser(userId)) return { ok: false, error: DEMO_RECONCILE_BLOCKED };
  if (typeof reconciliationId !== 'string') return { ok: false, error: 'Reconciliation not found.' };

  const res = await prisma.accountReconciliation.updateMany({
    where: { id: reconciliationId, userId, undoneAt: null },
    data: { undoneAt: new Date() },
  });
  if (res.count === 0) return { ok: false, error: 'Reconciliation not found.' };
  await rearmHistoryBackfills(userId);
  return { ok: true };
}

/** Active (not-undone) reconciliations for a user — the assembler + advisory-suppression input. */
export async function getActiveReconciliations(userId: string): Promise<ActiveReconciliation[]> {
  return prisma.accountReconciliation.findMany({
    where: { userId, undoneAt: null },
    select: { id: true, predecessorAccountId: true, successorAccountId: true, cutoverDate: true },
    orderBy: { confirmedByUserAt: 'asc' },
  });
}

/**
 * Predecessor account ids of ACTIVE reconciliations owned by the given users, whose
 * successor account still exists (Wave 4.6 slice 4, R5). A superseded predecessor is NOT
 * part of any household-shared set: the live successor is the single account the household
 * sees, so the stale predecessor must not double-count in a partner's joint cash-needed /
 * digest nor appear as a separate row in the shared-accounts list or register.
 *
 * The personal assembler already handles the OWNER's own view (zeroes the predecessor,
 * splits its rows); this exclusion is for the SEPARATE, Prisma-direct household read paths
 * that never touch the assembler (`getSharedSnapshotSlice`, `getAccountSharingView`,
 * `getSharedTransactionsView`, `getHouseholdDigestContext`, `getHouseholdDuplicateCandidates`,
 * and the slice-6 `recategorizeSharedTransaction` write-guard). Every one of those SANCTIONED
 * shared-set reads (household-authz.ts) must apply it; the `household reconciliation follows
 * the successor` integration test drives a real reconciled+shared pair through all of them so
 * a missed site fails loudly.
 *
 * EXACT ASSEMBLER PARITY (docs/lessons/a-guard-must-read-what-it-guards, critic cycle-2): run
 * the SAME `effectiveReconciliationLinks` rule on the SAME currency-supported account set the
 * boundary uses (`getFinanceSnapshot` runs it on `supportedAccounts`). A link the personal
 * view treats as INERT — a deleted or currency-withheld side, a cross-type pair, or a cycle —
 * is never treated as effective here, so the household view can NEVER hide a predecessor the
 * owner still counts fully (which would under-count / vanish a real shared account). Confirm
 * refuses cross-type/cross-currency/reverse shapes at write time; this is defense in depth
 * against a historical/racing/crafted row, exactly as the boundary itself guards them at read.
 */
export async function activeSupersededPredecessorIds(userIds: readonly string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const [links, accounts] = await Promise.all([
    prisma.accountReconciliation.findMany({
      where: { userId: { in: [...userIds] }, undoneAt: null },
      select: { predecessorAccountId: true, successorAccountId: true, cutoverDate: true },
    }),
    prisma.account.findMany({
      where: { userId: { in: [...userIds] } },
      select: { id: true, type: true, currency: true, currentBalanceCents: true },
    }),
  ]);
  if (links.length === 0) return new Set();
  const supported = accounts.filter((a) => isSupportedCurrency(a.currency));
  return new Set(effectiveReconciliationLinks(supported, links).map((l) => l.predecessorAccountId));
}

/**
 * Superseded predecessor id → the LIVE account that carries its money now, on the
 * exact same effectiveness basis as `activeSupersededPredecessorIds` above (its
 * key set is identical, so a caller needing both reads one query pair, not two).
 *
 * Exists because excluding a predecessor is only half a boundary (L.26): a row
 * DERIVED from the predecessor's history — a detected recurring series, whose
 * account is the account of its most recent kept charge — is not a ghost to drop
 * but a live obligation to re-key, exactly as `applyReconciliationBoundary` re-keys
 * a predecessor's scheduled rows onto its terminal successor (F6). Dropped instead,
 * it becomes an uncounted bill: see refreshRecurringForUser.
 */
export async function activeTerminalSuccessorMap(userId: string): Promise<Map<string, string>> {
  const [links, accounts] = await Promise.all([
    prisma.accountReconciliation.findMany({
      where: { userId, undoneAt: null },
      select: { predecessorAccountId: true, successorAccountId: true, cutoverDate: true },
    }),
    prisma.account.findMany({
      where: { userId },
      select: { id: true, type: true, currency: true, currentBalanceCents: true },
    }),
  ]);
  if (links.length === 0) return new Map();
  return terminalSuccessorMap(accounts.filter((a) => isSupportedCurrency(a.currency)), links);
}

/**
 * Account id → the id of the REAL account it is part of, for callers asking
 * about IDENTITY rather than about money (H.7 cycle-2 critic P1-1).
 *
 * Unlike `activeTerminalSuccessorMap` above, this does NOT filter through
 * `effectiveReconciliationLinks`, and the difference is the whole point: that
 * rule fails OPEN on an ambiguous link shape because for a money surface the
 * failure is a visible double, whereas for the transfer sweep an inert link
 * means one real account silently pairs with itself and true money leaves every
 * total. Feed-driven type/currency drift makes a confirmed link inert on an
 * ordinary sync (both providers rewrite `Account.type` unconditionally), so this
 * is not a crafted-data concern. See `accountIdentityMap` for the full argument.
 */
export async function activeAccountIdentityMap(userId: string): Promise<Map<string, string>> {
  const links = await prisma.accountReconciliation.findMany({
    where: { userId, undoneAt: null },
    select: { predecessorAccountId: true, successorAccountId: true, cutoverDate: true },
  });
  if (links.length === 0) return new Map();
  return accountIdentityMap(links);
}

/**
 * The R1 ownership filter for WINDOWED Prisma-direct transaction surfaces (slice-6 critics
 * B-F1/C-1/C-2/C-3): the register, CSV export, budgets month query, recurring re-detection,
 * and triage read transactions directly rather than through the assembler, so a reconciled
 * pair's overlap rows double-counted there while the dashboard counted them once. This
 * returns the IDENTICAL keep rule the assembler applies (shared engine closure — a-guard-
 * must-read-what-it-guards), built from: the user's active links, the currency-supported
 * account set (exact `activeSupersededPredecessorIds` parity), and each linked predecessor's
 * FULL-history min/max transaction dates (an aggregate — never the surface's own windowed
 * rows, which would move the claim edge). With no active links: a constant-true fast path,
 * zero extra queries beyond the link lookup (R8).
 */
export async function getReconciliationTxnKeep(userId: string): Promise<(accountId: string, date: string) => boolean> {
  const links = await getActiveReconciliations(userId);
  if (links.length === 0) return () => true;
  const accounts = await prisma.account.findMany({
    where: { userId },
    select: { id: true, type: true, currency: true, currentBalanceCents: true },
  });
  const predIds = links.map((l) => l.predecessorAccountId);
  const spans = await prisma.transaction.groupBy({
    by: ['accountId'],
    where: { accountId: { in: predIds }, account: { userId } },
    _min: { date: true },
    _max: { date: true },
  });
  return reconciliationTxnKeepFilter(
    accounts.filter((a) => isSupportedCurrency(a.currency)),
    links,
    spans.flatMap((s) =>
      s._min.date != null && s._max.date != null ? [{ accountId: s.accountId, first: s._min.date, last: s._max.date }] : [],
    ),
  );
}

/**
 * The dates on which two connections were handing over, where BOTH sides' rows are kept
 * (U.13). A surface that reports totals a reader will act on — the tax export above all,
 * whose file leaves the app entirely — uses this to disclose that a charge both connections
 * reported appears twice on those days. Built from the same links/spans as the keep filter
 * and computed by the engine, never re-derived here.
 */
export async function getReconciliationHandoverDates(userId: string): Promise<ReadonlySet<string>> {
  const links = await getActiveReconciliations(userId);
  if (links.length === 0) return new Set<string>();
  const accounts = await prisma.account.findMany({
    where: { userId },
    select: { id: true, type: true, currency: true, currentBalanceCents: true },
  });
  const spans = await prisma.transaction.groupBy({
    by: ['accountId'],
    where: { accountId: { in: links.map((l) => l.predecessorAccountId) }, account: { userId } },
    _min: { date: true },
    _max: { date: true },
  });
  return reconciliationHandoverDates(
    accounts.filter((a) => isSupportedCurrency(a.currency)),
    links,
    spans.flatMap((s) =>
      s._min.date != null && s._max.date != null ? [{ accountId: s.accountId, first: s._min.date, last: s._max.date }] : [],
    ),
  );
}

/**
 * Whether a manual write (manual entry, CSV import) may target this account (slice-6
 * critics B-F2/C-4): a row hand-typed onto a superseded PREDECESSOR dated after its
 * cutover is dropped by the boundary — money the user entered that no figure reflects, a
 * silent dropped figure. Superseded predecessors are read-only history: refuse ALL manual
 * writes to them (any date — pre-cutover writes would silently rewrite claimed history the
 * successor can never see either) and point at the successor / Undo instead. Evaluated on
 * the same effective-links basis as the boundary.
 */
export async function refuseManualWriteToSuperseded(
  userId: string,
  accountId: string,
): Promise<string | null> {
  const superseded = await activeSupersededPredecessorIds([userId]);
  if (!superseded.has(accountId)) return null;
  return 'This account was combined into its connected successor — add transactions there, or undo the combination on the Accounts page first.';
}
