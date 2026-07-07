'use server';

/**
 * Triage server actions. Every mutation:
 *  - re-verifies the session and row ownership (userId scoping),
 *  - records a Correction (corrections are append-only, reversible events),
 *  - is undoable (undo writes the INVERSE correction; created rules are removed).
 */
import { revalidatePath } from 'next/cache';
import type { Prisma } from '@/generated/prisma/client';
import { prisma, serializableTx } from '@/lib/db';
import { selectConfidentGroups } from '@/lib/engine/categorize/group';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { auditLog, requireUserId } from '@/server/authz';
import { assertOwnedCategory } from '@/server/category-meta';
import { ensureCategories } from '@/server/ensure-categories';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { type TriageGroupView, getTriageGroups, similarTransactionsWhere } from '@/server/triage';

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

/**
 * Reuse-or-mint the UNCONDITIONAL priority-100 merchant→category rule inside the
 * caller's transaction — the ONE mint used by ALL FOUR rule-creating surfaces
 * (fileMerchantGroup, recategorize, applyCategory's "Always", and
 * makeRuleFromCorrection), so they can never drift (cycle-3: two of the four
 * still minted raw creates and kept stacking duplicates).
 *
 * Semantics — "this merchant now files to C":
 * 1. SUPERSEDE (cycle-3 P1): an unconditional rule for the SAME merchant to a
 *    DIFFERENT category contradicts the user's newest decision, and the
 *    equal-priority tie-break (insertion order via the pipeline's stable sort)
 *    made the STALE rule win every future ingest. Retire it here. Undo of the
 *    new correction removes the new rule but cannot resurrect a retired one —
 *    accepted (STATUS cycle-3): re-minting is one tap; a silent wrong-category
 *    auto-file is not.
 * 2. DEDUPE on ALL FIVE condition columns empty (cycle-2 P2): "reusing" an
 *    amount-banded/account-scoped variant would break the card's "every future X
 *    files automatically" promise for out-of-band rows — conditions are ANDed by
 *    ruleMatches. Conditional rules are also never superseded: they encode a
 *    narrower intent this mint does not speak for.
 */
