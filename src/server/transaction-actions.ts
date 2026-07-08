'use server';

/**
 * Manual transaction entry (cash, checks, anything a feed missed).
 * Session + account ownership verified; categorized through the same pipeline
 * as ingested rows; audit-logged. Balances are provider-authoritative and are
 * NOT mutated here (docs/DECISIONS.md).
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { type PreparedTxn, prepareManualTransaction } from '@/lib/engine/transactions/manual';
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

export interface AddTxnResult {
  ok: boolean;
  /** Inline field errors surfaced under the form (never the app error boundary). */
  errors?: string[];
}

export async function createManualTransaction(
  _prev: AddTxnResult | null,
  formData: FormData,
): Promise<AddTxnResult> {
  const userId = await requireUserId();

  const accountId = String(formData.get('accountId') ?? '');
  const categoryRaw = String(formData.get('categoryId') ?? '').trim();
  const descriptor = String(formData.get('descriptor') ?? '');
  const amount = String(formData.get('amount') ?? '');
  const dateStr = String(formData.get('date') ?? '');
  const direction = String(formData.get('direction') ?? 'out') === 'in' ? 'in' : 'out';

  const account = await prisma.account.findFirst({ where: { id: accountId, userId } });
  if (!account) return { ok: false, errors: ['That account wasn’t found — refresh and try again.'] };

  // An EXPLICIT category must be a known system id or a custom this user owns —
  // a foreign/garbage id would otherwise be trusted into the row (DECISIONS #111).
  // Auto-detect (empty) skips this; the pipeline only yields system ids.
  if (categoryRaw) {
    try {
      await assertOwnedCategory(userId, categoryRaw);
    } catch (e) {
      // assertOwnedCategory throws exactly 'Choose a valid category' for a
      // not-owned id; anything else (e.g. a DB blip) is unexpected — don't
      // mislabel it "category not found" (#170 P2).
      return e instanceof Error && e.message === 'Choose a valid category'
        ? { ok: false, errors: ['That category wasn’t found — pick one from the list.'] }
        : { ok: false, errors: ['Something went wrong — please try again.'] };
    }
  }
  const rules = await loadUserRules(userId);

  // prepareManualTransaction validates the amount/date/description and THROWS on
  // bad input — a non-numeric or non-positive amount, a malformed date. Those are
  // reachable from the form (the amount box is free text), so catch them into an
  // inline field error instead of letting them hit the app error boundary
  // (#170 — finishing the reliable-mutation pass; matches the goal/budget forms).
  let prepared: PreparedTxn;
  try {
    prepared = prepareManualTransaction(
      {
        descriptor,
        amount,
        direction,
        date: dateStr,
        accountId,
        categoryId: categoryRaw || null,
      },
      rules,
      // The engine re-checks ids for defense in depth but only knows the system
      // set; a custom id is a per-user cuid. Pass exactly the one id that
      // assertOwnedCategory just verified above (regression #136).
      categoryRaw ? new Set([categoryRaw]) : undefined,
    );
  } catch (e) {
    // Map the engine's (sometimes technical) validation throws to a friendly,
    // non-leaky hint. Amount is the only free-form numeric input; date is a
    // native date picker but can still be cleared/malformed.
    const msg = e instanceof Error ? e.message : '';
    const friendly = /amount/i.test(msg)
      ? 'Enter a positive dollar amount, like 12.50.'
      : /date/i.test(msg)
        ? 'Enter a valid calendar date.'
        : 'Please check your entries and try again.';
    return { ok: false, errors: [friendly] };
  }

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
  // Return success; the client navigates to /transactions (a full navigation, so
  // the register can't show stale state) — NOT a server redirect, so the form
  // stays a plain onSubmit + reload recipe like GoalForm (#170).
  return { ok: true };
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
