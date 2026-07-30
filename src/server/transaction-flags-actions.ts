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
import { reimbursementState } from '@/lib/engine/transactions/reimbursement';
import {
  EXCLUDE_BLOCKED_SPLIT_PARENT,
  EXCLUDE_BLOCKED_TRANSFER,
  REIMBURSE_BLOCKED_INFLOW,
  REIMBURSE_BLOCKED_SPLIT_PARENT,
  REIMBURSE_BLOCKED_TRANSFER,
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
    select: { id: true, amountCents: true, isTransfer: true, isSplitParent: true },
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
