/**
 * Detected mid-cycle card payments (TASKS C.6 / audit P0-1).
 *
 * `CardPayment` has no production writer — measured 2026-08-04 against the live
 * database, `scripts/audit-probes/c6-card-payments.mts`: 0 rows for the linked
 * owner, and every one of the 58 rows in the whole database belongs to the demo
 * seed. So `paymentsAppliedCents` was 0 forever on a real card, and
 * `remainingDue = statementBalance` stayed at the full amount until the issuer's
 * NEXT statement issued, typically two to three weeks later. The two halves of
 * the payment were then accounted asymmetrically: the checking-side debit IS
 * seen (the bank reports the lower balance), the card-side credit was not, so
 * the day-by-day walk subtracted the same money twice and manufactured a
 * shortfall — and a transfer instruction — out of a bill already settled.
 *
 * This module is the missing intake, derived at READ time rather than stored.
 * Nothing here writes: the same probe run showed the model carries no unique
 * key to upsert against, SimpleFIN writes no `Statement` at all for a detected
 * payment to attach to, and a stored row cannot self-correct when the feed later
 * removes or restates the transaction it was derived from. See DECISIONS #401.
 *
 * ── What counts as a payment ─────────────────────────────────────────────────
 * ADMISSION RULE, stated positively (an enumeration of exclusions beside a money
 * figure is a claim to be complete, and would need hand-extending forever —
 * `closing-a-gap-shrinks-the-disclosure-that-described-it`):
 *
 *   A credit on a card counts as a payment against that card's bill ONLY when
 *   the app can see the matching debit leave one of the reader's own spending
 *   accounts — a POSTED outflow of the same amount, on a CHECKING or SAVINGS
 *   account, within three days.
 *
 * Everything else abstains, and abstaining means the bill keeps being demanded
 * in full, which is the safe direction: over-demanding costs the reader an
 * unnecessary transfer, under-demanding costs them a missed payment.
 *
 * ── Why the counterpart must be CHECKING/SAVINGS ─────────────────────────────
 * This is not a tidiness rule; the loose version was falsified by execution
 * before this file existed. Allowing ANY of the reader's own accounts to be the
 * counterpart — which is what "match an own-account transfer pair" means
 * everywhere else in this codebase — credited 11 merchant CREDITS as payments on
 * the owner's live data: an Amex Uber One statement credit (3 months running), an
 * eBay refund, a golf-club refund. All eleven were duplicate-connection
 * artifacts: the owner holds several cards under BOTH SimpleFIN and Plaid, so one
 * refund arrives as two rows on two account ids a day apart and pairs with
 * itself. The strict rule keeps 51 rows / $142,333.71 — every one an
 * "AUTOMATIC PAYMENT", "AUTOPAY PAYMENT" or "CAPITAL ONE AUTOPAY PYMT" debit
 * from his Schwab checking — and refuses all 11. `PAYMENT_ACCOUNT_TYPES` is
 * borrowed for its SEMANTICS (the accounts a bill can be paid from), which is
 * exactly the question here, not merely because the set matches.
 *
 * A card-to-card BALANCE TRANSFER is therefore refused too. That is deliberate
 * and it is the whole reason the constraint exists — a real balance transfer and
 * a duplicated refund are the same shape, and only one of them may reduce an
 * amount due. Refusing costs an over-demand; admitting costs a missed payment.
 *
 * ── Why this reads the pair itself instead of `Transaction.isTransfer` ───────
 * `isTransfer` is set by two different mechanisms (`categorize/transfers.ts`): a
 * descriptor the normalizer recognizes, OR a pair. A descriptor verdict proves
 * nothing about where the money came from, and on the owner's data every one of
 * the 11 false positives above carried `isTransfer = true`. Reading the flag
 * would also make this figure depend on a background refresh having run. The
 * pair is re-derived here from the rows themselves.
 */

import { type ISODate, compareDates, daysBetween, isoDate } from '@/lib/dates';
import { PAYMENT_ACCOUNT_TYPES } from '@/lib/engine/settings/dials';

/** The ±days a payment's two legs may settle apart. Same window as the transfer
 *  pair rule (`categorize/transfers.ts`), so the two compose rather than
 *  disagree about what "the same movement of money" means. */
export const PAYMENT_PAIR_WINDOW_DAYS = 3;

/** Accounts a card bill can actually be paid FROM. */
const PAYS_A_CARD: ReadonlySet<string> = new Set(PAYMENT_ACCOUNT_TYPES);

export interface DetectedPaymentTxn {
  accountId: string;
  date: string;
  amountCents: number;
  /** PENDING | POSTED. Only POSTED rows are used, on BOTH legs: a pending amount
   *  can settle differently under a new id, and a payment credited from a leg
   *  that never settles is money subtracted from a bill that is still owed. */
  status: string;
  /** Container row left by a split — its children carry the amounts. */
  isSplitParent?: boolean;
}

