/**
 * Shared cross-account transfer refresh (#165) — ONE implementation for every
 * sync source (Plaid + SimpleFIN previously carried drifting inline copies).
 *
 * The pure engine (planTransferUpdates) decides; this applies:
 *  - flagIds → isTransfer: true (the pre-existing behavior);
 *  - fileIds → ALSO categoryId 'transfer' + needsReview false + transfer
 *    confidence. The old add-flag-only update left a pair-detected row whose
 *    descriptor the normalizer doesn't know (e.g. "CREDIT CARD PAID") excluded
 *    from every sum yet wedged in the triage queue under a wrong guess.
 * Flags are only ever ADDED (never unflag a descriptor-based transfer), and a
 * user-resolved or review-pinned row is never re-filed (see the engine's plan).
 */
import { prisma } from '@/lib/db';
import {
  PAIR_TRANSFER_CONFIDENCE_BPS,
  planTransferUpdates,
} from '@/lib/engine/categorize/transfers';
import { ensureCategories } from '@/server/ensure-categories';

export async function refreshTransferFlags(
  userId: string,
): Promise<{ flagged: number; filed: number }> {
  const rows = await prisma.transaction.findMany({
    where: { account: { userId }, isSplitParent: false },
    select: {
      id: true,
      accountId: true,
      date: true,
      amountCents: true,
      rawDescriptor: true,
      isTransfer: true,
      needsReview: true,
      reviewPinned: true,
      status: true,
      account: { select: { currency: true } },
    },
  });
  const txns = rows.map((r) => ({
    ...r,
    // Same supported-currency predicate every queue/write guard uses (DECISIONS #135).
    currencySupported: r.account.currency === null || r.account.currency === 'USD',
  }));
  const { flagIds, fileIds } = planTransferUpdates(txns);

  let flagged = 0;
  let filed = 0;
  if (flagIds.length) {
    const res = await prisma.transaction.updateMany({
      where: { id: { in: flagIds } },
      data: { isTransfer: true },
    });
    flagged = res.count;
  }
  if (fileIds.length) {
    // The 'transfer' Category row must exist to satisfy the FK on a fresh
    // database — same guard applyCategory/backfill use (#65).
    await ensureCategories();
    const res = await prisma.transaction.updateMany({
      // Re-assert EVERY read guard in the write (the backfill cycle-5
      // precedent, #165 cycle-2 checker): a row the user files or PINS inside
      // the read→write window (which contains the awaited ensureCategories
      // call) is skipped, not clobbered — otherwise a sync could overwrite a
      // just-committed decision or mint the unclearable pinned-but-filed state.
      where: {
        id: { in: fileIds },
        needsReview: true,
        reviewPinned: false,
        status: 'POSTED',
        account: { userId, OR: [{ currency: null }, { currency: 'USD' }] },
      },
      data: {
        isTransfer: true,
        categoryId: 'transfer',
        needsReview: false,
        confidenceBps: PAIR_TRANSFER_CONFIDENCE_BPS,
      },
    });
    filed = res.count;
  }
  // Honest counts: what the guarded writes actually mutated, not what the
  // stale read planned.
  return { flagged, filed };
}
