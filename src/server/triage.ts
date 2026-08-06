/**
 * Triage inbox data: transactions needing review, each with the AI suggestion
 * and 3 smart alternatives (computed by the pure pipeline).
 * All queries are row-ownership scoped by userId.
 */
import { prisma } from '@/lib/db';
import { categoryName } from '@/lib/engine/categorize/categories';
import { type ReviewRow, type TriageGroup, groupKey, groupReviewRows } from '@/lib/engine/categorize/group';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { categorize, suggestAlternatives } from '@/lib/engine/categorize/pipeline';
import { deriveCorrectionHints, type LearnedCorrectionInput } from '@/lib/engine/categorize/learn';
import {
  proposalReason,
  proposeCategory,
  type CategoryProposal,
} from '@/lib/engine/categorize/propose';
import {
  registerSuggestionFor,
  type RegisterSuggestionKind,
} from '@/lib/engine/categorize/register-suggestion';
import { cents, formatCents } from '@/lib/money';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { getReconciliationTxnKeep } from '@/server/reconciliation';
import { loadCorrectionInputs, loadUserRules } from '@/server/rules';
import { getThresholdTuning } from '@/server/tuning';
import { getCategoryMeta } from '@/server/category-meta';
import { accountLabel } from '@/lib/engine/account/display-name';

export interface TriageItem {
  id: string;
  date: string;
  rawDescriptor: string;
  merchantCanonical: string;
  merchantId: string | null;
  amountCents: number;
  accountName: string;
  status: string;
  suggestedCategoryId: string;
  suggestedCategoryName: string;
  alternativeIds: string[];
  alternativeNames: string[];
  /** How many other transactions share this merchant (for batch apply). */
  similarCount: number;
  /** False for aggregate pseudo-merchants (Zelle/checks/ATM): never offer "Always" rules. */
  ruleEligible: boolean;
}

/**
 * THE batch scope — one definition shared by the count shown on the button
 * and the rows the batch actually mutates, so they can never drift apart:
 * exact descriptor for aggregate pseudo-merchants (Zelle/checks — "all 6 to
 * J. Park", never "all Zelle"), merchant-wide otherwise. DECISIONS #23.
 */
export function similarTransactionsWhere(
  userId: string,
  txn: { merchantId: string | null; rawDescriptor: string; aggregate: boolean },
  opts: { onlyNeedsReview?: boolean } = {},
) {
  // Triage batches only the REVIEW queue (default). The register recategorizes
  // EVERY matching transaction — already-filed ones included — so it passes
  // onlyNeedsReview:false (DECISIONS #36). The merchant-vs-descriptor scope is
  // identical either way, so the two surfaces can never drift (DECISIONS #23).
  const onlyNeedsReview = opts.onlyNeedsReview ?? true;
  // Never re-file split-PARENT containers (categoryId is intentionally null and
  // they're excluded from every aggregation) — and excluding them keeps the
  // register's "re-file all N" count equal to the rows actually mutated (#44).
  //
  // MERCHANTLESS rows scope by EXACT descriptor AND merchantId: null (Phase-3
  // checker P0 + cycle-2 P2): a bare `{ merchantId: null }` would match EVERY
  // merchantless row the user owns, and a bare `{ rawDescriptor }` also matched
  // MERCHANT-ATTACHED rows carrying the identical bank text — which groupKey
  // puts on a SEPARATE m: card (manual/CSV rows never get a merchantId; synced
  // rows always do), so one tap on the raw: card also filed the m: card's rows.
  // The scope must partition rows exactly the way groupKey partitions cards.
  // AGGREGATES stay descriptor-only: aggregate is a function of the descriptor,
  // so one agg: card can mix merchantless (CSV) and merchant-attached (synced)
  // rows of the same text — pinning merchantId there would file fewer rows than
  // the card counts.
  const scope = txn.aggregate
    ? { rawDescriptor: txn.rawDescriptor }
    : txn.merchantId === null
      ? { rawDescriptor: txn.rawDescriptor, merchantId: null }
      : { merchantId: txn.merchantId };
  // Currency guard (DECISIONS #135): the "apply to N similar" scope touches supported accounts only.
  const account = { userId, OR: [{ currency: null }, { currency: 'USD' }] };
  // Transfer guard (#165 critic F2): the review-scoped batch carries the SAME
  // exclusion as the queue/badge (pin wins), so "File all N" can never count or
  // mutate a hidden pair-flagged row the user isn't shown. The register path
  // (onlyNeedsReview:false) deliberately keeps re-filing transfers (DECISIONS #36).
  return onlyNeedsReview
    ? { ...scope, needsReview: true, OR: [{ isTransfer: false }, { reviewPinned: true }], isSplitParent: false, account }
    : { ...scope, isSplitParent: false, account };
}

