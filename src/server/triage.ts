/**
 * Triage inbox data: transactions needing review, each with the AI suggestion
 * and 3 smart alternatives (computed by the pure pipeline).
 * All queries are row-ownership scoped by userId.
 */
import { prisma } from '@/lib/db';
import { CATEGORIES, categoryName } from '@/lib/engine/categorize/categories';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { categorize, suggestAlternatives } from '@/lib/engine/categorize/pipeline';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { loadUserRules } from '@/server/rules';

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
  return onlyNeedsReview
    ? { ...scope, needsReview: true, isSplitParent: false, account: { userId } }
    : { ...scope, isSplitParent: false, account: { userId } };
}

export async function getTriageItems(userId: string): Promise<TriageItem[]> {
  const [txns, rules] = await Promise.all([
    prisma.transaction.findMany({
      where: { needsReview: true, account: { userId, type: { in: [...SPENDING_ACCOUNT_TYPES] } } },
      include: { account: { select: { name: true } }, merchant: true },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    }),
    loadUserRules(userId), // the user's own rules drive suggestions (cycle-1 C2)
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
      suggestedCategoryName: categoryName(suggested),
      alternativeIds: alts,
      alternativeNames: alts.map(categoryName),
      similarCount,
      ruleEligible,
    });
  }
  return items;
}

function bestGuess(amountCents: number): string {
  return amountCents > 0 ? 'income' : 'shopping';
}

export async function getReviewCount(userId: string): Promise<number> {
  return prisma.transaction.count({
    where: { needsReview: true, account: { userId, type: { in: [...SPENDING_ACCOUNT_TYPES] } } },
  });
}

export const ALL_CATEGORIES = CATEGORIES.filter((c) => c.id !== 'uncategorized').map((c) => ({
  id: c.id,
  name: c.name,
  group: c.group,
}));
