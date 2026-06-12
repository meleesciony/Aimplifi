'use server';

/**
 * Triage server actions. Every mutation:
 *  - re-verifies the session and row ownership (userId scoping),
 *  - records a Correction (corrections are append-only, reversible events),
 *  - is undoable (undo writes the INVERSE correction; created rules are removed).
 */
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getTriageItems, type TriageItem } from '@/server/triage';

async function requireUserId(): Promise<string> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) throw new Error('Unauthorized');
  return id;
}

async function ownedTransaction(userId: string, transactionId: string) {
  const txn = await prisma.transaction.findFirst({
    where: { id: transactionId, account: { userId } },
  });
  if (!txn) throw new Error('Transaction not found');
  return txn;
}

export interface ApplyResult {
  correctionIds: string[];
  ruleId: string | null;
  affected: number;
}

/** Accept the suggestion or pick a category for one transaction. */
export async function applyCategory(input: {
  transactionId: string;
  categoryId: string;
  /** "Always" → durable merchant rule, with provenance back to the correction. */
  always?: boolean;
}): Promise<ApplyResult> {
  const userId = await requireUserId();
  const txn = await ownedTransaction(userId, input.transactionId);

  const correction = await prisma.correction.create({
    data: {
      userId,
      transactionId: txn.id,
      fromCategoryId: txn.categoryId,
      toCategoryId: input.categoryId,
    },
  });

  let ruleId: string | null = null;
  if (input.always && txn.merchantId) {
    const rule = await prisma.categorizationRule.create({
      data: {
        userId,
        merchantId: txn.merchantId,
        categoryId: input.categoryId,
        priority: 100,
        createdFrom: correction.id,
      },
    });
    ruleId = rule.id;
    await prisma.correction.update({
      where: { id: correction.id },
      data: { becameRuleId: rule.id },
    });
  }

  await prisma.transaction.update({
    where: { id: txn.id },
    data: { categoryId: input.categoryId, needsReview: false, confidenceBps: 9900 },
  });

  revalidatePath('/triage');
  return { correctionIds: [correction.id], ruleId, affected: 1 };
}

/** Create a durable rule from an already-recorded correction (one-tap "Always"). */
export async function makeRuleFromCorrection(correctionId: string): Promise<{ ruleId: string | null }> {
  const userId = await requireUserId();
  const correction = await prisma.correction.findFirst({ where: { id: correctionId, userId } });
  if (!correction) throw new Error('Correction not found');
  if (correction.becameRuleId) return { ruleId: correction.becameRuleId };
  const txn = await ownedTransaction(userId, correction.transactionId);
  if (!txn.merchantId) return { ruleId: null };
  const rule = await prisma.categorizationRule.create({
    data: {
      userId,
      merchantId: txn.merchantId,
      categoryId: correction.toCategoryId,
      priority: 100,
      createdFrom: correction.id,
    },
  });
  await prisma.correction.update({ where: { id: correction.id }, data: { becameRuleId: rule.id } });
  return { ruleId: rule.id };
}

/** Batch: apply a category to every review-queued transaction of the same merchant. */
export async function applyToAllSimilar(input: {
  transactionId: string;
  categoryId: string;
}): Promise<ApplyResult> {
  const userId = await requireUserId();
  const txn = await ownedTransaction(userId, input.transactionId);
  if (!txn.merchantId) return applyCategory({ ...input });

  const targets = await prisma.transaction.findMany({
    where: { merchantId: txn.merchantId, needsReview: true, account: { userId } },
  });
  const correctionIds: string[] = [];
  for (const t of targets) {
    const c = await prisma.correction.create({
      data: { userId, transactionId: t.id, fromCategoryId: t.categoryId, toCategoryId: input.categoryId },
    });
    correctionIds.push(c.id);
  }
  const rule = await prisma.categorizationRule.create({
    data: {
      userId,
      merchantId: txn.merchantId,
      categoryId: input.categoryId,
      priority: 100,
      createdFrom: correctionIds[0],
    },
  });
  await prisma.transaction.updateMany({
    where: { id: { in: targets.map((t) => t.id) } },
    data: { categoryId: input.categoryId, needsReview: false, confidenceBps: 9900 },
  });

  revalidatePath('/triage');
  return { correctionIds, ruleId: rule.id, affected: targets.length };
}

/** Split a transaction into parts (long-press flow). Parts must sum exactly. */
export async function splitTransaction(input: {
  transactionId: string;
  parts: { amountCents: number; categoryId: string }[];
}): Promise<{ childIds: string[] }> {
  const userId = await requireUserId();
  const txn = await ownedTransaction(userId, input.transactionId);
  const sum = input.parts.reduce((s, p) => s + p.amountCents, 0);
  if (sum !== txn.amountCents) {
    throw new Error(`Split parts must sum to the original amount (${txn.amountCents}¢), got ${sum}¢`);
  }
  if (input.parts.length < 2) throw new Error('A split needs at least 2 parts');

  const children = await Promise.all(
    input.parts.map((p) =>
      prisma.transaction.create({
        data: {
          accountId: txn.accountId,
          date: txn.date,
          amountCents: p.amountCents,
          rawDescriptor: txn.rawDescriptor,
          merchantId: txn.merchantId,
          categoryId: p.categoryId,
          confidenceBps: 9900,
          status: txn.status,
          needsReview: false,
          isTransfer: txn.isTransfer,
          splitParentId: txn.id,
        },
      }),
    ),
  );
  // Parent becomes a container: out of review, transfer-like (excluded from sums).
  await prisma.transaction.update({
    where: { id: txn.id },
    data: { needsReview: false, categoryId: null, confidenceBps: null },
  });

  revalidatePath('/triage');
  return { childIds: children.map((c) => c.id) };
}

/** Undo a split: remove children, put the parent back in review. Returns the fresh queue. */
export async function undoSplit(transactionId: string): Promise<TriageItem[]> {
  const userId = await requireUserId();
  await ownedTransaction(userId, transactionId);
  await prisma.transaction.deleteMany({ where: { splitParentId: transactionId } });
  await prisma.transaction.update({
    where: { id: transactionId },
    data: { needsReview: true },
  });
  revalidatePath('/triage');
  return getTriageItems(userId);
}

/**
 * Undo corrections: write the INVERSE correction (append-only history), restore
 * each transaction to review, and remove any rule the correction created.
 * Returns the fresh queue so the client can restore without a reload.
 */
export async function undoCorrections(correctionIds: string[]): Promise<TriageItem[]> {
  const userId = await requireUserId();
  for (const id of correctionIds) {
    const correction = await prisma.correction.findFirst({ where: { id, userId } });
    if (!correction) continue;
    await prisma.correction.create({
      data: {
        userId,
        transactionId: correction.transactionId,
        fromCategoryId: correction.toCategoryId,
        toCategoryId: correction.fromCategoryId ?? 'uncategorized',
      },
    });
    await prisma.transaction.updateMany({
      where: { id: correction.transactionId, account: { userId } },
      data: {
        categoryId: correction.fromCategoryId,
        needsReview: true,
        confidenceBps: null,
      },
    });
    if (correction.becameRuleId) {
      await prisma.categorizationRule.deleteMany({
        where: { id: correction.becameRuleId, userId },
      });
    }
  }
  revalidatePath('/triage');
  return getTriageItems(userId);
}
