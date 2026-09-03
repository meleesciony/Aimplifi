/**
 * Accounts a household may move a transaction onto. Spending, USD, not a
 * superseded predecessor (unless it is the row's current account, so the
 * picker can still name where it sits today).
 */
import { prisma } from '@/lib/db';
import { accountLabel } from '@/lib/engine/account/display-name';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { activeSupersededPredecessorIds } from '@/server/reconciliation';

export async function listTxnMoveAccounts(
  userId: string,
  currentAccountId: string,
): Promise<{ id: string; name: string }[]> {
  const [all, superseded] = await Promise.all([
    prisma.account.findMany({
      where: {
        userId,
        type: { in: [...SPENDING_ACCOUNT_TYPES] },
        OR: [{ currency: null }, { currency: 'USD' }],
      },
      select: { id: true, name: true, displayName: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }),
    activeSupersededPredecessorIds([userId]),
  ]);
  return all
    .filter((a) => !superseded.has(a.id) || a.id === currentAccountId)
    .map((a) => ({ id: a.id, name: accountLabel(a) }));
}
