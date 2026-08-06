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
 *
 * THE RECONCILIATION BOUNDARY, H.7. This sweep used to be the ONLY transaction
 * read surface in the app that skipped `getReconciliationTxnKeep` — the R1
 * ownership rule the register, CSV export, budgets, recurring detection and
 * triage all apply, under which a reconciled pair's overlap belongs to exactly
 * one side. Reading every row instead meant the sweep saw BOTH copies of a
 * duplicated account's history and paired a row against its own duplicate,
 * defeating the same-account exclusion the pair rule already declares
 * (`transfers.ts`) — a purchase matched its own refund, a Zelle payment matched
 * an unrelated deposit. Measured on the owner's live corpus (26 active links):
 * 1,215 of 3,065 rows were not the boundary's to read, and applying it removed
 * 53 of the 73 settled rows the sweep had silently overturned.
 */
import { prisma } from '@/lib/db';
import {
  PAIR_TRANSFER_CONFIDENCE_BPS,
  planTransferUpdates,
} from '@/lib/engine/categorize/transfers';
import { ensureCategories } from '@/server/ensure-categories';
import { getReconciliationTxnKeep } from '@/server/reconciliation';

export async function refreshTransferFlags(
  userId: string,
): Promise<{ flagged: number; filed: number }> {
  const [rows, keepsReconciled] = await Promise.all([
    prisma.transaction.findMany({
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
        categoryId: true,
        account: { select: { currency: true, type: true } },
      },
    }),
    getReconciliationTxnKeep(userId),
  ]);
  const txns = rows
    .filter((r) => keepsReconciled(r.accountId, r.date))
    .map((r) => ({
      ...r,
      // Same supported-currency predicate every queue/write guard uses (DECISIONS #135).
      currencySupported: r.account.currency === null || r.account.currency === 'USD',
      accountType: r.account.type,
    }));
  const { flagIds, overturnIds, fileIds } = planTransferUpdates(txns);

  let flagged = 0;
  let filed = 0;
  if (flagIds.length) {
    // Re-assert the read guard in the write (the backfill cycle-5 precedent, as
    // the file branch below already does): these ids were planned BECAUSE they
    // carried no verdict to overturn, and a row the user files inside the
    // read->write window now carries one. Skip it rather than reverse a
    // decision that was made a moment ago under a rule it never faced.
    const res = await prisma.transaction.updateMany({
      where: {
        id: { in: flagIds },
        account: { userId },
        OR: [{ needsReview: true }, { categoryId: null }, { categoryId: { in: ['transfer', 'uncategorized'] } }],
      },
      data: { isTransfer: true },
    });
    flagged = res.count;
  }
  if (overturnIds.length) {
    // These DID carry a settled substantive verdict and cleared the evidence
    // bar anyway (descriptor-named transfer, or a directionally coherent pair).
    // No re-assertion: their premise is that a verdict exists, and a row can
    // only become MORE settled inside the window.
    const res = await prisma.transaction.updateMany({
      where: { id: { in: overturnIds }, account: { userId } },
      data: { isTransfer: true },
    });
    flagged += res.count;
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