async function ensureUnconditionalRule(
  tx: Prisma.TransactionClient,
  args: { userId: string; merchantId: string; categoryId: string; createdFrom: string | null },
): Promise<{ ruleId: string; minted: boolean }> {
  const unconditional = {
    minAmountCents: null,
    maxAmountCents: null,
    weekendOnly: null,
    weekdayOnly: null,
    accountId: null,
  };
  await tx.categorizationRule.deleteMany({
    where: {
      userId: args.userId,
      merchantId: args.merchantId,
      categoryId: { not: args.categoryId },
      ...unconditional,
    },
  });
  const existing = await tx.categorizationRule.findFirst({
    where: {
      userId: args.userId,
      merchantId: args.merchantId,
      categoryId: args.categoryId,
      ...unconditional,
    },
  });
  if (existing) return { ruleId: existing.id, minted: false };
  const rule = await tx.categorizationRule.create({
    data: {
      userId: args.userId,
      merchantId: args.merchantId,
      categoryId: args.categoryId,
      priority: 100,
      createdFrom: args.createdFrom,
    },
  });
  return { ruleId: rule.id, minted: true };
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
  await ensureCategories(); // new subcategory ids need a Category row (FK) (#65)
  await assertOwnedCategory(userId, input.categoryId); // system id or a custom this user owns (#111)
  await ownedTransaction(userId, input.transactionId); // fast ownership fail (pre-tx UX check)

  // ONE serializable transaction with FRESH in-tx reads (cycle-3 P1): this is the
  // highest-traffic single-row writer, and it was a fully unguarded check-then-act —
  // four separate statements recording fromCategoryId from an OUTSIDE read, so a
  // sync/group-file committing in the window minted a correction whose undo
  // reverted the OTHER writer; a crash mid-sequence persisted a correction for a
  // category never applied (audit ≠ state). Same discipline as the other guard
  // sites (DECISIONS #146/#147).
  const { correction, ruleId, minted, merchantId } = await serializableTx(async (tx) => {
    const fresh = await tx.transaction.findFirst({
      where: { id: input.transactionId, account: { userId } },
    });
    if (!fresh) throw new Error('Transaction not found');
    const created = await tx.correction.create({
      data: {
        userId,
        transactionId: fresh.id,
        fromCategoryId: fresh.categoryId,
        toCategoryId: input.categoryId,
      },
    });
    let createdRuleId: string | null = null;
    let ruleMinted = false;
    if (input.always && fresh.merchantId) {
      assertRuleEligible(fresh.rawDescriptor);
      const r = await ensureUnconditionalRule(tx, {
        userId,
        merchantId: fresh.merchantId,
        categoryId: input.categoryId,
        createdFrom: created.id,
      });
      createdRuleId = r.ruleId;
      ruleMinted = r.minted;
      if (r.minted) {
        await tx.correction.update({ where: { id: created.id }, data: { becameRuleId: r.ruleId } });
      }
    }
    await tx.transaction.update({
      where: { id: fresh.id },
      data: { categoryId: input.categoryId, needsReview: false, confidenceBps: 9900, reviewPinned: false },
    });
    // Ground truth for the accuracy metric (DECISIONS #37): the user just confirmed
    // the real category for this transaction's prediction.
    await tx.categoryPrediction.updateMany({
      where: { transactionId: fresh.id, userId },
      data: { actualCategoryId: input.categoryId },
    });
    return { correction: created, ruleId: createdRuleId, minted: ruleMinted, merchantId: fresh.merchantId };
  });

  if (ruleId) {
    // Provenance-honest audit (cycle-3 P2): 'rule.create' only for a rule that was
    // actually minted here; a reused rule logs 'rule.reuse'.
    await auditLog(userId, minted ? 'rule.create' : 'rule.reuse', { ruleId, merchantId, categoryId: input.categoryId });
  }

  revalidatePath('/triage');
  revalidatePath('/transactions');
  return { correctionIds: [correction.id], ruleId, affected: 1 };
}

/** Create a durable rule from an already-recorded correction (one-tap "Always").
 *  Routed through the SHARED mint inside a serializable tx (cycle-3 P2: this
 *  surface still raw-created — two "Always" answers on different rows of one
 *  merchant stacked exact duplicate priority-100 rules). */
export async function makeRuleFromCorrection(correctionId: string): Promise<{ ruleId: string | null }> {
  const userId = await requireUserId();
  const { ruleId, minted, merchantId, categoryId } = await serializableTx(async (tx) => {
    const correction = await tx.correction.findFirst({ where: { id: correctionId, userId } });
    if (!correction) throw new Error('Correction not found');
    if (correction.becameRuleId) {
      // Verify the rule still EXISTS (cycle-4 P2 #31): a supersede (retire-on-
      // changed-mind, DECISIONS #147) deletes other-category rules without nulling
      // becameRuleId pointers — returning the dead id here would report success
      // while minting nothing. A dangling pointer falls through to a fresh mint.
      const live = await tx.categorizationRule.findFirst({
        where: { id: correction.becameRuleId, userId },
        select: { id: true },
      });
      if (live) {
        return { ruleId: live.id, minted: false, merchantId: null, categoryId: null };
      }
    }
    const txn = await tx.transaction.findFirst({
      where: { id: correction.transactionId, account: { userId } },
    });
    if (!txn) throw new Error('Transaction not found');
    if (!txn.merchantId) return { ruleId: null, minted: false, merchantId: null, categoryId: null };
    assertRuleEligible(txn.rawDescriptor);
    const r = await ensureUnconditionalRule(tx, {
      userId,
      merchantId: txn.merchantId,
      categoryId: correction.toCategoryId,
      createdFrom: correction.id,
    });
    if (r.minted) {
      await tx.correction.update({ where: { id: correction.id }, data: { becameRuleId: r.ruleId } });
    }
    return { ruleId: r.ruleId, minted: r.minted, merchantId: txn.merchantId, categoryId: correction.toCategoryId };
  });
  if (ruleId && merchantId) {
    await auditLog(userId, minted ? 'rule.create' : 'rule.reuse', { ruleId, merchantId, categoryId });
  }
  return { ruleId };
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
  await assertOwnedCategory(userId, input.categoryId); // system id or a custom this user owns (#111)
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
      data: { categoryId: input.categoryId, needsReview: false, confidenceBps: 9900, reviewPinned: false },
    });
    await tx.categoryPrediction.updateMany({
      where: { transactionId: { in: targets.map((t) => t.id) }, userId },
      data: { actualCategoryId: input.categoryId },
    });
    return ids;
  });
  await auditLog(userId, 'rule.batch-apply', {
    merchantId: txn.merchantId,
    categoryId: input.categoryId,
    affected: targets.length,
  });

  revalidatePath('/triage');
  revalidatePath('/transactions');
  return { correctionIds, ruleId: null, affected: targets.length };
}

