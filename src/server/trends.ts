/**
 * Spending Trends data (DECISIONS #74). Derives the trend insights from the
 * SAME finance snapshot every other view reads, so the numbers can't drift from
 * /reports or /spending-plan. Pure engine does all the math; this only shapes
 * the input (canonical merchant + aggregate flag from the shared normalizer,
 * exactly as the coach's life-energy view does).
 *
 * O.6 — that "can't drift" sentence was FALSE when it was written, and the two
 * clauses that falsified it were both in this file's own shaping step. Both are
 * gone; the note stays so neither comes back:
 *
 *  1. `.filter((t) => t.status === 'POSTED')`. The snapshot carries pending rows
 *     and /reports, Ask and the register all count them, so every trends figure
 *     was quietly smaller than the same month on every other page. The primary
 *     reason to remove it is that agreement: a mover figure is now a clickable
 *     claim that the register shows the same rows.
 *
 *     There is a second, smaller effect, and it is worth stating precisely
 *     because the first draft of this comment got its timing backwards (caught by
 *     a critic). The baselines are long settled while the COMPARED month — the
 *     last completed one — can still hold pending charges from its final days.
 *     That shortfall lands on one side of the comparison, biasing a mover
 *     downward. It peaks in the FIRST few days of a month, when the month being
 *     compared closed hours ago; by month-end that month is 31–61 days old and
 *     has essentially nothing pending left (SimpleFIN ages pending out at 32
 *     days). The in-progress month, where pending really is densest, is read by
 *     `pace` and not by the movers.
 *  2. `categoryId: stored ?? normalizeMerchant(...).categoryId`. A row with no
 *     stored category was attributed to whichever category the merchant
 *     normalizer guessed. That guess is not what the register filters on, so the
 *     figure named rows the destination could not show — the same "rows right,
 *     control wrong" hole O.5's `linkable` fence closes, arriving by a different
 *     route. The population is real and specific: an unfiled row restored to the
 *     register with `categoryId: null` and `needsReview: true` is precisely the
 *     row a guess should not quietly file for the reader. (This used to cite
 *     undoSplit as the example. It no longer fits: since O.13b a container KEEPS
 *     its category through a split, so undoing one restores a FILED row — the
 *     reasoning above is unaffected, but the example was falsified and citing a
 *     dead one would send the next reader to the wrong conclusion.)
 *
 * The stored category is now the only category, so an unfiled row reads as
 * Uncategorized here exactly as it does everywhere else, and the movers list
 * skips it (the engine already excludes the non-actionable group) instead of
 * ranking a guess.
 */
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { computeSpendingTrends, type SpendingTrends, type TrendTxn } from '@/lib/engine/trends/trends';
import { getProvider } from '@/lib/providers/demo';
import { getCategoryMeta } from '@/server/category-meta';

/**
 * The snapshot → engine shaping step, exported PURE so it can be tested (O.6
 * critic P1-4).
 *
 * It was inline in `getSpendingTrends`, and the critic's finding was that no test
 * in the repo imported this file at all: both of the narrowings O.6 removed could
 * be re-added and the whole suite stayed green, because the demo seed's only
 * pending rows are in the in-progress month (movers compare the month before it)
 * and it holds zero null-category rows. A defect whose fix nothing can fail on is
 * a defect waiting to come back. Pulling four lines out into a pure function is
 * what makes the intake assertable at all — the unit suite now pins each field.
 */
export function toTrendTxns(
  rows: readonly {
    date: string;
    amountCents: number;
    rawDescriptor: string;
    status: string;
    isTransfer: boolean;
    // Optional to match `TransactionLike`, which the snapshot is typed as; every
    // real row carries it and the engine treats a missing flag as false.
    isSplitParent?: boolean;
    excludeFromTotals?: boolean | null;
  }[],
): TrendTxn[] {
  return rows.map((t) => {
    // Snapshot rows are full transactions at runtime; categoryId isn't on the
    // minimal TransactionLike type, so read it through a narrow cast (the same
    // stored category /reports relies on).
    const stored = (t as { categoryId?: string | null }).categoryId ?? null;
    const m = normalizeMerchant(t.rawDescriptor);
    return {
      date: t.date,
      amountCents: t.amountCents,
      // STORED ONLY. This is the bucket a category FIGURE sums into, and a mover
      // figure is a clickable claim that the register shows the same rows — so it
      // may never hold a value the register cannot filter on.
      categoryId: stored,
      // The merchant table's category, CARRIED rather than merged (O.6 critic P0):
      // the engine merges it for the two row-naming insights and never for a
      // category figure. Merging it here — which is what this file used to do —
      // put a derived category into a figure the register cannot reproduce;
      // dropping it entirely was worse still, because everything in
      // `Transfers & Other` is non-actionable, so an unfiled row VANISHED from
      // "biggest purchases" instead of being labelled.
      merchantCategoryId: m.categoryId,
      // Carried, not filtered on: the engine decides which of its insights want
      // settled rows (O.6). Filtering here is what made every trends figure
      // disagree with every other page in the first place.
      status: t.status,
      isTransfer: t.isTransfer,
      isSplitParent: t.isSplitParent,
      // O.15: carried so both trends predicates drop reader-excluded rows.
      excludeFromTotals: t.excludeFromTotals ?? false,
      merchant: m.canonical,
      aggregateMerchant: m.aggregate,
    };
  });
}

export async function getSpendingTrends(userId: string): Promise<SpendingTrends> {
  const provider = getProvider();
  const today = provider.today(userId);
  const [snap, meta] = await Promise.all([
    provider.getFinanceSnapshot(userId),
    getCategoryMeta(userId),
  ]);

  return computeSpendingTrends({ txns: toTrendTxns(snap.transactions), today }, meta);
}
