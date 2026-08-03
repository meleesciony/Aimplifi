'use server';

/**
 * The write path for the two O.15 row flags: exclude-from-totals and the
 * reimbursement tracker. Shipped in the same slice as the columns (L.22 — a
 * persisted field with no control that writes it is a dead branch).
 *
 * Mutation-form recipe: `{ ok, error }`, never a throw for an expected refusal.
 * Every refusal the menu shows as a disabled reason is ENFORCED here too — a
 * disabled menu item is one dev-tools edit away from a submitted form, and the
 * server, not the UI, owns the money rules.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { auditLog, requireUserId } from '@/server/authz';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { getCategoryMeta } from '@/server/category-meta';
import { getRecurringBillMerchantCanonicals } from '@/server/recurring-bill-merchants';
import { guessSpendClass } from '@/lib/engine/spending-plan/spend-class';
import { reimbursementState } from '@/lib/engine/transactions/reimbursement';
import { rowOrigin } from '@/lib/engine/transactions/origin';
import {
  EXCLUDE_BLOCKED_SPLIT_PARENT,
  EXCLUDE_BLOCKED_TRANSFER,
  REIMBURSE_BLOCKED_INFLOW,
  REIMBURSE_BLOCKED_SPLIT_PARENT,
  REIMBURSE_BLOCKED_TRANSFER,
  STATUS_BLOCKED_BANK_OWNED,
  STATUS_BLOCKED_INFLOW,
  STATUS_BLOCKED_SPLIT_CHILD,
  STATUS_BLOCKED_SPLIT_PARENT,
} from '@/lib/engine/transactions/actions';

export type FlagActionResult = { ok: true } | { ok: false; error: string };

/** Every surface an exclusion (or its undo) can move a figure on. */
function revalidateTotals(): void {
  revalidatePath('/transactions');
  revalidatePath('/dashboard');
  revalidatePath('/budgets');
  revalidatePath('/reports');
  revalidatePath('/trends');
  revalidatePath('/coach');
}

/**
 * The row facts both actions gate on, ownership-scoped. Null = not the
 * caller's row (indistinguishable from absent, on purpose).
 */
async function ownedRow(userId: string, transactionId: string) {
  if (typeof transactionId !== 'string' || transactionId.trim() === '') return null;
  return prisma.transaction.findFirst({
    where: { id: transactionId, account: { userId } },
    select: {
      id: true,
      amountCents: true,
      isTransfer: true,
      isSplitParent: true,
      // O.15 slice 7: the status action's facts. `providerRef` + the account's
      // provider are what `rowOrigin` decides ownership from — the ROW, never the
      // account alone (O.13b critic cycle 2).
      status: true,
      splitParentId: true,
      providerRef: true,
      account: { select: { provider: true } },
    },
  });
}

/**
 * Set or clear `excludeFromTotals`. Undoable by construction: the same call
 * with `exclude: false` restores every figure, because no total stores a
 * derived value — they all re-read the flag through one predicate
 * (src/lib/engine/transactions/exclude.ts).
 */
export async function setExcludeFromTotals(input: {
  transactionId: string;
  exclude: boolean;
}): Promise<FlagActionResult> {
  const userId = await requireUserId();
  // Shared-demo fence: one visitor's exclusion would silently rewrite every
  // other visitor's budgets/reports — the demo's hand-verified totals are the
  // product surface itself.
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const row = await ownedRow(userId, input.transactionId);
  if (!row) return { ok: false, error: 'That transaction is no longer available — nothing was changed.' };
  // The same sentences the menu shows disabled — imported, not re-typed, so
  // the screen and the wire can never drift apart. Guarded only when EXCLUDING
  // (P1-3 asymmetry): clearing the flag must always work, because transfer
  // detection can re-flag a row after the reader excluded it, and an undo
  // locked behind the very state that made it necessary is no undo at all.
  if (input.exclude === true) {
    if (row.isSplitParent) return { ok: false, error: EXCLUDE_BLOCKED_SPLIT_PARENT };
    if (row.isTransfer) return { ok: false, error: EXCLUDE_BLOCKED_TRANSFER };
  }

  await prisma.transaction.update({
    where: { id: row.id },
    data: { excludeFromTotals: input.exclude === true },
  });
  await auditLog(userId, 'transaction.excludeFromTotals.set', {
    transactionId: row.id,
    exclude: input.exclude === true,
  });
  revalidateTotals();
  return { ok: true };
}

