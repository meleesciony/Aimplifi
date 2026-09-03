/**
 * Re-match a transaction through the same categorize() pipeline ingest uses.
 * Shared by bank-text (#618) and in/out flip (#619). Not a server action.
 */
import { isUniqueViolation, prisma } from '@/lib/db';
import { categorize } from '@/lib/engine/categorize/pipeline';
import { shouldApplyRematchCategory } from '@/lib/engine/transactions/descriptor';
import { assertOwnedCategory } from '@/server/category-meta';
import { ensureCategories } from '@/server/ensure-categories';
import { loadUserRules } from '@/server/rules';
import { getThresholdTuning } from '@/server/tuning';

export interface RematchInput {
  userId: string;
  rawDescriptor: string;
  amountCents: number;
  date: string;
  accountId: string;
  merchantId: string | null;
  categoryId: string | null;
  needsReview: boolean;
  isSplitParent: boolean;
  taxClass: string | null;
}

export interface RematchWrite {
  merchantId: string | null;
  applyCategory: boolean;
  matchedRule: boolean;
  category?: {
    categoryId: string;
    confidenceBps: number;
    needsReview: boolean;
    reviewPinned: false;
    isTransfer?: true;
    taxClass?: string;
    spendClassOverride?: string;
  };
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

export async function rematchAfterTxnWrite(input: RematchInput): Promise<RematchWrite> {
  const [rules, tuning] = await Promise.all([
    loadUserRules(input.userId),
    getThresholdTuning(input.userId),
  ]);
  const out = categorize(
    {
      rawDescriptor: input.rawDescriptor,
      amountCents: input.amountCents,
      date: input.date,
      accountId: input.accountId,
      currentTaxClass: input.taxClass,
    },
    rules,
    { flaggedBps: tuning.flaggedBps },
  );

  const merchantId = out.merchantCanonical
    ? await upsertMerchantForCanonical(out.merchantCanonical, out.categoryId)
    : input.merchantId;

  const applyCategory = shouldApplyRematchCategory(input, out);
  if (applyCategory) {
    await ensureCategories();
    await assertOwnedCategory(input.userId, out.categoryId);
  }

  return {
    merchantId,
    applyCategory,
    matchedRule: Boolean(out.matchedRuleId),
    category: applyCategory
      ? {
          categoryId: out.categoryId,
          confidenceBps: out.confidenceBps,
          needsReview: out.needsReview,
          reviewPinned: false,
          ...(out.categoryId === 'transfer' ? { isTransfer: true as const } : {}),
          ...(out.taxClassStamp ? { taxClass: out.taxClassStamp } : {}),
          ...(out.spendClassStamp ? { spendClassOverride: out.spendClassStamp } : {}),
        }
      : undefined,
  };
}

export function rematchUpdateData(write: RematchWrite): {
  merchantId: string | null;
  categoryId?: string;
  confidenceBps?: number;
  needsReview?: boolean;
  reviewPinned?: false;
  isTransfer?: true;
  taxClass?: string;
  spendClassOverride?: string;
} {
  return {
    merchantId: write.merchantId,
    ...(write.category ?? {}),
  };
}