/**
 * File a MERCHANT GROUP in one action (Phase 3b, DECISIONS #143): every
 * review-queued transaction of the anchor's merchant gets the category, one
 * Correction per row (undo restores each), prediction ground truth, AND — for
 * rule-eligible merchants — a durable priority-100 rule, so the merchant never
 * re-surfaces (trust on repeat = certainty at ingest).
 *
 * Consent framing: unlike the per-transaction surfaces (#36's two-step confirm),
 * the GROUP CARD is explicitly merchant-scoped — "File all N Starbucks · future
 * ones file automatically" IS the consent; a second prompt would re-ask the
 * question the card already asked. Aggregates (Zelle/checks/ATM/Venmo) file
 * their exact-descriptor rows and never create a rule (#23). The group scope is
 * re-derived server-side from the anchor row — the client's list is never trusted.
 */
export async function fileMerchantGroup(input: {
  anchorTransactionId: string;
  categoryId: string;
}): Promise<ApplyResult> {
  const userId = await requireUserId();
  await ensureCategories(); // new subcategory ids need a Category row (FK) (#65)
  await assertOwnedCategory(userId, input.categoryId); // system id or a custom this user owns (#111)
  const txn = await ownedTransaction(userId, input.anchorTransactionId);

  const aggregate = normalizeMerchant(txn.rawDescriptor).aggregate;
  const ruleEligible = !aggregate && !!txn.merchantId;

  // EVERYTHING inside one SERIALIZABLE transaction (Phase-3 checker P1 +
  // cycle-2 P1): the target fetch, the needsReview re-assert, and the rule
  // dedupe. SQLite serializes write transactions natively; production Postgres
  // runs READ COMMITTED by default, where a concurrent applyCategory/double-file
  // committing between the in-tx fetch and the writes still recorded
  // stale-fromCategoryId corrections (whose undo reverts the OTHER session) and
  // minted duplicate equal-priority rules. At Serializable that interleave is a
  // DETECTED conflict → P2034 → serializableTx re-runs against fresh state, so
  // the raced case converges to the clean zero-target return with NOTHING
  // committed (DECISIONS #146).
  const { correctionIds, ruleId, minted, affected } = await serializableTx(async (tx) => {
    const targets = await tx.transaction.findMany({
      // SAME scope + SAME spending-account/currency filter the group card was
      // built from (groupKey ↔ similarTransactionsWhere, DECISIONS #23; checker:
      // the action must never file more account types than the card counted).
      where: {
        ...similarTransactionsWhere(userId, {
          merchantId: txn.merchantId,
          rawDescriptor: txn.rawDescriptor,
          aggregate,
        }),
        account: {
          userId,
          type: { in: [...SPENDING_ACCOUNT_TYPES] },
          OR: [{ currency: null }, { currency: 'USD' }],
        },
      },
    });
    if (targets.length === 0) {
      return { correctionIds: [] as string[], ruleId: null as string | null, minted: false, affected: 0 };
    }

    const ids: string[] = [];
    for (const t of targets) {
      const c = await tx.correction.create({
        data: { userId, transactionId: t.id, fromCategoryId: t.categoryId, toCategoryId: input.categoryId },
      });
      ids.push(c.id);
    }
    let createdRuleId: string | null = null;
    let mintedRule = false;
    if (ruleEligible) {
      // Dedupe: an identical live UNCONDITIONAL rule is reused, never duplicated
      // (checker: duplicate equal-priority rules survive undo; cycle-2: a
      // conditional variant must NOT satisfy the dedupe).
      const { ruleId: rid, minted } = await ensureUnconditionalRule(tx, {
        userId,
        merchantId: txn.merchantId!,
        categoryId: input.categoryId,
        createdFrom: ids[0],
      });
      createdRuleId = rid;
      mintedRule = minted;
      if (minted) {
        await tx.correction.update({ where: { id: ids[0] }, data: { becameRuleId: rid } });
      }
    }
    const updated = await tx.transaction.updateMany({
      // Compare-and-set: only rows STILL in review are filed, re-asserted in the write.
      where: { id: { in: targets.map((t) => t.id) }, needsReview: true },
      data: { categoryId: input.categoryId, needsReview: false, confidenceBps: 9900, reviewPinned: false },
    });
    await tx.categoryPrediction.updateMany({
      where: { transactionId: { in: targets.map((t) => t.id) }, userId },
      data: { actualCategoryId: input.categoryId },
    });
    return { correctionIds: ids, ruleId: createdRuleId, minted: mintedRule, affected: updated.count };
  });
  if (affected === 0) return { correctionIds: [], ruleId: null, affected: 0 };
  await auditLog(userId, 'group.file', {
    merchantId: txn.merchantId,
    categoryId: input.categoryId,
    affected,
    ruleId,
  });
  if (ruleId) {
    // Provenance-honest audit (cycle-3 P2): a reused rule never logs 'rule.create'.
    await auditLog(userId, minted ? 'rule.create' : 'rule.reuse', { ruleId, merchantId: txn.merchantId, categoryId: input.categoryId });
  }

  revalidatePath('/triage');
  revalidatePath('/transactions');
  return { correctionIds, ruleId, affected };
}