export interface DetectedCardPayment {
  cardAccountId: string;
  date: ISODate;
  amountCents: number;
  /**
   * Position of the source row in the array handed to `detectCardPayments`.
   *
   * The assembler's post-close-credit note tells the reader a credit "reduces
   * your next statement, not this amount due" — the correct sentence for a
   * refund and a flat contradiction of a payment we just subtracted. The two
   * sets are made disjoint HERE, by identity, rather than by
   * `Transaction.isTransfer`: that flag is written by a background refresh
   * inside a catch that must not fail an ingest, so it can lag the rows, and a
   * lagging flag would put one credit in both sentences at once.
   */
  txnIndex: number;
}

/**
 * Every card credit the app can prove is a payment, across all of the reader's
 * accounts. Pure; no window and no statement is applied here — this answers only
 * "did this money come out of an account we can see?".
 *
 * `accountTypeById` must be built from the SAME account list the caller trusts.
 * An account id missing from it (a superseded row filtered out upstream, an
 * account withheld by the currency guard) yields no match: an unknown counterpart
 * cannot prove anything, and refusing costs an over-demand.
 */
export function detectCardPayments(
  transactions: readonly DetectedPaymentTxn[],
  accountTypeById: ReadonlyMap<string, string>,
): DetectedCardPayment[] {
  // Index the candidate payer legs by absolute amount so this stays linear in
  // the common case rather than quadratic over a multi-thousand-row snapshot.
  const payerLegsByAmount = new Map<number, DetectedPaymentTxn[]>();
  for (const t of transactions) {
    if (t.status !== 'POSTED' || t.isSplitParent) continue;
    if (t.amountCents >= 0) continue;
    if (!PAYS_A_CARD.has(accountTypeById.get(t.accountId) ?? '')) continue;
    const key = Math.abs(t.amountCents);
    const list = payerLegsByAmount.get(key);
    if (list) list.push(t);
    else payerLegsByAmount.set(key, [t]);
  }

  const found: DetectedCardPayment[] = [];
  for (let i = 0; i < transactions.length; i += 1) {
    const t = transactions[i];
    if (t.status !== 'POSTED' || t.isSplitParent) continue;
    if (t.amountCents <= 0) continue;
    if (accountTypeById.get(t.accountId) !== 'CREDIT') continue;
    const legs = payerLegsByAmount.get(t.amountCents);
    if (!legs) continue;
    const paid = legs.some(
      (leg) =>
        leg.accountId !== t.accountId &&
        Math.abs(daysBetween(isoDate(leg.date), isoDate(t.date))) <= PAYMENT_PAIR_WINDOW_DAYS,
    );
    if (paid) {
      found.push({
        cardAccountId: t.accountId,
        date: isoDate(t.date),
        amountCents: t.amountCents,
        txnIndex: i,
      });
    }
  }
  return found;
}

/**
 * Σ detected payments creditable against ONE statement.
 *
 * WINDOW — strictly after `cycleEnd`. A payment on or before the close is
 * already inside the balance the issuer printed; subtracting it again would
 * under-demand by the amount of the payment. This is the same window the
 * assembler's existing post-close-credit note uses, for the same reason.
 *
 * DEDUPE — a detected payment is dropped when a stored `CardPayment` against the
 * same statement carries the same amount within the pair window. The two are
 * different CHANNELS for one event (the reader's own record, and the feed's), and
 * nothing in the schema links them: `CardPayment` carries no transaction id. The
 * demo dataset writes both halves for its mid-cycle $400 (`seed/build.ts:450`),
 * which is what keeps this branch exercised. Where two genuinely separate
 * payments of the same amount fall within three days of each other, only one is
 * credited — an under-credit, i.e. the safe direction again.
 */
export function detectedPaymentCentsForStatement(params: {
  detected: readonly DetectedCardPayment[];
  cardAccountId: string;
  cycleEnd: string;
  storedPayments: readonly { date: string; amountCents: number }[];
}): number {
  const close = isoDate(params.cycleEnd);
  const unclaimed = params.storedPayments.map((p) => ({ date: isoDate(p.date), amountCents: p.amountCents, used: false }));
  let total = 0;
  for (const d of params.detected) {
    if (d.cardAccountId !== params.cardAccountId) continue;
    if (compareDates(d.date, close) <= 0) continue;
    const twin = unclaimed.find(
      (s) =>
        !s.used &&
        s.amountCents === d.amountCents &&
        Math.abs(daysBetween(s.date, d.date)) <= PAYMENT_PAIR_WINDOW_DAYS,
    );
    if (twin) {
      twin.used = true;
      continue;
    }
    total += d.amountCents;
  }
  return total;
}
