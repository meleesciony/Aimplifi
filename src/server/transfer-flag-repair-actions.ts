'use server';

/**
 * H.7b — the transfer-flag repair's form actions. Thin: authz + demo fence +
 * the core (server/transfer-flag-repair.ts), then revalidate every surface a
 * transfer mark moves a figure on. Mutation-form recipe: `{ ok, error }`,
 * never a throw for an expected refusal.
 */
import { revalidatePath } from 'next/cache';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { auditLog, requireUserId } from '@/server/authz';
import {
  applyTransferFlagRepair,
  undoTransferFlagRepair,
  type TransferFlagRepairApplyResult,
  type TransferFlagRepairUndoResult,
} from '@/server/transfer-flag-repair';

/** Every surface a transfer mark (or its clearing) can move a figure on. */
function revalidateTransferTotals(): void {
  revalidatePath('/transactions');
  revalidatePath('/dashboard');
  revalidatePath('/budgets');
  revalidatePath('/reports');
  revalidatePath('/trends');
  revalidatePath('/coach');
  revalidatePath('/spending-plan');
  revalidatePath('/settings');
}

export async function applyTransferFlagRepairAction(): Promise<TransferFlagRepairApplyResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) {
    return {
      ok: false,
      cleared: 0,
      skipped: 0,
      inflowCents: 0,
      outflowCents: 0,
      runId: null,
      error: DEMO_ENTRY_BLOCKED,
    };
  }
  const result = await applyTransferFlagRepair(userId);
  revalidateTransferTotals();
  return result;
}

export async function undoTransferFlagRepairAction(
  formData: FormData,
): Promise<TransferFlagRepairUndoResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) {
    return { ok: false, restored: 0, skipped: 0, error: DEMO_ENTRY_BLOCKED };
  }
  const runId = String(formData.get('runId') ?? '');
  if (runId === '') {
    // A malformed form, not an expected user state — refuse without touching data.
    await auditLog(userId, 'transfers.flag-repair-undo.refused', { reason: 'missing runId' });
    return { ok: false, restored: 0, skipped: 0, error: 'Missing repair run.' };
  }
  const result = await undoTransferFlagRepair(userId, runId);
  revalidateTransferTotals();
  return result;
}
