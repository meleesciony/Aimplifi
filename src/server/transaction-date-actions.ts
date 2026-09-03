'use server';

/**
 * Change a transaction's date. YYYY-MM-DD. Demo cannot learn.
 * Balances stay provider-authoritative. Amount and payee stay put.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { isoDate } from '@/lib/dates';
import { getProvider } from '@/lib/providers/demo';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { auditLog, requireUserId } from '@/server/authz';
import { refreshRecurringForUser } from '@/server/recurring';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { txnDateError } from '@/lib/engine/transactions/date';

export interface TxnDateResult {
  ok: boolean;
  error?: string;
  errors?: { date?: string };
}

function revalidateTxnDateSurfaces(): void {
  revalidatePath('/transactions');
  revalidatePath('/transactions/[id]', 'page');
  revalidatePath('/dashboard');
  revalidatePath('/spending-plan');
  revalidatePath('/reports');
  revalidatePath('/budgets');
  revalidatePath('/coach');
  revalidatePath('/triage');
  revalidatePath('/recurring');
  revalidatePath('/calendar');
}

async function refreshRecurringBestEffort(userId: string): Promise<void> {
  try {
    await refreshRecurringForUser(userId, isoDate(getProvider().today(userId)));
  } catch {
    // best-effort — the write already succeeded.
  }
}

export async function updateTransactionDate(
  transactionId: string,
  formData: FormData,
): Promise<TxnDateResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const id = typeof transactionId === 'string' ? transactionId.trim() : '';
  if (!id) {
    return { ok: false, error: "That transaction isn't on your list, so nothing changed." };
  }

  const raw = String(formData.get('date') ?? '');
  const dateErr = txnDateError(raw);
  if (dateErr) return { ok: false, errors: { date: dateErr } };
  const date = isoDate(raw.trim());

  const row = await prisma.transaction.findFirst({
    where: {
      id,
      account: {
        userId,
        type: { in: [...SPENDING_ACCOUNT_TYPES] },
        OR: [{ currency: null }, { currency: 'USD' }],
      },
    },
    select: { id: true, date: true, amountCents: true },
  });
  if (!row) {
    return { ok: false, error: "That transaction isn't on your list, so nothing changed." };
  }

  await prisma.transaction.update({
    where: { id: row.id },
    data: { date },
  });
  await auditLog(userId, 'transaction.updateDate', {
    transactionId: id,
    fromDate: row.date,
    toDate: date,
  });
  await refreshRecurringBestEffort(userId);
  revalidateTxnDateSurfaces();
  return { ok: true };
}