export async function getTriageItems(userId: string): Promise<TriageItem[]> {
  const [rawTxns, keepsReconciled, rules, meta, tuning, corrections] = await Promise.all([
    prisma.transaction.findMany({
      // Currency guard (DECISIONS #135): a withheld non-USD account's rows must not appear in the
      // categorization inbox either (consistency with /accounts + the register).
      // Transfer guard (#165): a transfer is never a review decision — pair-detected
      // rows are filed at sync, and this keeps any legacy wedged row out of the queue.
      where: {
        needsReview: true,
        // (pin wins: a review-pinned row surfaces even if pair-flagged — #148.)
        OR: [{ isTransfer: false }, { reviewPinned: true }],
        account: { userId, type: { in: [...SPENDING_ACCOUNT_TYPES] }, OR: [{ currency: null }, { currency: 'USD' }] },
      },
      include: { account: { select: { name: true, displayName: true } }, merchant: true },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    }),
    // Reconciliation boundary (slice-6 critic C-9): a successor backfill's copies of
    // claim-span rows arrive needsReview, but the boundary excludes them from every sum —
    // queueing them asks the user to categorize rows that count in nothing (and shows the
    // same real purchase twice). Same shared R1 rule as the register; groups/badge match.
    // Fetched once here because `similarCount` below needs the same rule (H.8
    // critic P1-1): the "apply to N similar" number must be the set the batch
    // writers actually touch, and those are now keep-filtered too.
    getReconciliationTxnKeep(userId),
    loadUserRules(userId), // the user's own rules drive suggestions (cycle-1 C2)
    getCategoryMeta(userId), // a custom-category suggestion (via a user rule) resolves its name (#111)
    getThresholdTuning(userId), // suggestions use the same tuned boundary ingest does (#190)
    loadCorrectionInputs(userId), // personalized swipe-left alternatives (#207)
  ]);
  const txns = rawTxns.filter((t) => keepsReconciled(t.accountId, t.date));

  const items: TriageItem[] = [];
  for (const t of txns) {
    const out = categorize(
      {
        rawDescriptor: t.rawDescriptor,
        amountCents: t.amountCents,
        date: t.date,
        accountId: t.accountId,
      },
      rules,
      { flaggedBps: tuning.flaggedBps },
    );
    const suggested = out.categoryId === 'uncategorized' ? bestGuess(t.amountCents) : out.categoryId;
    const aggregate = normalizeMerchant(t.rawDescriptor).aggregate;
    const ruleEligible = !aggregate;
    const pool = suggestAlternatives(
      {
        rawDescriptor: t.rawDescriptor,
        amountCents: t.amountCents,
        date: t.date,
        accountId: t.accountId,
      },
      {
        personalized: deriveCorrectionHints(
          { rawDescriptor: t.rawDescriptor, amountCents: t.amountCents },
          corrections,
        ),
      },
    );
    // always exactly 3 alternatives, never duplicating the suggestion
    const alts = [...new Set([...pool, 'dining', 'groceries', 'household', 'cash'])]
      .filter((c) => c !== suggested)
      .slice(0, 3);
    // Keep-filtered like the batch write it advertises (H.8 critic P1-1): a raw
    // count here included disowned duplicate rows the queue itself hides, so the
    // button promised more rows than any screen shows. A windowed keep cannot
    // live in a Prisma count where-clause — fetch the two fields and count.
    const similarCount = t.merchantId
      ? (
          await prisma.transaction.findMany({
            where: similarTransactionsWhere(userId, {
              merchantId: t.merchantId,
              rawDescriptor: t.rawDescriptor,
              aggregate,
            }),
            select: { accountId: true, date: true },
          })
        ).filter((r) => keepsReconciled(r.accountId, r.date)).length
      : 1;
    items.push({
      id: t.id,
      date: t.date,
      rawDescriptor: t.rawDescriptor,
      merchantCanonical: t.merchant?.canonical ?? out.merchantCanonical,
      merchantId: t.merchantId,
      amountCents: t.amountCents,
      accountName: accountLabel(t.account),
      status: t.status,
      suggestedCategoryId: suggested,
      suggestedCategoryName: categoryName(suggested, meta),
      alternativeIds: alts,
      alternativeNames: alts.map((id) => categoryName(id, meta)),
      similarCount,
      ruleEligible,
    });
  }
  return items;
}

