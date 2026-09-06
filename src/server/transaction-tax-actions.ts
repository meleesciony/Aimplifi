'use server';

/**
 * Update ONLY a transaction's taxClass. note stays put.
 *
 * Detail still uses setTransactionTax (note + taxClass together). Home needs a
 * tax-only path so saving a recent-charge tax tag cannot clear the note.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { auditLog, requireUserId } from '@/server/authz';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { isTaxClass } from '@/lib/engine/tax/classes';

export interface TxnTaxClassResult {
  ok: boolean;
  error?: string;
  errors?: { taxClass?: string };
}

export async function updateTransactionTaxClass(
  transactionId: string,
  formData: FormData,
): Promise<TxnTaxClassResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const id = typeof transactionId === 'string' ? transactionId.trim() : '';
  if (!id) {
    return { ok: false, error: "That transaction isn't on your list, so nothing changed." };
  }

  const raw = String(formData.get('taxClass') ?? '').trim();
  // Empty / Untagged → null. Any non-empty value must be a known class.
  const taxClass = raw === '' ? null : raw;
  if (taxClass !== null && !isTaxClass(taxClass)) {
    return {
      ok: false,
      errors: {
        taxClass: 'That is not a tax category Aimplifi knows — nothing was saved.',
      },
    };
  }

  // Ownership through the account. updateMany keeps the check and the write one
  // statement. data touches the taxClass column only — the companion memo column is intentionally omitted.
  const written = await prisma.transaction.updateMany({
    where: { id, account: { userId } },
    data: { taxClass },
  });
  if (written.count === 0) {
    return { ok: false, error: "That transaction isn't on your list, so nothing changed." };
  }

  await auditLog(userId, 'transaction.taxClass.set', {
    transactionId: id,
    taxClass,
  });

  revalidatePath('/dashboard');
  revalidatePath('/transactions');
  // Settings lists the years there is something to export for.
  revalidatePath('/settings');
  return { ok: true };
}
