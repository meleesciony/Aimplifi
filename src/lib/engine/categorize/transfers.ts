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

/**
 * Account types money can LEAVE for another of the user's accounts (H.7).
 *
 * An OUTFLOW on a credit line is a purchase or an interest charge — money spent
 * at a merchant, not money moved to another account — so it cannot be the
 * sending leg of a transfer. Cash and brokerage accounts can send.
 *
 * This is a HEURISTIC with real counterexamples (a balance transfer debits the
 * receiving card; a cash advance sends from a card), which is exactly why it is
 * used ONLY as the extra evidence required to OVERTURN a settled verdict
 * (`planTransferUpdates`) and never to suppress detection generally: refusing
 * to overturn leaves the row exactly as its owner filed it, so the heuristic's
 * failure mode is inaction, not a rewrite.
 */
export const CAN_SEND_ACCOUNT_TYPES: ReadonlySet<string> = new Set(['CHECKING', 'SAVINGS', 'INVESTMENT']);

/** A matched pair: the leg money left, and the leg it arrived on. */
export interface TransferPair {
  outflow: TransferTxn;
  inflow: TransferTxn;
}

/**
 * The pair rule, in ONE place: equal/opposite amounts, different accounts,
 * within ±3 days. Both `detectTransfers` and the overturn gate read it, so a
 * row and the evidence cited for it can never come from two different rules
 * (the L.30 idiom — implement the reason and the result in terms of each other).
 */
