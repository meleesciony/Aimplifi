/**
 * Shared cross-account transfer refresh (#165) — ONE implementation for every
 * sync source (Plaid + SimpleFIN previously carried drifting inline copies).
 *
 * The pure engine (planTransferUpdates) decides; this applies:
 *  - flagIds → isTransfer: true (the pre-existing behavior);
 *  - overturnIds → isTransfer: true on a row that already carries a settled
 *    substantive verdict, which only well-evidenced detection may do (H.7);
 *  - fileIds → ALSO categoryId 'transfer' + needsReview false + transfer
 *    confidence. The old add-flag-only update left a pair-detected row whose
 *    descriptor the normalizer doesn't know (e.g. "CREDIT CARD PAID") excluded
 *    from every sum yet wedged in the triage queue under a wrong guess.
 * Flags are only ever ADDED (never unflag a descriptor-based transfer), and a
 * user-resolved or review-pinned row is never re-filed (see the engine's plan).
 *
 * ACCOUNT IDENTITY, H.7. A reconciled pair — the same real account arriving
 * from two providers — made a purchase and its own refund look like two
 * accounts, defeating the same-account exclusion the pair rule already declares
 * and manufacturing a transfer out of two copies of one row. Measured on the
 * owner's live corpus (26 active links): 45 of the 73 settled rows the sweep had
 * silently overturned were this artifact.
 *
 * The fix passes each row its confirmed IDENTITY rather than filtering the read.
 * Cycle 1 did filter the read, through `getReconciliationTxnKeep`, and a critic
 * broke it: that rule disowns a successor row dated inside the predecessor's
 * claim, so when the only copy of a leg is that row the sweep — a WRITER — goes
 * blind to it while every reader still counts its counterpart on the unlinked
 * side. A $123.45 card payment then read as negative spending, taking a month's
 * expenses from $200.00 to $76.55. A writer that guards a flag must see at
 * least everything its readers see, so the boundary belongs in the MATCHING
 * rule, never in the input.
 */
import { prisma } from '@/lib/db';
import {
  NON_COMPETING_CATEGORY_IDS,
  PAIR_TRANSFER_CONFIDENCE_BPS,
  planTransferUpdates,
} from '@/lib/engine/categorize/transfers';
import { ensureCategories } from '@/server/ensure-categories';
import { activeTerminalSuccessorMap } from '@/server/reconciliation';

/** The write-side statement of `!hasCompetingVerdict` — one negation, term for
 * term, built from the engine's own constant so the two cannot drift (cycle-1
 * critic F3: deleting 'uncategorized' from a hand-typed copy passed every test). */
const NO_COMPETING_VERDICT_WHERE = {
  OR: [
    { needsReview: true },
    { categoryId: null },
    { categoryId: { in: [...NON_COMPETING_CATEGORY_IDS] } },
  ],
};

export async function refreshTransferFlags(
  userId: string,
): Promise<{ flagged: number; overturned: number; filed: number }> {
  const [rows, identity] = await Promise.all([
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
    // pred → terminal live successor, over EFFECTIVE links only. Absent from the
    // map (the overwhelming case) a row's identity is its own account.
    activeTerminalSuccessorMap(userId),
  ]);
  const txns = rows.map((r) => ({
    ...r,
    // Same supported-currency predicate every queue/write guard uses (DECISIONS #135).
    currencySupported: r.account.currency === null || r.account.currency === 'USD',
    accountType: r.account.type,
    accountIdentityId: identity.get(r.accountId) ?? r.accountId,
  }));
  const { flagIds, overturnIds, fileIds } = planTransferUpdates(txns);

  let flagged = 0;
  let overturned = 0;
  let filed = 0;
  if (flagIds.length) {
    // Re-assert the read guard in the write (the backfill cycle-5 precedent, as
    // the file branch below already does): these ids were planned BECAUSE they
    // carried no verdict to overturn, and a row the user files inside the
    // read→write window now carries one. Skip it rather than reverse a decision
    // that was made a moment ago under a rule it never faced.
    const res = await prisma.transaction.updateMany({
      where: { id: { in: flagIds }, account: { userId }, ...NO_COMPETING_VERDICT_WHERE },
      data: { isTransfer: true },
    });
    flagged = res.count;
  }
  if (overturnIds.length) {
    // These DID carry a settled substantive verdict and cleared the evidence bar
    // anyway. The premise is re-asserted here too: an earlier version argued a
    // row "can only become MORE settled inside the window", which a critic
    // falsified by executing `undoCorrections` — Undo returns a row to
    // 'uncategorized' + needsReview, and flagging it then mints the wedged
    // needsReview+isTransfer state the triage queue hides, turning the user's
    // request to re-review into a silent transfer filing.
    const res = await prisma.transaction.updateMany({
      where: {
        id: { in: overturnIds },
        account: { userId },
        needsReview: false,
        categoryId: { notIn: [...NON_COMPETING_CATEGORY_IDS] },
      },
      data: { isTransfer: true },
    });
    overturned = res.count;
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
  // Honest counts: what the guarded writes actually mutated, not what the stale
  // read planned — and an OVERTURN is reported separately, because reversing a
  // verdict the owner recorded is the only one of the three worth telling them
  // about (cycle-1 critic P3-7).
  return { flagged, overturned, filed };
}
