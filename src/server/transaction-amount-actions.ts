'use server';

/**
 * Change a transaction's amount. Integer cents. Sign stays with the row.
 * Splits refuse. Demo cannot learn. Balances stay provider-authoritative.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { parseDollarInput } from '@/lib/money';
import { isoDate } from '@/lib/dates';
import { getProvider } from '@/lib/providers/demo';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { auditLog, requireUserId } from '@/server/authz';
import { refreshRecurringForUser } from '@/server/recurring';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import {
  flippedTxnAmountCents,
  signedTxnAmountCents,
  txnAmountError,
} from '@/lib/engine/transactions/amount';
import { rematchAfterTxnWrite, rematchUpdateData } from '@/server/txn-rematch';

export interface TxnAmountResult {
  ok: boolean;
  error?: string;
  errors?: { amount?: string };
}

function revalidateTxnAmountSurfaces(): void {
  revalidatePath('/transactions');
  revalidatePath('/transactions/[id]', 'page');
  revalidatePath('/dashboard');
  revalidatePath('/spending-plan');
  revalidatePath('/reports');
  revalidatePath('/budgets');
  revalidatePath('/coach');
  revalidatePath('/triage');
  revalidatePath('/recurring');
}

async function refreshRecurringBestEffort(userId: string): Promise<void> {
  try {
    await refreshRecurringForUser(userId, isoDate(getProvider().today(userId)));
  } catch {
    // best-effort — the write already succeeded.
  }
}

export async function updateTransactionAmount(
  transactionId: string,
  formData: FormData,
): Promise<TxnAmountResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const id = typeof transactionId === 'string' ? transactionId.trim() : '';
  if (!id) {
    return { ok: false, error: "That transaction isn't on your list, so nothing changed." };
  }

  const raw = String(formData.get('amount') ?? '');
  const parsed = parseDollarInput(raw);
  const amountErr = txnAmountError(parsed);
  if (amountErr) return { ok: false, errors: { amount: amountErr } };
  const typed = parsed as number;

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
      amountCents: true,
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
      error: "A split's dollars stay on the parts — unsplit it first if you need to change the total.",
    };
  }

  const amountCents = signedTxnAmountCents(row.amountCents, typed);
  await prisma.transaction.update({
    where: { id: row.id },
    data: { amountCents },
  });
  await auditLog(userId, 'transaction.updateAmount', {
    transactionId: id,
    fromCents: row.amountCents,
    toCents: amountCents,
  });
  await refreshRecurringBestEffort(userId);
  revalidateTxnAmountSurfaces();
  return { ok: true };
}

export async function flipTransactionDirection(
  transactionId: string,
): Promise<TxnAmountResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const id = typeof transactionId === 'string' ? transactionId.trim() : '';
  if (!id) {
    return { ok: false, error: "That transaction isn't on your list, so nothing changed." };
  }

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
      amountCents: true,
      rawDescriptor: true,
      date: true,
      accountId: true,
      merchantId: true,
      categoryId: true,
      needsReview: true,
      taxClass: true,
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
      error: "A split's dollars stay on the parts — unsplit it first if you need to change the total.",
    };
  }

  const amountCents = flippedTxnAmountCents(row.amountCents);
  if (amountCents === null) {
    return {
      ok: false,
      error: row.amountCents === 0 ? "There's no amount to flip." : 'That amount is too large.',
    };
  }

  const rematch = await rematchAfterTxnWrite({
    userId,
    rawDescriptor: row.rawDescriptor,
    amountCents,
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
      amountCents,
      ...rematchUpdateData(rematch),
    },
  });
  await auditLog(userId, 'transaction.flipDirection', {
    transactionId: id,
    fromCents: row.amountCents,
    toCents: amountCents,
    rematched: rematch.applyCategory,
    matchedRule: rematch.matchedRule,
  });
  await refreshRecurringBestEffort(userId);
  revalidateTxnAmountSurfaces();
  return { ok: true };
}