function bestGuess(amountCents: number): string {
  return amountCents > 0 ? 'income' : 'shopping';
}

/**
 * The proposal for a GROUP: every row must independently earn one, and they
 * must all name the same category. Returns the ANCHOR row's proposal, whose
 * reason sentence is a true statement about the row the card is headed by.
 *
 * The unanimity requirement is what makes an amount-based proposal safe at
 * group scope. An aggregate group keys on the raw descriptor, so its rows can
 * carry DIFFERENT amounts; each row is then judged on its own amount evidence,
 * and a group that is not really one recurring obligation simply fails to agree
 * and proposes nothing.
 */
function unanimousProposal(
  rows: readonly Pick<TriageGroup['rows'][number], 'rawDescriptor' | 'amountCents'>[],
  corrections: readonly LearnedCorrectionInput[],
): CategoryProposal | null {
  if (rows.length === 0) return null;
  const proposals = rows.map((r) =>
    proposeCategory({ rawDescriptor: r.rawDescriptor, amountCents: r.amountCents }, corrections),
  );
  if (proposals.some((p) => p === null)) return null;
  const categories = new Set(proposals.map((p) => p!.categoryId));
  if (categories.size !== 1) return null;
  return proposals[0]!;
}

/** Per-row ladder chip for singles drill-down (O.12e / DECISIONS #374). */
export interface TriageRowSuggestionView {
  kind: RegisterSuggestionKind;
  categoryId: string;
  categoryName: string;
  /** History-rung evidence sentence; null for ruleset/provider. */
  reason: string | null;
}

export type TriageGroupRowView = TriageGroup['rows'][number] & {
  rowSuggestion: TriageRowSuggestionView | null;
};

/** A triage group enriched with display names + quick-pick alternatives. */
export interface TriageGroupView extends Omit<TriageGroup, 'rows'> {
  rows: TriageGroupRowView[];
  suggestedCategoryName: string | null;
  /** Display name of the provider (Plaid) guess, shown as "Plaid's guess" when our
   *  own suggestion is null (L.12). null when there is no provider fallback. */
  providerSuggestedCategoryName: string | null;
  /**
   * A category PROPOSED from the reader's own correction history (#331), shown
   * as a one-tap "Looks like …" confirm ONLY when neither our ruleset nor the
   * provider produced anything — the rows the owner reported re-filing forever
   * (a Venmo to the same payee, a recurring check for the same amount), where a
   * durable rule is refused because one aggregate canonical hides many payees.
   *
   * Offered only when EVERY row in the group independently earns a proposal for
   * the SAME category — the same unanimity contract `suggestedCategoryId`
   * carries — so a group whose amounts differ (and whose amount-based evidence
   * therefore differs row to row) proposes nothing rather than filing one row's
   * evidence onto another's.
   *
   * Like the provider guess and for the same reason, it is deliberately NOT
   * part of `isConfidentGroup`, which reads `suggestedCategoryId` alone: the
   * owner asked to be ASKED, so "Accept all confident" can never sweep a
   * proposal by construction, not by remembering to exclude it.
   */
  proposedCategoryId: string | null;
  proposedCategoryName: string | null;
  /** The evidence sentence shown under the proposal, never a bare assertion. */
  proposalReason: string | null;
  /** 3 quick-pick alternatives (pipeline pool + staples), never the suggestion. */
  alternativeIds: string[];
  alternativeNames: string[];
}