function matchTransferPairs<T extends TransferTxn>(transactions: readonly T[]): Array<{ outflow: T; inflow: T }> {
  const byAmount = new Map<number, T[]>();
  for (const t of transactions) {
    const list = byAmount.get(Math.abs(t.amountCents)) ?? [];
    list.push(t);
    byAmount.set(Math.abs(t.amountCents), list);
  }
  const pairs: Array<{ outflow: T; inflow: T }> = [];
  for (const [, group] of byAmount) {
    for (const a of group) {
      if (a.amountCents >= 0) continue;
      for (const b of group) {
        if (b.amountCents <= 0 || b.accountId === a.accountId) continue;
        if (Math.abs(daysBetween(isoDate(a.date), isoDate(b.date))) <= 3) {
          pairs.push({ outflow: a, inflow: b });
        }
      }
    }
  }
  return pairs;
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
  for (const { outflow, inflow } of matchTransferPairs(transactions)) {
    transferIds.add(outflow.id);
    transferIds.add(inflow.id);
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
  /** The row's settled verdict, if it has one. A substantive category on a
   * resolved row is a RECORDED ANSWER a pair-only guess must not silently
   * overturn (H.7) — see `hasCompetingVerdict`. */
  categoryId: string | null;
  /** The type of the account this row sits on (CHECKING | SAVINGS | CREDIT |
   * INVESTMENT | LOAN | MORTGAGE …) — the overturn gate reads the SENDING
   * leg's type. */
  accountType: string;
}

/**
 * Categories that assert nothing a transfer flag would contradict: no verdict
 * yet ('uncategorized'), or a verdict that already agrees ('transfer').
 */
const NON_COMPETING_CATEGORY_IDS: ReadonlySet<string> = new Set(['transfer', 'uncategorized']);

/**
 * Whether this row already carries an answer that a pair-only guess would be
 * OVERTURNING rather than supplying (H.7).
 *
 * `needsReview: false` is the repo's existing meaning of "resolved" — it is
 * what the FILE branch below has always used to refuse clobbering a category
 * (#148) — and it covers both a hand-filed row and one the pipeline auto-filed
 * confidently. There is no column distinguishing those two, and this gate does
 * not need one: both are recorded answers, and neither should be reversed
 * without evidence.
 */
export function hasCompetingVerdict(t: TransferStateTxn): boolean {
  return !t.needsReview && t.categoryId !== null && !NON_COMPETING_CATEGORY_IDS.has(t.categoryId);
}

export interface TransferUpdatePlan {
  /** Newly detected transfers with NO competing verdict → set isTransfer: true. */
  flagIds: string[];
  /** Newly detected transfers that DO carry a settled substantive verdict and
   * carry evidence enough to overturn it (H.7): a descriptor the merchant table
   * itself calls a transfer, or a directionally coherent pair. Planned — and
   * written — separately from `flagIds` because the two answer different
   * questions, and only `flagIds` can have its premise change under it. */
  overturnIds: string[];
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
 *
 * THE FLAG BRANCH, H.7 (TASKS H.7, found by the #414 critic and then measured
 * live on the owner's corpus). `isTransfer` is a categorization verdict wearing
 * a different column: setting it withholds the row from every income, spending,
 * budget, report, tax-export and cash-needed total. The FILE branch has always
 * refused to clobber a resolved category (#148); the flag branch never inherited
 * that protection, so a coincidental same-|amount| counterpart arriving within
 * ±3 days silently reversed a settled row — no category change, no confidence
 * change, no audit row, no undo. The critic's repro (a settled +$1,000 income
 * row leaving every income total) was found LIVE: a $500.00 "CEF I CEF IV PPD"
 * distribution, settled at 9900 bps, withheld from income because an unrelated
 * $500.00 Zelle payment to a landscaper had landed two days earlier.
 *
 * The rule is therefore evidentiary, not chronological: an AGE gate would have
 * refused exactly the corrections a deep-history backfill exists to make, and a
 * CONFIDENCE gate was measured useless (the genuine brokerage fundings and the
 * false coincidences both sit at 9000-9900 bps). Instead —
 *  - a row with no competing verdict is flagged exactly as before;
 *  - a row carrying a settled substantive verdict is overturned ONLY by a
 *    directionally coherent pair, i.e. one whose SENDING leg is an account
 *    money can actually leave (`CAN_SEND_ACCOUNT_TYPES`). A purchase on a
 *    credit line is not the sending leg of a transfer.
 * Refusing to overturn is always the safe direction: the row keeps the category
 * its owner gave it and stays visible in every total, which is a state they can
 * see and correct — unlike a silent exclusion, which they cannot.
 */
export function planTransferUpdates(transactions: readonly TransferStateTxn[]): TransferUpdatePlan {
  const detected = detectTransfers(transactions);

  // Which rows the DESCRIPTOR alone reaches — the merchant table naming the row
  // a transfer is not a coincidence of amount and date, so it keeps overturning
  // a settled verdict exactly as it always has (TRANSFER_CONFIDENCE_BPS 9900).
  const descriptorDetected = new Set<string>();
  for (const t of transactions) {
    const categoryId = normalizeMerchant(t.rawDescriptor).categoryId;
    if (categoryId === 'transfer' || categoryId === 'auto-loan') descriptorDetected.add(t.id);
  }

  // The legs a directionally coherent pair reaches, from the SAME pair rule
  // `detectTransfers` just used — never a second walk under a second rule.
  const coherentlyPaired = new Set<string>();
  for (const { outflow, inflow } of matchTransferPairs(transactions)) {
    if (!CAN_SEND_ACCOUNT_TYPES.has(outflow.accountType)) continue;
    coherentlyPaired.add(outflow.id);
    coherentlyPaired.add(inflow.id);
  }

  const flagIds: string[] = [];
  const overturnIds: string[] = [];
  const fileIds: string[] = [];
  for (const t of transactions) {
    if (!detected.has(t.id)) continue;
    if (!t.isTransfer) {
      if (!hasCompetingVerdict(t)) flagIds.push(t.id);
      else if (descriptorDetected.has(t.id) || coherentlyPaired.has(t.id)) overturnIds.push(t.id);
      // else: a pair-only guess against a recorded answer, with no coherent
      // sending leg — the answer stands, and the row keeps counting.
    }
    if (t.needsReview && !t.reviewPinned && t.status === 'POSTED' && t.currencySupported) {
      fileIds.push(t.id);
    }
  }
  return { flagIds, overturnIds, fileIds };
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