/** Read-only authoritative queue re-fetch — the client's recovery path when an
 *  action's response stream was severed (the pending-stall race, see
 *  src/components/triage/action-deadline.ts). The write usually committed, so
 *  the client re-syncs from the server instead of rolling back. */
export async function refreshTriageQueue(): Promise<TriageGroupView[]> {
  const userId = await requireUserId();
  return getTriageGroups(userId);
}

export interface AcceptAllResult {
  correctionIds: string[];
  merchantsFiled: number;
  affected: number;
  /** Fresh remaining queue (only ambiguous groups) so the client reconciles without a reload. */
  groups: TriageGroupView[];
}

/**
 * "Accept all confident" (DECISIONS #162) — drain the review pile in one action.
 * Files EVERY merchant group the pipeline gave a unanimous, honest suggestion for
 * (selectConfidentGroups: suggestedCategoryId !== null), each to ITS OWN
 * suggestion, and leaves the ambiguous (no-suggestion) groups for manual review.
 * Semantically identical to swiping right on each confident card — batched into
 * one undoable action (the returned correctionIds feed a single undoCorrections).
 *
 * Discipline:
 *  - Re-derived server-side from getTriageGroups — the client's list is NEVER
 *    trusted (same as fileMerchantGroup's anchor re-derivation). The confident
 *    predicate is the shared engine selector, so button and action can't drift.
 *  - Each group is filed through the tested fileMerchantGroup path (its own
 *    serializable tx, rule-eligibility + aggregate handling, compare-and-set).
 *    PER-GROUP commits, not one giant tx: a drain is incremental — each group is
 *    independently filed AND independently undoable, and one failing group never
 *    rolls back the rest.
 *  - Fail-loud on TOTAL failure (nothing drained AND a hard error → throw so the
 *    client rolls back and surfaces it); graceful on PARTIAL (a stray group stays
 *    queued and simply reappears in the returned fresh queue).
 */
