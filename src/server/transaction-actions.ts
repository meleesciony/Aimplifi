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
import { pickAssistedCategory } from '@/lib/engine/categorize/llm';
import { auditLog, requireUserId } from '@/server/authz';
import { assistUnsureRows } from '@/server/categorize-assist';
import { suggestCategoryViaLLM } from '@/server/llm-categorize';
import { loadUserRules } from '@/server/rules';
import { assertOwnedCategory, getCustomCategories } from '@/server/category-meta';

export async function createManualTransaction(formData: FormData): Promise<void> {
  const userId = await requireUserId();

  const accountId = String(formData.get('accountId') ?? '');
  const account = await prisma.account.findFirst({ where: { id: accountId, userId } });
  if (!account) throw new Error('Account not found');

  const categoryRaw = String(formData.get('categoryId') ?? '').trim();
  // An EXPLICIT category must be a known system id or a custom this user owns —
  // a foreign/garbage id would otherwise be trusted into the row (DECISIONS #111).
  // Auto-detect (empty) skips this; the pipeline only yields system ids.
  if (categoryRaw) await assertOwnedCategory(userId, categoryRaw);
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

  // When the user didn't dictate a category, let the optional LLM assist an
  // UNKNOWN merchant (DECISIONS #38). No ANTHROPIC_API_KEY → null → the
  // deterministic result stands unchanged (demo-mode invariant).
  let categoryId = prepared.categoryId;
  let confidenceBps = prepared.confidenceBps;
  let needsReview = prepared.needsReview;
  if (!categoryRaw) {
    const llm = await suggestCategoryViaLLM({
      rawDescriptor: prepared.rawDescriptor,
      amountCents: prepared.amountCents,
    });
    const picked = pickAssistedCategory(
      {
        categoryId: prepared.categoryId ?? 'uncategorized',
        confidenceBps: prepared.confidenceBps ?? 0,
        needsReview: prepared.needsReview,
      },
      llm,
    );
    categoryId = picked.categoryId;
    confidenceBps = picked.confidenceBps;
    if (picked.source === 'llm') needsReview = false; // a confident LLM pick auto-files
  }

  await prisma.transaction.create({
    data: {
      accountId: prepared.accountId,
      date: prepared.date,
      amountCents: prepared.amountCents,
      rawDescriptor: prepared.rawDescriptor,
      categoryId,
      confidenceBps,
      status: prepared.status,
      needsReview,
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

  // A CSV "category" column may name one of the user's custom categories ("Golf");
  // resolve those to their id too, alongside the system names (DECISIONS #111).
  const custom = await getCustomCategories(userId);
  const customByName = new Map(custom.map((c) => [c.name.toLowerCase(), c.id]));
  const { rows, errors } = parseTransactionCsv(text, customByName);
  const rules = await loadUserRules(userId);
  const prepared = rows.map((row) => {
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

  // LLM-assist unsure rows at ingest (DECISIONS #42): a confident suggestion
  // auto-files instead of landing in review. No ANTHROPIC_API_KEY → suggest
  // returns null → rows unchanged (demo stays deterministic + credential-free).
  const data = await assistUnsureRows(prepared, suggestCategoryViaLLM);

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