/**
 * Set the reimbursement state: 'awaiting' | 'received' | null (stop tracking).
 * Purely informational — no sum changes (locked by tests/unit/reimbursement
 * .test.ts) — so the only money rule here is eligibility: only a real purchase
 * (an outflow that is not a transfer or a split container) can be owed back.
 */
export async function setReimbursement(input: {
  transactionId: string;
  state: string | null;
}): Promise<FlagActionResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  if (input.state !== null && reimbursementState(input.state) === null) {
    return { ok: false, error: 'That is not a reimbursement state Aimplifi knows — nothing was saved.' };
  }

  const row = await ownedRow(userId, input.transactionId);
  if (!row) return { ok: false, error: 'That transaction is no longer available — nothing was changed.' };
  if (input.state !== null) {
    if (row.isSplitParent) return { ok: false, error: REIMBURSE_BLOCKED_SPLIT_PARENT };
    if (row.isTransfer) return { ok: false, error: REIMBURSE_BLOCKED_TRANSFER };
    if (row.amountCents >= 0) return { ok: false, error: REIMBURSE_BLOCKED_INFLOW };
  }

  await prisma.transaction.update({
    where: { id: row.id },
    data: { reimbursement: input.state },
  });
  await auditLog(userId, 'transaction.reimbursement.set', {
    transactionId: row.id,
    state: input.state,
  });
  // The tracker line lives on /coach; the badge on /transactions.
  revalidatePath('/transactions');
  revalidatePath('/coach');
  return { ok: true };
}

/**
 * Set `status` by hand — O.13g, Simplifi parity row 13 ("Pending / Cleared
 * editable by the user").
 *
 * This slice does NOT change what PENDING means: every one of the ~11 gates that
 * read it already handles a pending row, because providers deliver them. It
 * widens only WHO MAY WRITE the value, and only to rows no feed owns — so the
 * blast radius is this function, not the read surfaces.
 *
 * The refusals are the menu's own sentences, imported rather than re-typed.
 */
