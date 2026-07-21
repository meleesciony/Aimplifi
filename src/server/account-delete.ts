/**
 * Synced-account deletion (#253). SimpleFIN keeps already-synced accounts after a
 * disconnect (deliberately — the history is the user's), but until this slice
 * nothing could remove them: the Delete control was manual-only
 * (`ownedManualAccount`), while the disconnect message told the user to "delete
 * any you don't want counted from the lists above" — a control that did not
 * exist (the #221 live-claim class). This module is the missing capability.
 *
 * Rules:
 *  - Owner-scoped; the shared demo row can never delete. The fence lives HERE in
 *    the core, not the action wrapper, so every caller inherits it
 *    (fence-by-construction lesson).
 *  - SimpleFIN provider rows only. Manual rows have their own delete path;
 *    Plaid has no disconnect flow yet, so its "disconnected" precondition is
 *    unreachable (recorded limitation, STATUS #253); demo/seed rows are never
 *    user-deletable.
 *  - REFUSED while the SimpleFIN connection is live: sync pass 1
 *    (providers/simplefin.ts) re-creates any feed account it doesn't find by
 *    providerRef, so a "deleted" row would silently resurrect on the next sync.
 *    Requiring disconnect-first makes the deletion real instead of a lie.
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

export async function deleteDisconnectedSimplefinAccountFor(
  userId: string,
  accountId: string,
  today: ISODate,
): Promise<DeleteSyncedAccountResult> {
  if (isDemoUser(userId)) return { ok: false, errors: [DEMO_ENTRY_BLOCKED] };
  const a = await prisma.account.findFirst({
    where: { id: accountId, userId },
    select: { id: true, provider: true },
  });
  if (!a) return { ok: false, errors: ['Account not found.'] };
  if (a.provider !== 'simplefin') {
    return { ok: false, errors: ['Only SimpleFIN-synced accounts can be deleted here.'] };
  }
  // The connection check lives INSIDE the transaction (#253 critic F2): checked
  // before it, a reconnect landing in the gap would delete-then-resurrect — the
  // exact lie the guard exists to prevent. Inside, the check and the delete
  // commit or refuse together.
  const refused = await prisma.$transaction(async (tx) => {
    const conn = await tx.simpleFinConnection.findUnique({ where: { userId } });
    if (conn) return true;
    await tx.account.delete({ where: { id: accountId } });
    await tx.user.updateMany({
      where: { id: userId, paymentAccountId: accountId },
      data: { paymentAccountId: null },
    });
    return false;
  });
  if (refused) return { ok: false, errors: [DISCONNECT_FIRST] };
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