/**
 * The merchant-group review queue (Phase 3b): ONE findMany, grouped by the
 * pure engine — no per-row count queries (the per-transaction queue ran an
 * N+1 similarCount per card). Suggestions are HONEST: the pipeline's verdict
 * when it has one, null when it doesn't — never the amount-based bestGuess
 * (which suggested 'Shopping' on 144/144 baseline cards).
 */
export async function getTriageGroups(userId: string): Promise<TriageGroupView[]> {
  const [txns, rules, meta, tuning, corrections] = await Promise.all([
    prisma.transaction.findMany({
      // Currency guard (DECISIONS #135): withheld non-USD rows never enter the inbox.
      // Transfer guard (#165): same exclusion as getTriageItems — queue and badge agree.
      where: {
        needsReview: true,
        // (pin wins: a review-pinned row surfaces even if pair-flagged — #148.)
        OR: [{ isTransfer: false }, { reviewPinned: true }],
        account: { userId, type: { in: [...SPENDING_ACCOUNT_TYPES] }, OR: [{ currency: null }, { currency: 'USD' }] },
      },
      include: { account: { select: { name: true, displayName: true } }, merchant: true },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    }).then(async (rows) => {
      // Reconciliation boundary (slice-6 critic C-9) — same exclusion as getTriageItems.
      const keepsReconciled = await getReconciliationTxnKeep(userId);
      return rows.filter((t) => keepsReconciled(t.accountId, t.date));
    }),
    loadUserRules(userId),
    getCategoryMeta(userId),
    getThresholdTuning(userId), // suggestions use the same tuned boundary ingest does (#190)
    loadCorrectionInputs(userId), // personalized swipe-left alternatives (#207)
  ]);

  const reviewRows: ReviewRow[] = txns.map((t) => {
    const out = categorize(
      { rawDescriptor: t.rawDescriptor, amountCents: t.amountCents, date: t.date, accountId: t.accountId },
      rules,
      { flaggedBps: tuning.flaggedBps },
    );
    return {
      id: t.id,
      merchantId: t.merchantId,
      merchantCanonical: t.merchant?.canonical ?? out.merchantCanonical,
      rawDescriptor: t.rawDescriptor,
      amountCents: t.amountCents,
      date: t.date,
      accountName: accountLabel(t.account),
      status: t.status,
      reimbursement: t.reimbursement,
      aggregate: normalizeMerchant(t.rawDescriptor).aggregate,
      suggestedCategoryId: out.categoryId === 'uncategorized' ? null : out.categoryId,
      // Plaid's persisted own-category guess (L.12). Read straight from the column —
      // the ingest-time mapping is NOT recomputed here (triage no longer has the raw
      // PFC), which is exactly why persisting it is what lets the inbox show it.
      providerCategoryId: t.providerCategoryId,
    };
  });

  const anchors = new Map(txns.map((t) => [t.id, t]));
  return groupReviewRows(reviewRows).map((g) => {
    const anchor = anchors.get(g.anchorTransactionId);
    const pool = anchor
      ? suggestAlternatives(
          {
            rawDescriptor: anchor.rawDescriptor,
            amountCents: anchor.amountCents,
            date: anchor.date,
            accountId: anchor.accountId,
          },
          {
            personalized: deriveCorrectionHints(
              { rawDescriptor: anchor.rawDescriptor, amountCents: anchor.amountCents },
              corrections,
            ),
          },
        )
      : [];
    // A proposal from the reader's OWN history — last resort only, and only if
    // every row in the group earns the same one (see TriageGroupView).
    const proposal =
      g.suggestedCategoryId === null && g.providerSuggestedCategoryId === null
        ? unanimousProposal(g.rows, corrections)
        : null;
    const alts = [...new Set([...pool, 'dining', 'groceries', 'household', 'cash'])]
      .filter(
        (c) =>
          c !== g.suggestedCategoryId &&
          c !== g.providerSuggestedCategoryId &&
          c !== (proposal?.categoryId ?? null),
      )
      .slice(0, 3);
    const rows: TriageGroupRowView[] = g.rows.map((r) => {
      // Same ladder as the register (O.12e): a mixed group can say "none yet"
      // at card level while individual rows still earn a confirmable chip.
      const s = registerSuggestionFor(
        {
          currentCategoryId: 'uncategorized',
          isTransfer: false,
          reviewPinned: false,
          pipelineCategoryId: r.suggestedCategoryId ?? 'uncategorized',
          providerCategoryId: r.providerCategoryId,
          txn: { rawDescriptor: r.rawDescriptor, amountCents: r.amountCents },
        },
        corrections,
      );
      if (!s) return { ...r, rowSuggestion: null };
      const catLabel = categoryName(s.categoryId, meta);
      return {
        ...r,
        rowSuggestion: {
          kind: s.kind,
          categoryId: s.categoryId,
          categoryName: catLabel,
          reason:
            s.proposal === null
              ? null
              : proposalReason(s.proposal, {
                  categoryLabel: catLabel,
                  amount:
                    s.proposal.matchedAmountCents === null
                      ? null
                      : formatCents(cents(Math.abs(s.proposal.matchedAmountCents))),
                }),
        },
      };
    });
    return {
      ...g,
      rows,
      suggestedCategoryName: g.suggestedCategoryId ? categoryName(g.suggestedCategoryId, meta) : null,
      providerSuggestedCategoryName: g.providerSuggestedCategoryId
        ? categoryName(g.providerSuggestedCategoryId, meta)
        : null,
      proposedCategoryId: proposal?.categoryId ?? null,
      proposedCategoryName: proposal ? categoryName(proposal.categoryId, meta) : null,
      proposalReason: proposal
        ? proposalReason(proposal, {
            categoryLabel: categoryName(proposal.categoryId, meta),
            amount:
              proposal.matchedAmountCents === null
                ? null
                : formatCents(cents(Math.abs(proposal.matchedAmountCents))),
          })
        : null,
      alternativeIds: alts,
      alternativeNames: alts.map((id) => categoryName(id, meta)),
    };
  });
}

