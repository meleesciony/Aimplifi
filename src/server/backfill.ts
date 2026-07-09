/**
 * Backfill core (DECISIONS #116; LLM second pass #117). Two passes over a user's
 * UNSURE rows (review pile + anything still uncategorized):
 *   1. DETERMINISTIC — planBackfill re-runs the improved keyword/merchant
 *      categorizer; catches everything the rules now resolve.
 *   2. LLM (optional, injected) — for the rows pass 1 couldn't settle, an LLM
 *      names the genuinely-unknown long tail. With NO provider key the injected
 *      suggest returns null and assistUnsureRows leaves every row unchanged, so
 *      this stays a pure deterministic no-op in demo/test (verify-green).
 *
 * Both passes share the same safety rails: only unsure rows, confident verdicts
 * only, and the #44 inflow sign guard (planBackfill enforces it for pass 1,
 * assistUnsureRows for pass 2 — the LLM also clears its high-confidence bar of
 * AUTO_SILENT before it can auto-file). Writes MIRROR INGEST (the categorizer's
 * real confidenceBps + cleared needsReview), never a user confirmation: no
 * CategoryPrediction ground truth and no rule, so the #37 accuracy metric and the
 * rule loop stay clean.
 *
 * `userId` is passed in (not resolved here) and the LLM is injected, so this is
 * unit-testable with a stub and no auth/session mock. The 'use server' action
 * (backfill-actions.ts) is the thin wrapper that supplies the real provider.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { planBackfill } from '@/lib/engine/categorize/backfill';
import type { LlmCategory } from '@/lib/engine/categorize/llm';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { auditLog } from '@/server/authz';
import { assistUnsureRows } from '@/server/categorize-assist';
import { assertOwnedCategory } from '@/server/category-meta';
import { ensureCategories } from '@/server/ensure-categories';
import { loadUserRules } from '@/server/rules';
import { getThresholdTuning } from '@/server/tuning';

export type SuggestCategoryFn = (input: {
  rawDescriptor: string;
  amountCents: number;
}) => Promise<LlmCategory | null>;

export interface BackfillResult {
  /** UNSURE rows considered. */
  scanned: number;
  /** Total auto-filed this pass (deterministic rules + AI). */
  refiled: number;
  /** Of `refiled`, how many the LLM resolved (0 with no provider key). */
  llmRefiled: number;
  /** UNSURE rows neither pass could settle (left in review). */
  stillUnsure: number;
}

interface Refile {
  id: string;
  toCategoryId: string;
  confidenceBps: number;
  source: 'rule' | 'llm';
}

