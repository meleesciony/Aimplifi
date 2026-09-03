'use server';

/**
 * Rename a payee from a transaction. Overlay only: no CategorizationRule,
 * no Merchant.canonical write, no merchantId change. Demo cannot learn.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { auditLog, requireUserId } from '@/server/authz';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { payeeRenameKey } from '@/lib/engine/transactions/display-name';
import { MAX_PAYEE_KEY, payeeNameError } from '@/lib/engine/transactions/payee-rename';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';

export interface PayeeRenameResult {
  ok: boolean;
  error?: string;
  errors?: { name?: string };
}

function revalidatePayeeSurfaces(): void {
  revalidatePath('/transactions');
  revalidatePath('/transactions/[id]', 'page');
  revalidatePath('/dashboard');
  revalidatePath('/coach');
  revalidatePath('/reports');
  revalidatePath('/trends');
  revalidatePath('/budgets');
  revalidatePath('/triage');
}

export async function renamePayee(
  transactionId: string,
  formData: FormData,
): Promise<PayeeRenameResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const id = typeof transactionId === 'string' ? transactionId.trim() : '';
  if (!id) {
    return { ok: false, error: "That transaction isn't on your list, so nothing changed." };
  }

  const name = String(formData.get('name') ?? '');
  const nameErr = payeeNameError(name);
  if (nameErr) return { ok: false, errors: { name: nameErr } };
  const trimmed = name.trim();

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
      merchant: { select: { canonical: true } },
    },
  });
  if (!row) {
    return { ok: false, error: "That transaction isn't on your list, so nothing changed." };
  }

  const key = payeeRenameKey(row).slice(0, MAX_PAYEE_KEY);
  if (!key) {
    return { ok: false, error: "That transaction isn't on your list, so nothing changed." };
  }

  await prisma.payeeRename.upsert({
    where: { userId_payeeKey: { userId, payeeKey: key } },
    create: { userId, payeeKey: key, name: trimmed },
    update: { name: trimmed },
  });
  await auditLog(userId, 'payee.rename', { transactionId: id, payeeKey: key, length: trimmed.length });
  revalidatePayeeSurfaces();
  return { ok: true };
}
