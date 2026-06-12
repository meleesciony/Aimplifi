'use server';

/**
 * Triage server actions. Every mutation:
 *  - re-verifies the session and row ownership (userId scoping),
 *  - records a Correction (corrections are append-only, reversible events),
 *  - is undoable (undo writes the INVERSE correction; created rules are removed).
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { auditLog, requireUserId } from '@/server/authz';
import { getTriageItems, similarTransactionsWhere, type TriageItem } from '@/server/triage';

/** Aggregate pseudo-merchants (Zelle/checks/ATM) never get merchant-wide rules. */
function assertRuleEligible(rawDescriptor: string): void {
  if (normalizeMerchant(rawDescriptor).aggregate) {
    throw new Error('This merchant groups unrelated payees — rules are not offered for it');
  }
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
    assertRuleEligible(txn.rawDescriptor);
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
    await auditLog(userId, 'rule.create', { ruleId, merchantId: txn.merchantId, categoryId: input.categoryId });
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
  assertRuleEligible(txn.rawDescriptor);
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
  await auditLog(userId, 'rule.create', { ruleId: rule.id, merchantId: txn.merchantId, categoryId: correction.toCategoryId });
  return { ruleId: rule.id };
}

/**
 * Batch: apply a category to every review-queued transaction of the same
 * merchant. Does NOT create a rule — durable rules always go through the
 * explicit "Always / Just this once" consent prompt (critic finding F3);
 * the client offers it after the batch, wired to the first correction.
 */
export async function applyToAllSimilar(input: {
  transactionId: string;
  categoryId: string;
}): Promise<ApplyResult> {
  const userId = await requireUserId();
  const txn = await ownedTransaction(userId, input.transactionId);
  if (!txn.merchantId) return applyCategory({ ...input });

  // SAME scope definition the button's count used (shared helper, can't drift)
  const aggregate = normalizeMerchant(txn.rawDescriptor).aggregate;
  const targets = await prisma.transaction.findMany({
    where: similarTransactionsWhere(userId, {
      merchantId: txn.merchantId,
      rawDescriptor: txn.rawDescriptor,
      aggregate,
    }),
  });
  const correctionIds = await prisma.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const t of targets) {
      const c = await tx.correction.create({
        data: { userId, transactionId: t.id, fromCategoryId: t.categoryId, toCategoryId: input.categoryId },
      });
      ids.push(c.id);
    }
    await tx.transaction.updateMany({
      where: { id: { in: targets.map((t) => t.id) } },
      data: { categoryId: input.categoryId, needsReview: false, confidenceBps: 9900 },
    });
    return ids;
  });
  await auditLog(userId, 'rule.batch-apply', {
    merchantId: txn.merchantId,
    categoryId: input.categoryId,
    affected: targets.length,
  });

  revalidatePath('/triage');
  return { correctionIds, ruleId: null, affected: targets.length };
}

/**
 * Split a transaction into parts (long-press flow). Validation (critic F2):
 * parts sum exactly, every part shares the parent's sign and is non-zero,
 * and neither split children nor already-split parents can be split again.
 * The parent is marked `isSplitParent` and is excluded from every aggregation
 * (pending projection, flows, spending) — only the children count.
 */
export async function splitTransaction(input: {
  transactionId: string;
  parts: { amountCents: number; categoryId: string }[];
}): Promise<{ childIds: string[] }> {
  const userId = await requireUserId();
  const txn = await ownedTransaction(userId, input.transactionId);
  if (txn.splitParentId) throw new Error('Cannot split a split child');
  if (txn.isSplitParent) throw new Error('Transaction is already split');
  if (input.parts.length < 2) throw new Error('A split needs at least 2 parts');
  const sign = Math.sign(txn.amountCents);
  for (const p of input.parts) {
    if (!Number.isSafeInteger(p.amountCents)) throw new Error('Split parts must be whole cents');
    if (p.amountCents === 0) throw new Error('Split parts must be non-zero');
    if (Math.sign(p.amountCents) !== sign) {
      throw new Error('Split parts must keep the sign of the original transaction');
    }
  }
  const sum = input.parts.reduce((s, p) => s + p.amountCents, 0);
  if (sum !== txn.amountCents) {
    throw new Error(`Split parts must sum to the original amount (${txn.amountCents}¢), got ${sum}¢`);
  }

  const childIds = await prisma.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const p of input.parts) {
      const child = await tx.transaction.create({
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
      });
      ids.push(child.id);
    }
    await tx.transaction.update({
      where: { id: txn.id },
      data: { needsReview: false, categoryId: null, confidenceBps: null, isSplitParent: true },
    });
    return ids;
  });

  revalidatePath('/triage');
  return { childIds };
}

/** Undo a split: remove children, put the parent back in review. Returns the fresh queue. */
export async function undoSplit(transactionId: string): Promise<TriageItem[]> {
  const userId = await requireUserId();
  const txn = await ownedTransaction(userId, transactionId);
  if (!txn.isSplitParent) throw new Error('Transaction is not a split parent');
  await prisma.$transaction([
    prisma.transaction.deleteMany({ where: { splitParentId: transactionId } }),
    prisma.transaction.update({
      where: { id: transactionId },
      data: { needsReview: true, isSplitParent: false },
    }),
  ]);
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
    // idempotent retry: skip if this correction's inverse was already recorded
    const alreadyUndone = await prisma.correction.findFirst({
      where: {
        userId,
        transactionId: correction.transactionId,
        fromCategoryId: correction.toCategoryId,
        toCategoryId: correction.fromCategoryId ?? 'uncategorized',
        createdAt: { gte: correction.createdAt },
      },
    });
    if (alreadyUndone) continue;
    // each correction's undo is atomic: inverse record + restore + rule
    // cleanup land together or not at all, so a retried batch undo never
    // appends duplicate inverse rows for already-undone items (cycle 3)
    await prisma.$transaction(async (tx) => {
      await tx.correction.create({
        data: {
          userId,
          transactionId: correction.transactionId,
          fromCategoryId: correction.toCategoryId,
          toCategoryId: correction.fromCategoryId ?? 'uncategorized',
        },
      });
      // restore exactly what the inverse-correction record says (audit = state)
      await tx.transaction.updateMany({
        where: { id: correction.transactionId, account: { userId } },
        data: {
          categoryId: correction.fromCategoryId ?? 'uncategorized',
          needsReview: true,
          confidenceBps: null,
        },
      });
      if (correction.becameRuleId) {
        await tx.categorizationRule.deleteMany({
          where: { id: correction.becameRuleId, userId },
        });
        // keep the audit lineage truthful — no pointer to a deleted rule
        await tx.correction.update({
          where: { id: correction.id },
          data: { becameRuleId: null },
        });
      }
    });
  }
  revalidatePath('/triage');
  return getTriageItems(userId);
}