export async function acceptAllConfident(): Promise<AcceptAllResult> {
  const userId = await requireUserId();
  const groups = await getTriageGroups(userId);
  const confident = selectConfidentGroups(groups);
  // Genuine no-op: nothing confident to file → no audit row, no revalidate, no
  // second query. The client hides the banner below 2 confident groups, but the
  // action stays safe if called anyway (golden-safety: zero work = zero writes).
  if (confident.length === 0) {
    return { correctionIds: [], merchantsFiled: 0, affected: 0, groups };
  }

  const correctionIds: string[] = [];
  let merchantsFiled = 0;
  let affected = 0;
  let lastError: unknown = null;
  for (const g of confident) {
    try {
      const result = await fileMerchantGroup({
        anchorTransactionId: g.anchorTransactionId,
        // Non-null by selectConfidentGroups; file each group to its own suggestion.
        categoryId: g.suggestedCategoryId as string,
      });
      if (result.affected > 0) {
        correctionIds.push(...result.correctionIds);
        merchantsFiled += 1;
        affected += result.affected;
      }
    } catch (e) {
      // One group failing (e.g. a suggestion the user can't own — a rule pointing
      // at a foreign custom category) must not abort the drain: it stays queued and
      // reappears in the fresh queue below. A TOTAL wipeout is surfaced loudly next.
      lastError = e;
    }
  }
  if (merchantsFiled === 0 && lastError) {
    // Every confident group failed → systemic (auth/db/category). Fail loudly with a
    // STABLE, user-safe message — never the raw underlying error (no detail leak) —
    // so the client rolls back and shows it, not a silent no-op (LOOP #6).
    throw new Error('Could not file those right now — nothing was saved. Try again.');
  }

  await auditLog(userId, 'group.accept-all', { merchantsFiled, affected });
  revalidatePath('/triage');
  revalidatePath('/transactions');
  return { correctionIds, merchantsFiled, affected, groups: await getTriageGroups(userId) };
}

/**
 * Register inline recategorization (DECISIONS #36). Unlike triage, this acts on
 * ANY transaction — including confidently auto-filed ones the pipeline never
 * routed to review. Two scopes:
 *   'one'      → just this transaction (records a reversible Correction, no rule)
 *   'merchant' → re-file EVERY transaction of this merchant (already-categorized
 *                included) AND create a durable priority-100 rule, so past and
 *                future are fixed in one action.
 * 'merchant' falls back to 'one' when the row has no merchant or is an aggregate
 * pseudo-merchant (Zelle/checks) — those never carry merchant-wide rules (#23).
 * Every write is ownership-scoped and audit-logged.
 */