export async function runBackfillForUser(
  userId: string,
  suggest: SuggestCategoryFn,
): Promise<BackfillResult> {
  // Re-filed subcategory ids (e.g. dental-insurance) need a Category row to
  // satisfy the FK on a fresh Postgres — same guard applyCategory uses (#65).
  await ensureCategories();

  const [rows, rules, tuning] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        account: { userId, type: { in: [...SPENDING_ACCOUNT_TYPES] } },
        isSplitParent: false,
        // A dissolve-PINNED row is the user's to decide, never the system's
        // (cycle-5 confirmation P1): backfill re-runs the very rules the pin
        // exists to block — without this exclusion, one tap of the /triage
        // backfill button silently auto-filed a dissolved split and left a
        // contradictory pinned-but-filed row no surface could ever clear.
        reviewPinned: false,
        // Transfer guard (#165): a transfer is the transfer pass's call, never
        // backfill's — the LLM must never re-file one (DECISIONS #155/#163 stance).
        isTransfer: false,
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
    getThresholdTuning(userId),
  ]);

  // Pass 1 — deterministic.
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
    tuning.flaggedBps,
  );

  // Pass 2 — LLM over the rows pass 1 couldn't settle. assistUnsureRows dedupes
  // per descriptor, applies the inflow sign guard, and only auto-files an LLM pick
  // above its high-confidence bar; with no key, suggest returns null → unchanged.
  const resolved = new Set(plan.refiles.map((r) => r.id));
  const remainder = rows.filter((r) => !resolved.has(r.id));
  const assisted = await assistUnsureRows(
    remainder.map((r) => ({
      id: r.id,
      rawDescriptor: r.rawDescriptor,
      amountCents: r.amountCents,
      categoryId: 'uncategorized',
      confidenceBps: 0,
      needsReview: true,
    })),
    suggest,
  );
  const llmRefiles: Refile[] = assisted
    .filter((a) => !a.needsReview && a.categoryId !== 'uncategorized')
    .map((a) => ({ id: a.id, toCategoryId: a.categoryId, confidenceBps: a.confidenceBps, source: 'llm' as const }));

  const allRefiles: Refile[] = [
    ...plan.refiles.map((r) => ({ id: r.id, toCategoryId: r.toCategoryId, confidenceBps: r.confidenceBps, source: 'rule' as const })),
    ...llmRefiles,
  ];

  if (allRefiles.length === 0) {
    return { scanned: plan.scanned, refiled: 0, llmRefiled: 0, stillUnsure: plan.scanned };
  }

  // Defense in depth: every target must be ownable (system id or this user's
  // custom). Deterministic targets are system ids; the LLM is constrained to the
  // assignable system set by its prompt + parseLlmCategory.
  for (const id of new Set(allRefiles.map((r) => r.toCategoryId))) {
    await assertOwnedCategory(userId, id);
  }

  // Collapse identical (source, category, confidence) writes into a few updateMany
  // calls. Keying by source too keeps rule vs LLM rows in separate groups, so the
  // written-count split below stays exact even if they collide on (category, conf).
  const groups = new Map<string, { categoryId: string; confidenceBps: number; source: 'rule' | 'llm'; ids: string[] }>();
  for (const rf of allRefiles) {
    const key = `${rf.source}|${rf.toCategoryId}|${rf.confidenceBps}`;
    const g = groups.get(key) ?? { categoryId: rf.toCategoryId, confidenceBps: rf.confidenceBps, source: rf.source, ids: [] };
    g.ids.push(rf.id);
    groups.set(key, g);
  }

  // COMPARE-AND-SET (adversarial-review P1). The plan came from a snapshot read,
  // and pass 2's LLM calls widen the read→write window. Re-assert the SAME unsure
  // precondition the read used — not just ownership — so a row the user settled via
  // the triage/register confirm path in the meantime no longer matches and is
  // SKIPPED, never clobbered (its confirmed category + CategoryPrediction ground
  // truth stand). Count rows ACTUALLY written so the returned tallies stay honest.
  let written = 0;
  let llmWritten = 0;
  await prisma.$transaction(async (tx) => {
    for (const g of groups.values()) {
      const res = await tx.transaction.updateMany({
        where: {
          id: { in: g.ids },
          account: { userId },
          isSplitParent: false,
          // Re-asserted like the read (cycle-5 confirmation P1): a row a sync
          // dissolve PINNED inside the read→write window is skipped, not filed.
          reviewPinned: false,
          // Transfer guard (#165) re-asserted like the read: a row a sync
          // flagged inside the read→write window is skipped, not re-filed.
          isTransfer: false,
          OR: [{ needsReview: true }, { categoryId: null }, { categoryId: 'uncategorized' }],
        },
        data: { categoryId: g.categoryId, confidenceBps: g.confidenceBps, needsReview: false },
      });
      written += res.count;
      if (g.source === 'llm') llmWritten += res.count;
    }
  });

  const stillUnsure = plan.scanned - written;
  await auditLog(userId, 'categorize.backfill', {
    scanned: plan.scanned,
    refiled: written,
    llmRefiled: llmWritten,
    stillUnsure,
  });
  revalidatePath('/triage');
  revalidatePath('/transactions');
  revalidatePath('/dashboard');

  return { scanned: plan.scanned, refiled: written, llmRefiled: llmWritten, stillUnsure };
}
