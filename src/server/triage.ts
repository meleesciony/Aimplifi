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
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { loadUserRules } from '@/server/rules';
import { getCategoryMeta } from '@/server/category-meta';

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
  const scope = txn.aggregate
    ? { rawDescriptor: txn.rawDescriptor }
    : { merchantId: txn.merchantId };
  // Currency guard (DECISIONS #135): the "apply to N similar" scope touches supported accounts only.
  const account = { userId, OR: [{ currency: null }, { currency: 'USD' }] };
  return onlyNeedsReview
    ? { ...scope, needsReview: true, isSplitParent: false, account }
    : { ...scope, isSplitParent: false, account };
}

export async function getTriageItems(userId: string): Promise<TriageItem[]> {
  const [txns, rules, meta] = await Promise.all([
    prisma.transaction.findMany({
      // Currency guard (DECISIONS #135): a withheld non-USD account's rows must not appear in the
      // categorization inbox either (consistency with /accounts + the register).
      where: {
        needsReview: true,
        account: { userId, type: { in: [...SPENDING_ACCOUNT_TYPES] }, OR: [{ currency: null }, { currency: 'USD' }] },
      },
      include: { account: { select: { name: true } }, merchant: true },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    }),
    loadUserRules(userId), // the user's own rules drive suggestions (cycle-1 C2)
    getCategoryMeta(userId), // a custom-category suggestion (via a user rule) resolves its name (#111)
  ]);

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
    );
    const suggested = out.categoryId === 'uncategorized' ? bestGuess(t.amountCents) : out.categoryId;
    const aggregate = normalizeMerchant(t.rawDescriptor).aggregate;
    const ruleEligible = !aggregate;
    const pool = suggestAlternatives({
      rawDescriptor: t.rawDescriptor,
      amountCents: t.amountCents,
      date: t.date,
      accountId: t.accountId,
    });
    // always exactly 3 alternatives, never duplicating the suggestion
    const alts = [...new Set([...pool, 'dining', 'groceries', 'household', 'cash'])]
      .filter((c) => c !== suggested)
      .slice(0, 3);
    const similarCount = t.merchantId
      ? await prisma.transaction.count({
          where: similarTransactionsWhere(userId, {
            merchantId: t.merchantId,
            rawDescriptor: t.rawDescriptor,
            aggregate,
          }),
        })
      : 1;
    items.push({
      id: t.id,
      date: t.date,
      rawDescriptor: t.rawDescriptor,
      merchantCanonical: t.merchant?.canonical ?? out.merchantCanonical,
      merchantId: t.merchantId,
      amountCents: t.amountCents,
      accountName: t.account.name,
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

/** A triage group enriched with display names + quick-pick alternatives. */
export interface TriageGroupView extends TriageGroup {
  suggestedCategoryName: string | null;
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
  const [txns, rules, meta] = await Promise.all([
    prisma.transaction.findMany({
      // Currency guard (DECISIONS #135): withheld non-USD rows never enter the inbox.
      where: {
        needsReview: true,
        account: { userId, type: { in: [...SPENDING_ACCOUNT_TYPES] }, OR: [{ currency: null }, { currency: 'USD' }] },
      },
      include: { account: { select: { name: true } }, merchant: true },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    }),
    loadUserRules(userId),
    getCategoryMeta(userId),
  ]);

  const reviewRows: ReviewRow[] = txns.map((t) => {
    const out = categorize(
      { rawDescriptor: t.rawDescriptor, amountCents: t.amountCents, date: t.date, accountId: t.accountId },
      rules,
    );
    return {
      id: t.id,
      merchantId: t.merchantId,
      merchantCanonical: t.merchant?.canonical ?? out.merchantCanonical,
      rawDescriptor: t.rawDescriptor,
      amountCents: t.amountCents,
      date: t.date,
      accountName: t.account.name,
      status: t.status,
      aggregate: normalizeMerchant(t.rawDescriptor).aggregate,
      suggestedCategoryId: out.categoryId === 'uncategorized' ? null : out.categoryId,
    };
  });

  const anchors = new Map(txns.map((t) => [t.id, t]));
  return groupReviewRows(reviewRows).map((g) => {
    const anchor = anchors.get(g.anchorTransactionId);
    const pool = anchor
      ? suggestAlternatives({
          rawDescriptor: anchor.rawDescriptor,
          amountCents: anchor.amountCents,
          date: anchor.date,
          accountId: anchor.accountId,
        })
      : [];
    const alts = [...new Set([...pool, 'dining', 'groceries', 'household', 'cash'])]
      .filter((c) => c !== g.suggestedCategoryId)
      .slice(0, 3);
    return {
      ...g,
      suggestedCategoryName: g.suggestedCategoryId ? categoryName(g.suggestedCategoryId, meta) : null,
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
    where: {
      needsReview: true,
      account: { userId, type: { in: [...SPENDING_ACCOUNT_TYPES] }, OR: [{ currency: null }, { currency: 'USD' }] },
    },
    select: { merchantId: true, rawDescriptor: true, merchant: { select: { canonical: true } } },
  });
  const keys = new Set(
    rows.map((r) =>
      groupKey({
        merchantId: r.merchantId,
        rawDescriptor: r.rawDescriptor,
        merchantCanonical: r.merchant?.canonical ?? r.rawDescriptor,
        aggregate: normalizeMerchant(r.rawDescriptor).aggregate,
      }),
    ),
  );
  return keys.size;
}