export async function recategorize(input: {
  transactionId: string;
  categoryId: string;
  scope: 'one' | 'merchant';
}): Promise<ApplyResult> {
  const userId = await requireUserId();
  await assertOwnedCategory(userId, input.categoryId); // system id or a custom this user owns (#111)
  const txn = await ownedTransaction(userId, input.transactionId);

  const merchantWide =
    input.scope === 'merchant' &&
    !!txn.merchantId &&
    !normalizeMerchant(txn.rawDescriptor).aggregate;

  if (!merchantWide) {
    // Single row: reuse the triage single-apply path (correction + update, no rule).
    return applyCategory({ transactionId: input.transactionId, categoryId: input.categoryId });
  }

  // Target fetch INSIDE the serializable tx (cycle-2 P1: an outside read let a
  // raced correction record a stale fromCategoryId under Postgres READ COMMITTED),
  // and the rule mint deduped through the same helper as fileMerchantGroup
  // (cycle-2 gate gap: this path minted unconditionally — every repeat
  // recategorize stacked another equal-priority rule). DECISIONS #146.
  const { correctionIds, ruleId, minted, affected } = await serializableTx(async (tx) => {
    const targets = await tx.transaction.findMany({
      where: similarTransactionsWhere(
        userId,
        { merchantId: txn.merchantId, rawDescriptor: txn.rawDescriptor, aggregate: false },
        { onlyNeedsReview: false },
      ),
    });
    const ids: string[] = [];
    let firstCorrectionId: string | null = null;
    for (const t of targets) {
      const c = await tx.correction.create({
        data: { userId, transactionId: t.id, fromCategoryId: t.categoryId, toCategoryId: input.categoryId },
      });
      ids.push(c.id);
      if (!firstCorrectionId) firstCorrectionId = c.id;
    }
    const { ruleId: rid, minted: ruleMinted } = await ensureUnconditionalRule(tx, {
      userId,
      merchantId: txn.merchantId!,
      categoryId: input.categoryId,
      createdFrom: firstCorrectionId,
    });
    if (ruleMinted && firstCorrectionId) {
      await tx.correction.update({ where: { id: firstCorrectionId }, data: { becameRuleId: rid } });
    }
    await tx.transaction.updateMany({
      where: { id: { in: targets.map((t) => t.id) } },
      data: { categoryId: input.categoryId, needsReview: false, confidenceBps: 9900, reviewPinned: false },
    });
    await tx.categoryPrediction.updateMany({
      where: { transactionId: { in: targets.map((t) => t.id) }, userId },
      data: { actualCategoryId: input.categoryId },
    });
    return { correctionIds: ids, ruleId: rid, minted: ruleMinted, affected: targets.length };
  });

  // Provenance-honest audit (cycle-3 P2): pre-fix this always logged 'rule.create'
  // even when the dedupe reused an existing rule.
  await auditLog(userId, minted ? 'rule.create' : 'rule.reuse', {
    ruleId,
    merchantId: txn.merchantId,
    categoryId: input.categoryId,
    affected,
    via: 'register',
  });

  revalidatePath('/triage');
  revalidatePath('/transactions');
  return { correctionIds, ruleId, affected };
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
  // Each part's category must be a known system id or a custom THIS user owns —
  // the split path is a category write too, so it gets the same cross-tenant guard
  // as applyCategory/recategorize (a foreign cuid would otherwise persist via the
  // FK, and a garbage id would 500 on a raw FK error) — critic F1, DECISIONS #111.
  await Promise.all(input.parts.map((p) => assertOwnedCategory(userId, p.categoryId)));

  const childIds = await prisma.$transaction(async (tx) => {
    // Atomically CLAIM the parent FIRST: only a not-yet-split, non-child row flips
    // to split. A concurrent split that already claimed it makes this affect 0
    // rows → we abort (the transaction rolls back) BEFORE creating any children,
    // so a racing double-split can never produce a second set of children
    // (closes the STATUS #10 race; the pre-read above is just a fast UX fail).
    const claimed = await tx.transaction.updateMany({
      where: { id: txn.id, isSplitParent: false, splitParentId: null },
      data: { needsReview: false, categoryId: null, confidenceBps: null, isSplitParent: true, reviewPinned: false },
    });
    if (claimed.count === 0) throw new Error('Transaction is already split');

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
    return ids;
  });

  revalidatePath('/triage');
  return { childIds };
}

