/**
 * Lightweight recent-transaction strip for the dashboard (owner 2026-08-01).
 * Not the full register — latest rows plus how many register rows still need a category.
 */
import { prisma } from '@/lib/db';
import { categoryName } from '@/lib/engine/categorize/categories';
import { registerDisplayName } from '@/lib/engine/transactions/display-name';
import { isUnclassifiedTxn, SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { handoverKey } from '@/lib/engine/account/reconcile-boundary';
import { getCategoryMeta } from '@/server/category-meta';
import { getReconciliationBoundary } from '@/server/reconciliation';

export interface DashboardRecentTxn {
  id: string;
  date: string;
  merchantName: string;
  categoryName: string;
  amountCents: number;
  /** True when the row still needs a human filing decision. */
  needsFile: boolean;
  /**
   * U.30: whether this row sits on a day the boundary released to BOTH sides of a
   * combined pair, so a transaction both connections reported is listed here
   * twice. REQUIRED, same reasoning as `TxnView.onHandoverDay` (query.ts) — this
   * is the FIRST screen a reader sees and previously carried no reconciliation
   * vocabulary at all, not even the account name the register at least has.
   */
  onHandoverDay: boolean;
}

export interface DashboardRecentResult {
  rows: DashboardRecentTxn[];
  /** Register rows that still need a category — same promise as Activity's Needs a category chip. */
  needsFileCount: number;
}

function labelFor(
  id: string | null | undefined,
  meta: ReadonlyMap<string, { name: string }>,
  joined?: string | null,
): string {
  if (!id) return categoryName(null);
  return meta.get(id)?.name ?? joined ?? categoryName(id);
}

export async function getDashboardRecent(
  userId: string,
  limit = 6,
): Promise<DashboardRecentResult> {
  // U.31: keep + handover keys from ONE read of the link table (`getReconciliationBoundary`)
  // rather than the two separate calls this used to make — the shape `getAccountsView`
  // (transactions.ts, critic F-4) already argued against: independently re-reading the link
  // table twice leaves a window where a confirm/undo landing between the two reads desyncs
  // one output from the other.
  const accountWhere = {
          userId,
          type: { in: [...SPENDING_ACCOUNT_TYPES] },
          OR: [{ currency: null }, { currency: 'USD' }],
        };
  const [raw, meta, { keepsReconciled, handoverKeys }, unclassifiedCandidates] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        account: accountWhere,
        isSplitParent: false,
      },
      include: {
        merchant: true,
        category: { select: { name: true } },
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      // Over-fetch so reconciliation drops still leave a full strip.
      take: Math.max(limit * 3, 24),
    }),
    getCategoryMeta(userId),
    getReconciliationBoundary(userId),
    prisma.transaction.findMany({
      where: {
        account: accountWhere,
        isSplitParent: false,
        OR: [{ needsReview: true }, { categoryId: 'uncategorized' }, { categoryId: null }],
      },
      select: { accountId: true, date: true },
    }),
  ]);

  const rows: DashboardRecentTxn[] = [];
  for (const t of raw) {
    if (!keepsReconciled(t.accountId, t.date)) continue;
    const catId = t.categoryId ?? null;
    const needsFile = isUnclassifiedTxn({
      needsReview: t.needsReview,
      categoryId: catId ?? 'uncategorized',
    });
    rows.push({
      id: t.id,
      date: t.date,
      merchantName: registerDisplayName(t),
      categoryName: labelFor(catId, meta, t.category?.name),
      amountCents: t.amountCents,
      needsFile,
      onHandoverDay: handoverKeys.has(handoverKey(t.accountId, t.date)),
    });
    if (rows.length >= limit) break;
  }

  const needsFileCount = unclassifiedCandidates.filter((r) => keepsReconciled(r.accountId, r.date)).length;
  return { rows, needsFileCount };
}
