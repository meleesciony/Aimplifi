'use server';

/**
 * Change a transaction's bank text, then re-match the row through the
 * same categorize pipeline ingest uses. Amount and date stay put.
 * Demo cannot learn.
 */
import { revalidatePath } from 'next/cache';
import { isUniqueViolation, prisma } from '@/lib/db';
import { isoDate } from '@/lib/dates';
import { getProvider } from '@/lib/providers/demo';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { categorize } from '@/lib/engine/categorize/pipeline';
import { shouldApplyRematchCategory, txnDescriptorError } from '@/lib/engine/transactions/descriptor';
import { auditLog, requireUserId } from '@/server/authz';
import { assertOwnedCategory } from '@/server/category-meta';
import { ensureCategories } from '@/server/ensure-categories';
import { refreshRecurringForUser } from '@/server/recurring';
import { loadUserRules } from '@/server/rules';
import { getThresholdTuning } from '@/server/tuning';
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

async function upsertMerchantForCanonical(canonical: string, categoryId: string): Promise<string> {
  try {
    const m = await prisma.merchant.upsert({
      where: { canonical },
      create: { canonical, defaultCategoryId: categoryId },
      update: {},
    });
    return m.id;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const existing = await prisma.merchant.findUnique({ where: { canonical }, select: { id: true } });
    if (!existing) throw e;
    return existing.id;
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

  const [rules, tuning] = await Promise.all([loadUserRules(userId), getThresholdTuning(userId)]);
  const out = categorize(
    {
      rawDescriptor: descriptor,
      amountCents: row.amountCents,
      date: row.date,
      accountId: row.accountId,
      currentTaxClass: row.taxClass,
    },
    rules,
    { flaggedBps: tuning.flaggedBps },
  );

  const merchantId = out.merchantCanonical
    ? await upsertMerchantForCanonical(out.merchantCanonical, out.categoryId)
    : row.merchantId;

  const applyCategory = shouldApplyRematchCategory(row, out);
  if (applyCategory) {
    await ensureCategories();
    await assertOwnedCategory(userId, out.categoryId);
  }

  await prisma.transaction.update({
    where: { id: row.id },
    data: {
      rawDescriptor: descriptor,
      merchantId,
      ...(applyCategory
        ? {
            categoryId: out.categoryId,
            confidenceBps: out.confidenceBps,
            needsReview: out.needsReview,
            reviewPinned: false,
            ...(out.categoryId === 'transfer' ? { isTransfer: true } : {}),
            ...(out.taxClassStamp ? { taxClass: out.taxClassStamp } : {}),
            ...(out.spendClassStamp ? { spendClassOverride: out.spendClassStamp } : {}),
          }
        : {}),
    },
  });
  await auditLog(userId, 'transaction.updateDescriptor', {
    transactionId: id,
    fromLength: row.rawDescriptor.length,
    toLength: descriptor.length,
    rematched: applyCategory,
    matchedRule: Boolean(out.matchedRuleId),
  });
  await refreshRecurringBestEffort(userId);
  revalidateTxnDescriptorSurfaces();
  return { ok: true };
}