/** Undo a split: remove children, put the parent back in review. Returns the fresh queue. */
export async function undoSplit(transactionId: string): Promise<TriageGroupView[]> {
  const userId = await requireUserId();
  const txn = await ownedTransaction(userId, transactionId);
  if (!txn.isSplitParent) throw new Error('Transaction is not a split parent');
  await prisma.$transaction([
    prisma.transaction.deleteMany({ where: { splitParentId: transactionId } }),
    prisma.transaction.update({
      where: { id: transactionId },
      // #165 critic F1: a transfer-flagged parent restored to review must be
      // PINNED, or the queue's transfer guard hides it and the next sync's
      // pair pass re-files it — same restore-is-a-lie failure as undoCorrections.
      data: { needsReview: true, isSplitParent: false, ...(txn.isTransfer ? { reviewPinned: true } : {}) },
    }),
  ]);
  revalidatePath('/triage');
  return getTriageGroups(userId); // group queue (Phase 3c)
}

/**
 * Undo corrections: write the INVERSE correction (append-only history), restore
 * each transaction to review, and remove any rule the correction created.
 * Returns the fresh queue so the client can restore without a reload.
 */
export async function undoCorrections(correctionIds: string[]): Promise<TriageGroupView[]> {
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
    // appends duplicate inverse rows for already-undone items (cycle 3). The
    // `undoesId` unique constraint closes the concurrent double-undo race (two
    // undos of the SAME correction both passing the pre-read above): the loser's
    // inverse insert violates the unique and its whole transaction rolls back
    // (STATUS #10).
    try {
      await prisma.$transaction(async (tx) => {
        await tx.correction.create({
          data: {
            userId,
            transactionId: correction.transactionId,
            fromCategoryId: correction.toCategoryId,
            toCategoryId: correction.fromCategoryId ?? 'uncategorized',
            undoesId: correction.id,
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
      // #165 critic F1: undoing a TRANSFER-FLAGGED row must PIN it, or the
      // restore is a lie twice over — the queue's transfer guard hides the row
      // the instant it's restored ("restore to review" returns a queue without
      // it), and the next sync's pair pass re-files it as 'transfer' over the
      // user's explicit "I want to re-decide". The pin makes both surfaces
      // honor the undo (pin wins in the queue guard AND in planTransferUpdates).
      await tx.transaction.updateMany({
        where: { id: correction.transactionId, account: { userId }, isTransfer: true },
        data: { reviewPinned: true },
      });
      // #169: un-label the accuracy sample too. Filing stamped this prediction's
      // actualCategoryId as ground truth (DECISIONS #37); undoing the correction
      // restores the row to review, so the RETRACTED label must be cleared or
      // getCategorizationAccuracy keeps counting a decision the user took back and
      // the displayed accuracy never recovers after undo. Invariant, symmetric with
      // filing: a needsReview row carries no confirmed label (null actualCategoryId).
      // undoSplit needs no counterpart — splitting sets categoryId=null and never
      // labels a prediction.
      await tx.categoryPrediction.updateMany({
        where: { transactionId: correction.transactionId, userId },
        data: { actualCategoryId: null },
      });
      if (correction.becameRuleId) {
        // Conditional-claim (STATUS #10 / ROADMAP #9): delete the rule ONLY while it
        // still points back to THIS correction (createdFrom === correction.id). If a
        // concurrent re-apply has already replaced the rule's lineage, this affects 0
        // rows and we leave the new owner's rule intact instead of orphaning it.
        await tx.categorizationRule.deleteMany({
          where: { id: correction.becameRuleId, userId, createdFrom: correction.id },
        });
        // keep the audit lineage truthful — no pointer to a deleted rule
        await tx.correction.update({
          where: { id: correction.id },
          data: { becameRuleId: null },
        });
      }
      });
    } catch (e) {
      // P2002 on undoesId = a concurrent undo of this same correction already recorded
      // the inverse; that transaction did the restore, so skip idempotently.
      if ((e as { code?: string }).code !== 'P2002') throw e;
    }
  }
  revalidatePath('/triage');
  return getTriageGroups(userId); // group queue (Phase 3c)
}
