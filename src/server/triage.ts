/**
 * Triage inbox data: transactions needing review, each with the AI suggestion
 * and 3 smart alternatives (computed by the pure pipeline).
 * All queries are row-ownership scoped by userId.
 */
import { prisma } from '@/lib/db';
import { CATEGORIES, categoryName } from '@/lib/engine/categorize/categories';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { categorize, suggestAlternatives } from '@/lib/engine/categorize/pipeline';
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

export async function getTriageItems(userId: string): Promise<TriageItem[]> {
  const [txns, rules] = await Promise.all([
    prisma.transaction.findMany({
      where: { needsReview: true, account: { userId } },
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
    const ruleEligible = !normalizeMerchant(t.rawDescriptor).aggregate;
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
          where: { merchantId: t.merchantId, needsReview: true, account: { userId } },
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
  return prisma.transaction.count({ where: { needsReview: true, account: { userId } } });
}

export const ALL_CATEGORIES = CATEGORIES.filter((c) => c.id !== 'uncategorized').map((c) => ({
  id: c.id,
  name: c.name,
}));
