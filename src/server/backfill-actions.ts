'use server';

/**
 * Backfill categorization (DECISIONS #116). Re-runs the *current* deterministic
 * categorizer over the signed-in user's UNSURE transactions (review pile +
 * anything still uncategorized) and auto-files the ones that now resolve
 * confidently — the way normalize-table improvements (insurance carriers, income,
 * fees, golf, …) reach rows that were ingested before those rules existed.
 *
 * It mirrors the INGEST write, NOT a user confirmation:
 *  - stores the categorizer's REAL confidenceBps (so the subtle "AI" badge still
 *    shows) and clears needsReview,
 *  - writes NO CategoryPrediction ground truth and creates NO "Always" rule — the
 *    user didn't confirm these, so they must not poison the accuracy metric (#37)
 *    or the rule loop.
 * Rows that still don't resolve are left in review, untouched. The planner
 * (engine/categorize/backfill.ts) is pure + unit-tested; this layer is the
 * ownership-scoped DB write.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { planBackfill } from '@/lib/engine/categorize/backfill';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { auditLog, requireUserId } from '@/server/authz';
import { assertOwnedCategory } from '@/server/category-meta';
import { ensureCategories } from '@/server/ensure-categories';
import { loadUserRules } from '@/server/rules';

export interface BackfillResult {
  /** UNSURE rows considered. */
  scanned: number;
  /** Rows auto-filed by this pass. */
  refiled: number;
  /** UNSURE rows the categorizer still can't settle (left in review). */
  stillUnsure: number;
}

export async function backfillCategorization(): Promise<BackfillResult> {
  const userId = await requireUserId();
  // Re-filed subcategory ids (e.g. dental-insurance) need a Category row to satisfy
  // the FK on a fresh deploy — same guard applyCategory uses (#65).
  await ensureCategories();

  const [rows, rules] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        account: { userId, type: { in: [...SPENDING_ACCOUNT_TYPES] } },
        isSplitParent: false,
        OR: [{ needsReview: true }, { categoryId: null }, { categoryId: 'uncategorized' }],
      },
      select: {
        id: true,
        rawDescriptor: true,
        amountCents: true,
        date: true,
        accountId: true,
        categoryId: true,
        needsReview: true,
        isSplitParent: true,
      },
    }),
    loadUserRules(userId),
  ]);

  const plan = planBackfill(
    rows.map((r) => ({
      id: r.id,
      rawDescriptor: r.rawDescriptor,
      amountCents: r.amountCents,
      date: r.date,
      accountId: r.accountId,
      categoryId: r.categoryId,
      needsReview: r.needsReview,
      isSplitParent: r.isSplitParent,
    })),
    rules,
  );

  if (plan.refiles.length === 0) {
    return { scanned: plan.scanned, refiled: 0, stillUnsure: plan.stillUnsure };
  }

  // Defense in depth: every target must be ownable (system id or this user's
  // custom). Targets come from the system pipeline, so this is belt-and-braces.
  for (const id of new Set(plan.refiles.map((r) => r.toCategoryId))) {
    await assertOwnedCategory(userId, id);
  }

  // Collapse identical (category, confidence) writes into a few updateMany calls.
  const groups = new Map<string, { categoryId: string; confidenceBps: number; ids: string[] }>();
  for (const rf of plan.refiles) {
    const key = `${rf.toCategoryId}|${rf.confidenceBps}`;
    const g = groups.get(key) ?? { categoryId: rf.toCategoryId, confidenceBps: rf.confidenceBps, ids: [] };
    g.ids.push(rf.id);
    groups.set(key, g);
  }

  await prisma.$transaction(async (tx) => {
    for (const g of groups.values()) {
      await tx.transaction.updateMany({
        // ownership re-asserted in the WHERE so a stale id can't escape the user scope
        where: { id: { in: g.ids }, account: { userId } },
        data: { categoryId: g.categoryId, confidenceBps: g.confidenceBps, needsReview: false },
      });
    }
  });

  await auditLog(userId, 'categorize.backfill', {
    scanned: plan.scanned,
    refiled: plan.refiles.length,
    stillUnsure: plan.stillUnsure,
  });
  revalidatePath('/triage');
  revalidatePath('/transactions');
  revalidatePath('/dashboard');

  return { scanned: plan.scanned, refiled: plan.refiles.length, stillUnsure: plan.stillUnsure };
}
