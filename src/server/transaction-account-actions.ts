'use server';

/**
 * Change a transaction's account. Splits refuse. Demo cannot learn.
 * Balances stay provider-authoritative. Amount and date stay put.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { isoDate } from '@/lib/dates';
import { getProvider } from '@/lib/providers/demo';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { auditLog, requireUserId } from '@/server/authz';
import { refreshRecurringForUser } from '@/server/recurring';
import { refuseManualWriteToSuperseded } from '@/server/reconciliation';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { txnAccountError } from '@/lib/engine/transactions/account';

export interface TxnAccountResult {
  ok: boolean;
  error?: string;
  errors?: { accountId?: string };
}

function revalidateTxnAccountSurfaces(): void {
  revalidatePath('/transactions');
  revalidatePath('/transactions/[id]', 'page');
  revalidatePath('/dashboard');
  revalidatePath('/spending-plan');
  revalidatePath('/reports');
  revalidatePath('/budgets');
  revalidatePath('/coach');
  revalidatePath('/triage');
  revalidatePath('/recurring');
  revalidatePath('/accounts');
}

async function refreshRecurringBestEffort(userId: string): Promise<void> {
  try {
    await refreshRecurringForUser(userId, isoDate(getProvider().today(userId)));
  } catch {
    // best-effort — the write already succeeded.
  }
}

export async function updateTransactionAccount(
  transactionId: string,
  formData: FormData,
): Promise<TxnAccountResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const id = typeof transactionId === 'string' ? transactionId.trim() : '';
  if (!id) {
    return { ok: false, error: "That transaction isn't on your list, so nothing changed." };
  }

  const accountId = String(formData.get('accountId') ?? '');
  const accountErr = txnAccountError(accountId);
  if (accountErr) return { ok: false, errors: { accountId: accountErr } };

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
      accountId: true,
      amountCents: true,
      date: true,
      isSplitParent: true,
      splitParentId: true,
    },
  });
  if (!row) {
    return { ok: false, error: "That transaction isn't on your list, so nothing changed." };
  }
  if (row.isSplitParent || row.splitParentId) {
    return {
      ok: false,
      error: 'A split stays on one account — unsplit it first if you need to move the dollars.',
    };
  }
  if (row.accountId === accountId.trim()) return { ok: true };

  const dest = await prisma.account.findFirst({
    where: {
      id: accountId.trim(),
      userId,
      type: { in: [...SPENDING_ACCOUNT_TYPES] },
      OR: [{ currency: null }, { currency: 'USD' }],
    },
    select: { id: true },
  });
  if (!dest) {
    return { ok: false, errors: { accountId: "That account isn’t on your list, so nothing changed." } };
  }
  const supersededRefusal = await refuseManualWriteToSuperseded(userId, dest.id);
  if (supersededRefusal) return { ok: false, error: supersededRefusal };

  await prisma.transaction.update({
    where: { id: row.id },
    data: { accountId: dest.id },
  });
  await auditLog(userId, 'transaction.updateAccount', {
    transactionId: id,
    fromAccountId: row.accountId,
    toAccountId: dest.id,
  });
  await refreshRecurringBestEffort(userId);
  revalidateTxnAccountSurfaces();
  return { ok: true };
}
