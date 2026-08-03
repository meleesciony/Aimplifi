/**
 * Transfer detection (Phase 2 acceptance #7): credit-card payments and
 * own-account transfers must be excluded from spending/income.
 *
 * Detection = descriptor heuristics OR a matched opposite-amount pair across
 * two of the user's own accounts within ±3 days.
 */
import { daysBetween, isoDate } from '@/lib/dates';
import { PAYMENT_ACCOUNT_TYPES } from '@/lib/engine/settings/dials';
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

/** Account types a loan payment's pair counterpart can sit on (Plaid maps
 *  loan+mortgage → 'MORTGAGE', other loans → 'LOAN'; plaid-map.ts). */
export const LOAN_ACCOUNT_TYPES: ReadonlySet<string> = new Set(['LOAN', 'MORTGAGE']);

export interface LoanPairTxn {
  accountId: string;
  date: string;
  amountCents: number;
  rawDescriptor: string;
  isTransfer?: boolean;
}

/**
 * The merchant canonicals that are LOAN PAYMENTS in disguise (C.24, measured
 * live in C.0/#393): a transfer-flagged OUTFLOW on a cash (payment) account
 * whose pair counterpart — same |amount|, opposite sign, ±3 days, the same
 * rule `detectTransfers` applies — sits on a linked LOAN/MORTGAGE account.
 *
 * Identified STRUCTURALLY, never by descriptor vocabulary: the problem only
 * exists when such a liability is linked, which is exactly when the pair is
 * identifiable (the owner's $6,217.07 Truist mortgage paired against the
 * Plaid MORTGAGE account's `Payment` inflow in the months settlement landed
 * within the window). The class is PER MERCHANT, not per row — a payee whose
 * outflows pair in SOME months is one payee, not two classes of row — so one
 * paired month classifies every month, which is what lets the Fixed union
 * stop being timing luck (a 4-day settlement or a missing counterpart row
 * left that month's payment looking like ordinary rent spend).
 *
 * Consumers: recurring detection keeps the merchant's flagged rows (the
 * auto-loan precedent); the Fixed rollup then drops ALL of the merchant's
 * rows — but only once its series actually made the union (the server's
 * exactness invariant: excluded ⇔ unioned), which is what kills the
 * partial-coverage trap — one counted month ÷ a 3-month divisor printed
 * "rent $2,072.36" — without ever dropping a bill detection could not
 * series. The union adds the series at its monthly rate unconditionally.
 */
export function loanPaymentMerchantCanonicals(
  transactions: readonly LoanPairTxn[],
  accountTypeById: ReadonlyMap<string, string>,
): Set<string> {
  const loanInflowsByAmount = new Map<number, LoanPairTxn[]>();
  for (const t of transactions) {
    if (t.amountCents <= 0) continue;
    if (!LOAN_ACCOUNT_TYPES.has(accountTypeById.get(t.accountId) ?? '')) continue;
    const list = loanInflowsByAmount.get(t.amountCents) ?? [];
    list.push(t);
    loanInflowsByAmount.set(t.amountCents, list);
  }
  const out = new Set<string>();
  for (const t of transactions) {
    if (t.amountCents >= 0 || t.isTransfer !== true) continue;
    if (!(PAYMENT_ACCOUNT_TYPES as readonly string[]).includes(accountTypeById.get(t.accountId) ?? '')) {
      continue;
    }
    const m = normalizeMerchant(t.rawDescriptor);
    // An aggregate canonical ('Check', 'Zelle Payment', …) is ONE NAME OVER
    // MANY PAYEES, not one merchant (the C.4 doctrine) — classifying it would
    // strip every unrelated payee sharing the name from the rollup with no
    // single series to re-enter their money (critic cycle 1, F3).
    if (m.aggregate) continue;
    const candidates = loanInflowsByAmount.get(-t.amountCents);
    if (candidates === undefined) continue;
    for (const b of candidates) {
      if (b.accountId === t.accountId) continue;
      if (Math.abs(daysBetween(isoDate(t.date), isoDate(b.date))) <= 3) {
        out.add(m.canonical);
        break;
      }
    }
  }
  return out;
}
