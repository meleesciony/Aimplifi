'use server';

/**
 * Manual transaction entry (cash, checks, anything a feed missed).
 * Session + account ownership verified; categorized through the same pipeline
 * as ingested rows; audit-logged. Balances are provider-authoritative and are
 * NOT mutated here (docs/DECISIONS.md).
 */
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { prepareManualTransaction } from '@/lib/engine/transactions/manual';
import { auditLog, requireUserId } from '@/server/authz';
import { loadUserRules } from '@/server/rules';

export async function createManualTransaction(formData: FormData): Promise<void> {
  const userId = await requireUserId();

  const accountId = String(formData.get('accountId') ?? '');
  const account = await prisma.account.findFirst({ where: { id: accountId, userId } });
  if (!account) throw new Error('Account not found');

  const categoryRaw = String(formData.get('categoryId') ?? '').trim();
  const rules = await loadUserRules(userId);
  const prepared = prepareManualTransaction(
    {
      descriptor: String(formData.get('descriptor') ?? ''),
      amount: String(formData.get('amount') ?? ''),
      direction: String(formData.get('direction') ?? 'out') === 'in' ? 'in' : 'out',
      date: String(formData.get('date') ?? ''),
      accountId,
      categoryId: categoryRaw || null,
    },
    rules,
  );

  await prisma.transaction.create({
    data: {
      accountId: prepared.accountId,
      date: prepared.date,
      amountCents: prepared.amountCents,
      rawDescriptor: prepared.rawDescriptor,
      categoryId: prepared.categoryId,
      confidenceBps: prepared.confidenceBps,
      status: prepared.status,
      needsReview: prepared.needsReview,
      isTransfer: prepared.isTransfer,
    },
  });

  await auditLog(userId, 'transaction.create.manual', {
    accountId,
    amountCents: prepared.amountCents,
    needsReview: prepared.needsReview,
  });

  revalidatePath('/transactions');
  revalidatePath('/triage');
  redirect('/transactions');
}
