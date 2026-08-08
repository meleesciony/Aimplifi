/**
 * Synced-account deletion (#253 SimpleFIN, #256 extended to Plaid). Both
 * providers keep already-synced accounts after a disconnect (deliberately — the
 * history is the user's); this module is the capability that removes the ones
 * the user doesn't want counted.
 *
 * Rules:
 *  - Owner-scoped; the shared demo row can never delete. The fence lives HERE in
 *    the core, not the action wrapper, so every caller inherits it
 *    (fence-by-construction lesson).
 *  - Synced provider rows only ('simplefin' | 'plaid'). Manual rows have their
 *    own delete path; demo/seed rows are never user-deletable.
 *  - REFUSED while a sync could resurrect the row: sync pass 1 re-creates any
 *    feed account it doesn't find by providerRef, so a "delete" under a live
 *    connection would silently come back. The refusal rule is the shared
 *    `syncedDeleteBlockReason` predicate — the SAME function the /accounts view
 *    uses to decide whether to show the Delete control, so the guard reads
 *    exactly what it guards:
 *      · simplefin: the (single) SimpleFinConnection row must be gone.
 *      · plaid, with item linkage (plaidItemId): THAT item must be gone — other
 *        banks' live connections don't block, they can't resurrect this row.
 *      · plaid, without linkage (row not re-synced since #256 shipped): the
 *        conservative rule — every Plaid item must be gone, because we cannot
 *        prove which one owns the row.
 *  - Deleting cascades the account's transactions / statements / snapshots /
 *    holdings / scheduled rows (schema `onDelete: Cascade`). If the deleted row
 *    was the designated payment account, that dial is cleared in the same
 *    transaction — readers already fall back when the id dangles
 *    (resolvePaymentAccount), this keeps the stored dial honest.
 */
import { prisma } from '@/lib/db';
import type { ISODate } from '@/lib/dates';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { refreshRecurringForUser } from '@/server/recurring';

export interface DeleteSyncedAccountResult {
  ok: boolean;
  errors?: string[];
}

const DISCONNECT_FIRST =
  'Disconnect the bank first (Bank sync, below) — while it’s connected, the next sync would just bring this account back.';

/**
 * The single deletable/refused rule, shared by the /accounts view (whether to
 * render the Delete control) and the transaction guard below (whether to commit).
 * Returns null when deletable, else the user-facing refusal reason.
 * Pure — callers supply the connection state they read.
 */
export function syncedDeleteBlockReason(
  account: { provider: string; plaidItemId: string | null; feedDroppedAt: string | null },
  ctx: { simplefinConnected: boolean; plaidItemIds: readonly string[] },
): string | null {
  // TASKS L.14. Each refusal below rests on ONE premise: the next sync would bring this row back.
  // For a row the feed has stopped returning, that premise is false — the account is no longer in
  // the census, so no sync can re-create it. Refusing would leave a permanently frozen balance the
  // user is told to fix by disconnecting an otherwise healthy bank: a worse instruction than the
  // problem. Checked INSIDE each synced arm rather than at the top, so a stamp can never promote a
  // manual or demo row into something this path will delete — it overrides the resurrection
  // premise, nothing else. The simplefin arm is inert today (only Plaid stamps) but correct if it
  // ever does, which is cheaper than a provider special-case here.
  if (account.provider === 'simplefin') {
    if (account.feedDroppedAt !== null) return null;
    return ctx.simplefinConnected ? DISCONNECT_FIRST : null;
  }
  if (account.provider === 'plaid') {
    if (account.feedDroppedAt !== null) return null;
    if (account.plaidItemId !== null) {
      return ctx.plaidItemIds.includes(account.plaidItemId) ? DISCONNECT_FIRST : null;
    }
    // No item linkage recorded — refuse while ANY item remains (conservative:
    // one of them may own this row and would resurrect it on its next sync).
    return ctx.plaidItemIds.length > 0 ? DISCONNECT_FIRST : null;
  }
  return 'Only bank-synced accounts can be deleted here.';
}

export async function deleteDisconnectedSyncedAccountFor(
  userId: string,
  accountId: string,
  today: ISODate,
): Promise<DeleteSyncedAccountResult> {
  if (isDemoUser(userId)) return { ok: false, errors: [DEMO_ENTRY_BLOCKED] };
  const a = await prisma.account.findFirst({
    where: { id: accountId, userId },
    select: { id: true, provider: true, plaidItemId: true, feedDroppedAt: true },
  });
  if (!a) return { ok: false, errors: ['Account not found.'] };
  if (a.provider !== 'simplefin' && a.provider !== 'plaid') {
    return { ok: false, errors: ['Only bank-synced accounts can be deleted here.'] };
  }
  // EVERY input the predicate judges is re-read INSIDE the transaction (#253
  // critic F2, re-found as #256 critic P1-1): the connection state AND the
  // account's own linkage row. Judged from a pre-transaction snapshot, a
  // concurrent re-link/sync stamping `plaidItemId` to a live item in the gap
  // would delete-then-resurrect — the exact lie the guard exists to prevent.
  // Inside, the check and the delete commit or refuse together.
  const blockReason = await prisma.$transaction(async (tx) => {
    const [fresh, conn, items] = await Promise.all([
      tx.account.findFirst({
        where: { id: accountId, userId },
        // feedDroppedAt joins the re-read set for the same reason plaidItemId did (#256 critic
        // P1-1): a sync landing in the gap can CLEAR it — the account came back — and a delete
        // authorised by the stale value would remove a row the very next sync re-creates,
        // history and all, which is precisely the lie this transaction exists to prevent.
        select: { provider: true, plaidItemId: true, feedDroppedAt: true },
      }),
      tx.simpleFinConnection.findUnique({ where: { userId } }),
      tx.plaidItem.findMany({ where: { userId }, select: { itemId: true } }),
    ]);
    if (!fresh) return 'Account not found.';
    const reason = syncedDeleteBlockReason(fresh, {
      simplefinConnected: conn !== null,
      plaidItemIds: items.map((i) => i.itemId),
    });
    if (reason) return reason;
    await tx.account.delete({ where: { id: accountId } });
    await tx.user.updateMany({
      where: { id: userId, paymentAccountId: accountId },
      data: { paymentAccountId: null },
    });
    // C.23 / DECISIONS #431 — a deleted account must not stay named as the
    // reserves' holding home: the settings clause would print the name of an
    // account that no longer exists. Cleared in the same transaction, like
    // `paymentAccountId` above.
    await tx.user.updateMany({
      where: { id: userId, reserveHoldingAccountId: accountId },
      data: { reserveHoldingAccountId: null },
    });
    return null;
  });
  if (blockReason) return { ok: false, errors: [blockReason] };
  // Recompute recurring series + scheduled projections now that the account's
  // history is gone (#253 critic F3): with the connection disconnected, no sync
  // remains to trigger this — without it, stale RecurringSeries rows for the
  // deleted account's merchants would persist indefinitely.
  await refreshRecurringForUser(userId, today);
  // Audit logging lives in the action wrapper (networth-actions.ts), matching the
  // deleteManualAccount precedent — authz imports next-auth, which this core must
  // not pull in (it runs under vitest against the real Prisma client).
  return { ok: true };
}
