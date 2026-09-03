'use server';

/**
 * Change a transaction's bank text, then re-match the row through the
 * same categorize pipeline ingest uses. Amount and date stay put.
 * Demo cannot learn.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { isoDate } from '@/lib/dates';
import { getProvider } from '@/lib/providers/demo';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { txnDescriptorError } from '@/lib/engine/transactions/descriptor';
import { auditLog, requireUserId } from '@/server/authz';
import { refreshRecurringForUser } from '@/server/recurring';
import { rematchAfterTxnWrite, rematchUpdateData } from '@/server/txn-rematch';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';

export interface TxnDescriptorResult {
  ok: boolean;
  error?: string;
  errors?: { descriptor?: string };
}

function revalidateTxnDescriptorSurfaces(): void {
  revalidatePath('/transactions');
  revalidatePath('/transactions/[id]', 'page');
  revalidatePath('/dashboard');
  revalidatePath('/spending-plan');
  revalidatePath('/reports');
  revalidatePath('/budgets');
  revalidatePath('/coach');
  revalidatePath('/triage');
  revalidatePath('/recurring');
  revalidatePath('/rules');
}

async function refreshRecurringBestEffort(userId: string): Promise<void> {
  try {
    await refreshRecurringForUser(userId, isoDate(getProvider().today(userId)));
  } catch {
    // best-effort — the write already succeeded.
  }
}

export async function updateTransactionDescriptor(
  transactionId: string,
  formData: FormData,
): Promise<TxnDescriptorResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const id = typeof transactionId === 'string' ? transactionId.trim() : '';
  if (!id) {
    return { ok: false, error: "That transaction isn't on your list, so nothing changed." };
  }

  const raw = String(formData.get('descriptor') ?? '');
  const descErr = txnDescriptorError(raw);
  if (descErr) return { ok: false, errors: { descriptor: descErr } };
  const descriptor = raw.trim();

  const row = await prisma.transaction.findFirst({
    where: {
      id,
      account: {
        userId,
        type: { in: [...SPENDING_ACCOUNT_TYPES] },
        OR: [{ currency: null }, { currency: 'USD' }],
      },
    },
    select: {
      id: true,
      rawDescriptor: true,
      amountCents: true,
      date: true,
      accountId: true,
      merchantId: true,
      categoryId: true,
      needsReview: true,
      isSplitParent: true,
      taxClass: true,
    },
  });
  if (!row) {
    return { ok: false, error: "That transaction isn't on your list, so nothing changed." };
  }

  const rematch = await rematchAfterTxnWrite({
    userId,
    rawDescriptor: descriptor,
    amountCents: row.amountCents,
    date: row.date,
    accountId: row.accountId,
    merchantId: row.merchantId,
    categoryId: row.categoryId,
    needsReview: row.needsReview,
    isSplitParent: row.isSplitParent,
    taxClass: row.taxClass,
  });

  await prisma.transaction.update({
    where: { id: row.id },
    data: {
      rawDescriptor: descriptor,
      ...rematchUpdateData(rematch),
    },
  });
  await auditLog(userId, 'transaction.updateDescriptor', {
    transactionId: id,
    fromLength: row.rawDescriptor.length,
    toLength: descriptor.length,
    rematched: rematch.applyCategory,
    matchedRule: rematch.matchedRule,
  });
  await refreshRecurringBestEffort(userId);
  revalidateTxnDescriptorSurfaces();
  return { ok: true };
}
