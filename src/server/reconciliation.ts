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
import { prisma } from '@/lib/db';
import { type ISODate, compareDates, isoDate } from '@/lib/dates';
import { DEMO_RECONCILE_BLOCKED, isDemoUser } from '@/lib/demo-user';
import type { DuplicateConfidence, ReconciliationMatchSignal } from '@/lib/engine/account/duplicates';
import { effectiveReconciliationLinks } from '@/lib/engine/account/reconcile-boundary';
import { isSupportedCurrency } from '@/lib/providers/currency';

export interface ConfirmReconciliationInput {
  predecessorAccountId: string;
  successorAccountId: string;
  cutoverDate: string; // YYYY-MM-DD
  matchSignal: string; // 'mask' | 'balance' | 'name' (validated here)
  confidence: string; // 'high' | 'medium' (validated here)
}

export type ConfirmReconciliationResult = { ok: true; id: string } | { ok: false; error: string };
export type UndoReconciliationResult = { ok: true } | { ok: false; error: string };

/** The shape slice 3's assembler and slice 5's advisory-suppression consume. */
export interface ActiveReconciliation {
  id: string;
  predecessorAccountId: string;
  successorAccountId: string;
  cutoverDate: string;
}

const MATCH_SIGNALS: ReadonlySet<string> = new Set<ReconciliationMatchSignal>(['mask', 'balance', 'name']);
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

  return prisma.$transaction(async (tx): Promise<ConfirmReconciliationResult> => {
    const [pred, succ] = await Promise.all([
      tx.account.findFirst({
        where: { id: predecessorAccountId, userId },
        select: { id: true, provider: true, plaidItemId: true, type: true, currency: true },
      }),
      tx.account.findFirst({
        where: { id: successorAccountId, userId },
        select: { id: true, provider: true, plaidItemId: true, type: true, currency: true },
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
    // label. The engine composes DIRECT links only (deliberately — transitive claims would turn the
    // read path into graph analysis), so the misordered shape is refused at the only place it can
    // be created. Upstream links = active links whose successor is THIS predecessor.
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
    // conflicts: a link whose SUCCESSOR is our predecessor stays.
    await tx.accountReconciliation.updateMany({
      where: { userId, predecessorAccountId: successorAccountId, undoneAt: null },
      data: { undoneAt: new Date() },
    });

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
    return { ok: true, id: row.id };
  });
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