export async function setTransactionStatus(input: {
  transactionId: string;
  status: string;
}): Promise<FlagActionResult> {
  const userId = await requireUserId();
  // Same shared-demo fence as its two siblings: the demo's hand-verified totals
  // are the product surface, and status moves several of them.
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  if (input.status !== 'PENDING' && input.status !== 'POSTED') {
    return { ok: false, error: 'That is not a status Aimplifi knows — nothing was saved.' };
  }

  const row = await ownedRow(userId, input.transactionId);
  if (!row) return { ok: false, error: 'That transaction is no longer available — nothing was changed.' };

  // Every refusal below is BOTH directions, and each mirrors the menu exactly —
  // the sentences are imported, never re-typed.
  //
  // 1. A fed row: the bank is the authority on whether its own charge cleared.
  if (rowOrigin({ providerRef: row.providerRef, accountProvider: row.account.provider }) === 'bank') {
    return { ok: false, error: STATUS_BLOCKED_BANK_OWNED };
  }
  // 2. A split PIECE. `splitTransaction` gives children no `providerRef`, so a
  //    piece of a BANK charge would pass the check above while both providers
  //    push the parent's status onto its children on every sync — the write would
  //    be silently reverted. Refused before the container check because a piece is
  //    the shape that reaches this action in the wild.
  if (row.splitParentId !== null) return { ok: false, error: STATUS_BLOCKED_SPLIT_CHILD };
  if (row.isSplitParent) return { ok: false, error: STATUS_BLOCKED_SPLIT_PARENT };
  // 3. Money in. The pending sum is SIGNED, so a pending inflow ADDS to today's
  //    projected cash — a typed "expected paycheck" would cancel the dashboard's
  //    transfer instruction. Refused rather than disclosed (see STATUS_BLOCKED_INFLOW).
  if (row.amountCents >= 0) return { ok: false, error: STATUS_BLOCKED_INFLOW };

  await prisma.transaction.update({ where: { id: row.id }, data: { status: input.status } });
  await auditLog(userId, 'transaction.status.set', {
    transactionId: row.id,
    from: row.status,
    to: input.status,
  });
  // Status moves more surfaces than an exclusion does: bill DETECTION (/recurring),
  // the savings rate and Merchant Lens (/coach, /transactions), and cash-needed
  // (/dashboard). The projection pages are revalidated because they read the
  // detector's output — but note this does NOT rebuild the stored
  // `ScheduledTransaction` rows (no `refreshRecurringForUser` call here); those
  // refresh on the next sync or manual-entry hook, the same as every other
  // detection input. Stated rather than implied (critic A, P3).
  revalidateTotals();
  revalidatePath('/recurring');
  revalidatePath('/calendar');
  revalidatePath('/forecast');
  return { ok: true };
}

/**
 * #397: the reader's per-TRANSACTION Fixed/Discretionary verdict — 'fixed' |
 * 'guilt-free' | null (clear, back to the app's guess). Per-row by owner
 * directive: flipping one transaction never moves its category siblings.
 *
 * A choice equal to the guess stores NULL — the guess (recurring-bill
 * merchant → fixed, else the category's taxonomy flag) stays the source of
 * truth until the reader actually disagrees, and a re-guess after a recategorize
 * or a new recurring series can never strand a stale verdict that happens to
 * agree. The row's eligibility is the engine's own `guessSpendClass`: an
 * out-of-scope row (transfer, card payment, inflow, uncategorized…) refuses,
 * the same answer the register's read-only badge gives.
 */
export async function setTransactionSpendClass(input: {
  transactionId: string;
  spendClass: string | null;
}): Promise<FlagActionResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };
  if (input.spendClass !== null && input.spendClass !== 'fixed' && input.spendClass !== 'guilt-free') {
    return { ok: false, error: 'That is not a spend class Aimplifi knows — nothing was saved.' };
  }

  const row = await prisma.transaction.findFirst({
    where: { id: input.transactionId, account: { userId } },
    select: {
      id: true,
      date: true,
      amountCents: true,
      rawDescriptor: true,
      accountId: true,
      isTransfer: true,
      status: true,
      categoryId: true,
      isSplitParent: true,
      splitParentId: true,
      excludeFromTotals: true,
    },
  });
  if (!row) return { ok: false, error: 'That transaction is no longer available — nothing was changed.' };

  const [meta, fixedMerchants] = await Promise.all([
    getCategoryMeta(userId),
    getRecurringBillMerchantCanonicals(userId),
  ]);
  const guess = guessSpendClass(row, meta, fixedMerchants);
  if (guess === 'out-of-scope') {
    return { ok: false, error: 'That row is not part of Fixed vs Discretionary spending — nothing was saved.' };
  }

  const stored = input.spendClass === guess ? null : input.spendClass;
  await prisma.transaction.update({
    where: { id: row.id },
    data: { spendClassOverride: stored },
  });
  await auditLog(userId, 'transaction.spendClass.set', {
    transactionId: row.id,
    spendClass: input.spendClass,
    stored,
  });
  // The class moves the Plan's Fixed figure and the /budgets lists.
  revalidateTotals();
  revalidatePath('/spending-plan');
  return { ok: true };
}
