/**
 * Transfer detection (Phase 2 acceptance #7): credit-card payments and
 * own-account transfers must be excluded from spending/income.
 *
 * Detection = descriptor heuristics OR a matched opposite-amount pair across
 * two of the user's own accounts within ±3 days.
 */
import { daysBetween, isoDate } from '@/lib/dates';
import { normalizeMerchant } from './normalize';

/** The confidence a descriptor-recognized transfer verdict carries (pipeline.ts). */
export const TRANSFER_CONFIDENCE_BPS = 9900;

/** The confidence a PAIR-ONLY filing carries (#165 critic F3): pair matching is
 * a heuristic (any exact opposite-amount coincidence across accounts within ±3
 * days), so its filing sits in the FLAGGED band — visible AI-badge provenance,
 * distinguishable from a normalizer-known "ONLINE TRANSFER". */
export const PAIR_TRANSFER_CONFIDENCE_BPS = 8500;

export interface TransferTxn {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  rawDescriptor: string;
  isSplitParent?: boolean;
}

export function detectTransfers(transactions: readonly TransferTxn[]): Set<string> {
  const transferIds = new Set<string>();

  // Descriptor heuristic goes THROUGH the normalizer (one decision path —
  // critic F4): a descriptor is transfer-like only if the merchant table says
  // so. The auto-loan ACH is an own-obligation payment, excluded from
  // income/expense like a transfer.
  for (const t of transactions) {
    const categoryId = normalizeMerchant(t.rawDescriptor).categoryId;
    if (categoryId === 'transfer' || categoryId === 'auto-loan') transferIds.add(t.id);
  }

  // Pair matching: equal/opposite amounts, different accounts, within 3 days.
  const byAmount = new Map<number, TransferTxn[]>();
  for (const t of transactions) {
    const list = byAmount.get(Math.abs(t.amountCents)) ?? [];
    list.push(t);
    byAmount.set(Math.abs(t.amountCents), list);
  }
  for (const [, group] of byAmount) {
    for (const a of group) {
      if (a.amountCents >= 0) continue;
      for (const b of group) {
        if (b.amountCents <= 0 || b.accountId === a.accountId) continue;
        if (Math.abs(daysBetween(isoDate(a.date), isoDate(b.date))) <= 3) {
          transferIds.add(a.id);
          transferIds.add(b.id);
        }
      }
    }
  }

  return transferIds;
}

/** A transaction with the persisted state planTransferUpdates needs to decide
 * flag-vs-file. */
export interface TransferStateTxn extends TransferTxn {
  isTransfer: boolean;
  needsReview: boolean;
  reviewPinned: boolean;
  /** PENDING rows are flagged but never FILED (#165 critic F3): a pending
   * amount can settle differently under a new id, leaving a one-sided filing. */
  status: string;
  /** Rows on withheld (non-USD) accounts are flagged but never FILED — the
   * currency guard (DECISIONS #135) withholds them from every system write. */
  currencySupported: boolean;
}

export interface TransferUpdatePlan {
  /** Newly detected transfers → set isTransfer: true. */
  flagIds: string[];
  /** Detected transfers still awaiting review → ALSO file them: categoryId
   * 'transfer', needsReview false, PAIR_TRANSFER_CONFIDENCE_BPS (flagged band). */
  fileIds: string[];
}

/**
 * Split detected transfers into flag-only vs file (#165). The old add-flag-only
 * update left a pair-detected row (descriptor unrecognized, e.g. "CREDIT CARD
 * PAID") excluded from every sum yet WEDGED in the triage queue with a wrong
 * guessed category. Filing rules:
 *  - only rows still needsReview are filed — a user-resolved category is never
 *    clobbered (the #148 resync-clobber lesson);
 *  - reviewPinned rows are the user's to decide, never the system's (the
 *    backfill cycle-5 precedent) — flag but don't file;
 *  - PENDING and withheld-currency rows are flagged but never filed (critic F3);
 *  - already-flagged rows still needsReview ARE filed (heals rows wedged by
 *    the pre-#165 flag-only path).
 */
export function planTransferUpdates(transactions: readonly TransferStateTxn[]): TransferUpdatePlan {
  const detected = detectTransfers(transactions);
  const flagIds: string[] = [];
  const fileIds: string[] = [];
  for (const t of transactions) {
    if (!detected.has(t.id)) continue;
    if (!t.isTransfer) flagIds.push(t.id);
    if (t.needsReview && !t.reviewPinned && t.status === 'POSTED' && t.currencySupported) {
      fileIds.push(t.id);
    }
  }
  return { flagIds, fileIds };
}

/** Sum spending (outflows) excluding transfers — the aggregation Phase 3 uses. */
export function spendingExcludingTransfers(
  transactions: readonly TransferTxn[],
  transferIds: Set<string>,
): number {
  let total = 0;
  for (const t of transactions) {
    if (t.amountCents < 0 && !transferIds.has(t.id) && !t.isSplitParent) total += -t.amountCents;
  }
  return total;
}

/** Sum income (inflows) excluding transfers. */
export function incomeExcludingTransfers(
  transactions: readonly TransferTxn[],
  transferIds: Set<string>,
): number {
  let total = 0;
  for (const t of transactions) {
    if (t.amountCents > 0 && !transferIds.has(t.id) && !t.isSplitParent) total += t.amountCents;
  }
  return total;
}
