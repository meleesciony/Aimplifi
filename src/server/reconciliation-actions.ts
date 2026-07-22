'use server';

/**
 * Cross-provider account reconciliation — server-action wrappers (TASKS Wave 4.6 slice 2).
 *
 * Thin `'use server'` shell over the NextAuth-free core in server/reconciliation.ts: resolve the
 * session user, inject the provider `today`, then delegate. Audit + revalidate only on success,
 * logging the in-tx-resolved link id — never raw attacker input (the household-actions idiom).
 */
import { revalidatePath } from 'next/cache';
import { businessToday } from '@/lib/business-today';
import { auditLog, requireUserId } from '@/server/authz';
import {
  type ConfirmReconciliationInput,
  type ConfirmReconciliationResult,
  type UndoReconciliationResult,
  confirmReconciliationFor,
  undoReconciliationFor,
} from '@/server/reconciliation';

export async function confirmReconciliation(
  input: ConfirmReconciliationInput,
): Promise<ConfirmReconciliationResult> {
  const userId = await requireUserId();
  const result = await confirmReconciliationFor(userId, input, businessToday(userId));
  if (result.ok) {
    await auditLog(userId, 'reconciliation.confirm', { reconciliationId: result.id });
    revalidatePath('/accounts');
  }
  return result;
}

export async function undoReconciliation(
  reconciliationId: string,
): Promise<UndoReconciliationResult> {
  const userId = await requireUserId();
  const result = await undoReconciliationFor(userId, reconciliationId);
  if (result.ok) {
    await auditLog(userId, 'reconciliation.undo', { reconciliationId });
    revalidatePath('/accounts');
  }
  return result;
}
