/**
 * Spending Trends data (DECISIONS #74). Derives the trend insights from the
 * SAME finance snapshot every other view reads, so the numbers can't drift from
 * /reports or /spending-plan. Pure engine does all the math; this only shapes
 * the input (POSTED rows; stored category wins; canonical merchant + aggregate
 * flag from the shared normalizer, exactly as the coach's life-energy view does).
 */
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { computeSpendingTrends, type SpendingTrends, type TrendTxn } from '@/lib/engine/trends/trends';
import { getProvider } from '@/lib/providers/demo';

export async function getSpendingTrends(userId: string): Promise<SpendingTrends> {
  const provider = getProvider();
  const today = provider.today(userId);
  const snap = await provider.getFinanceSnapshot(userId);

  const txns: TrendTxn[] = snap.transactions
    .filter((t) => t.status === 'POSTED')
    .map((t) => {
      // Snapshot rows are full transactions at runtime; categoryId isn't on the
      // minimal TransactionLike type, so read it through a narrow cast (the same
      // stored category /reports relies on). Fall back to the normalizer default.
      const stored = (t as { categoryId?: string | null }).categoryId;
      const m = normalizeMerchant(t.rawDescriptor);
      return {
        date: t.date,
        amountCents: t.amountCents,
        categoryId: stored ?? m.categoryId,
        isTransfer: t.isTransfer,
        isSplitParent: t.isSplitParent,
        merchant: m.canonical,
        aggregateMerchant: m.aggregate,
      };
    });

  return computeSpendingTrends({ txns, today });
}
