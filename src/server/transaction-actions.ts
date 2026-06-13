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
import {
  parseTransactionCsv,
  prepareImportedTransaction,
} from '@/lib/engine/transactions/csv-import';
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

export interface ImportResult {
  ok: boolean;
  imported: number;
  skipped: number;
  errors: string[];
}

/**
 * Bulk CSV import (useActionState shape). Parses, categorizes each row through
 * the standard pipeline, and inserts the valid ones; malformed rows are skipped
 * and reported by line number. Like manual entry, this records activity only —
 * it does not mutate account balances (DECISIONS #24).
 */
export async function importTransactionsCsv(
  _prev: ImportResult | null,
  formData: FormData,
): Promise<ImportResult> {
  const userId = await requireUserId();

  const accountId = String(formData.get('accountId') ?? '');
  const account = await prisma.account.findFirst({ where: { id: accountId, userId } });
  if (!account) return { ok: false, imported: 0, skipped: 0, errors: ['Account not found'] };

  const text = String(formData.get('csv') ?? '');
  if (!text.trim()) {
    return { ok: false, imported: 0, skipped: 0, errors: ['Paste CSV content first.'] };
  }

  const { rows, errors } = parseTransactionCsv(text);
  const rules = await loadUserRules(userId);
  const data = rows.map((row) => {
    const p = prepareImportedTransaction(row, accountId, rules);
    return {
      accountId,
      date: p.date,
      amountCents: p.amountCents,
      rawDescriptor: p.rawDescriptor,
      categoryId: p.categoryId,
      confidenceBps: p.confidenceBps,
      status: p.status,
      needsReview: p.needsReview,
      isTransfer: p.isTransfer,
    };
  });

  if (data.length > 0) await prisma.transaction.createMany({ data });

  await auditLog(userId, 'transaction.import.csv', {
    accountId,
    imported: data.length,
    skipped: errors.length,
  });
  revalidatePath('/transactions');
  revalidatePath('/triage');

  return {
    ok: data.length > 0,
    imported: data.length,
    skipped: errors.length,
    errors: errors.map((e) => `Line ${e.line}: ${e.message}`),
  };
}