/**
 * The inbox badge counts MERCHANT GROUPS, not transaction rows (Phase 3b):
 * "7" means seven decisions, matching the group queue's "7 merchants left".
 * Same grouping keys as the queue (one source of truth: groupKey).
 */
export async function getReviewCount(userId: string): Promise<number> {
  const rows = await prisma.transaction.findMany({
    // Currency guard (DECISIONS #135): the inbox badge counts supported-account rows only.
    // Transfer guard (#165): same exclusion as the queue — badge and queue agree.
    where: {
      needsReview: true,
      // (pin wins: a review-pinned row surfaces even if pair-flagged — #148.)
      OR: [{ isTransfer: false }, { reviewPinned: true }],
      account: { userId, type: { in: [...SPENDING_ACCOUNT_TYPES] }, OR: [{ currency: null }, { currency: 'USD' }] },
    },
    select: { accountId: true, date: true, merchantId: true, rawDescriptor: true, merchant: { select: { canonical: true } } },
  });
  // Reconciliation boundary (slice-6 critic C-9) — same exclusion as the queue; badge agrees.
  const keepsReconciled = await getReconciliationTxnKeep(userId);
  const keys = new Set(
    rows.filter((r) => keepsReconciled(r.accountId, r.date)).map((r) =>
      groupKey({
        merchantId: r.merchantId,
        rawDescriptor: r.rawDescriptor,
        // SAME canonical fallback getTriageGroups uses (checker: a rawDescriptor
        // fallback here made the badge disagree with the queue for merchantless rows).
        merchantCanonical: r.merchant?.canonical ?? normalizeMerchant(r.rawDescriptor).canonical,
        aggregate: normalizeMerchant(r.rawDescriptor).aggregate,
      }),
    ),
  );
  return keys.size;
}
