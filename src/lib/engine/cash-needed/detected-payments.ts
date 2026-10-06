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

// ── Payments in transit (DECISIONS #791) ───────────────────────────────────────
//
// Owner, live, 2026-10-06: "I've clearly paid off my ccs for this cycle. However it
// says I still owe." Measured read-only on production: three card payments left the
// owner's checking on the due date, each exactly one card's statement balance; the
// issuer had reported ONE of the three on the card side a day later, and neither the
// other two card-side rows nor any drop in those cards' balances. Until the card side
// posts, the pair rule above cannot see the payment — while the checking balance the
// projection walks from already has the money gone. That is the double count this
// module's header describes, re-opened for the days a payment is in transit, and the
// headline asked for the same money twice.
//
// So a payment the bank side has POSTED counts against a card's current statement
// before the card side shows it — but only when nothing else could explain it:
//
//   1. a POSTED outflow on a CHECKING or SAVINGS account (not a split parent), dated
//      after that statement closed and no later than today;
//   2. it reads as a card payment: filed Credit Card Payment, or a transfer (flag or
//      filing) whose bank text carries a card-payment word (`CARD_PAYMENT_WORDS_RE`);
//   3. its amount is EXACTLY that statement's unpaid remainder, and no other card's
//      current statement has the same remainder — the cent-exact statement balance is
//      the fingerprint, and an ambiguous one names no card;
//   4. the card side has not shown it yet: no POSTED credit of the same amount on any
//      card within the pair window (when there is one, the pair rule above owns it, so
//      the payment is counted once whichever way it is seen);
//   5. it is not a move between the reader's own bank accounts (no POSTED equal and
//      opposite row on another checking or savings account within the pair window),
//      and it did not come back (no POSTED inflow of the same amount on the same
//      account after it — a returned payment).
//
// Every other bank outflow abstains, and the bill is demanded as before. A part
// payment never matches (it is not the remainder) — the card side picks it up when it
// posts. One payment pays one statement; a second payment of the same amount finds the
// statement already paid.

/** Words a bank prints on a card payment. Read only on a row already filed as a move. */
export const CARD_PAYMENT_WORDS_RE =
  /\b(CRCARD ?PMT|CR ?CARD|CARD (?:ONLINE )?(?:PMT|PAYMENT)|CARDPMT|CREDIT ?CARD|CREDIT ?CRD|AUTOPAY|AUTO ?PAY|AUTOMATIC PAYMENT|E-?PAYMENT|EPAY)\b/i;

export interface InTransitTxn extends DetectedPaymentTxn {
  rawDescriptor: string;
  categoryId?: string | null;
  isTransfer: boolean;
}

/** One card's current statement, with what is still unpaid on it after every other payment. */
export interface InTransitCandidate {
  cardAccountId: string;
  statementId: string;
  cycleEnd: string;
  unpaidCents: number;
}

export interface InTransitPayment {
  cardAccountId: string;
  statementId: string;
  /** Positive. */
  amountCents: number;
  /** The day the money left the bank account. */
  date: ISODate;
  fromAccountId: string;
  /** Position of the bank-side row in the array handed in. */
  txnIndex: number;
}

export function detectInTransitCardPayments(params: {
  transactions: readonly InTransitTxn[];
  accountTypeById: ReadonlyMap<string, string>;
  today: ISODate;
  candidates: readonly InTransitCandidate[];
}): InTransitPayment[] {
  const { transactions: txns, accountTypeById, today } = params;
  const posted = (t: InTransitTxn) => t.status === 'POSTED' && !t.isSplitParent;
  const within = (a: string, b: string) => Math.abs(daysBetween(isoDate(a), isoDate(b))) <= PAYMENT_PAIR_WINDOW_DAYS;
  const readsAsCardPayment = (t: InTransitTxn) =>
    t.categoryId === 'credit-card-payment' ||
    ((t.isTransfer || t.categoryId === 'transfer') && CARD_PAYMENT_WORDS_RE.test(t.rawDescriptor));

  const debits = txns
    .map((t, i) => ({ t, i }))
    .filter(
      ({ t }) =>
        posted(t) &&
        t.amountCents < 0 &&
        PAYS_A_CARD.has(accountTypeById.get(t.accountId) ?? '') &&
        compareDates(isoDate(t.date), today) <= 0 &&
        readsAsCardPayment(t),
    )
    .sort((a, b) => compareDates(isoDate(a.t.date), isoDate(b.t.date)) || a.i - b.i);

  const open = params.candidates.filter((c) => c.unpaidCents > 0).map((c) => ({ ...c }));
  const out: InTransitPayment[] = [];
  for (const { t, i } of debits) {
    const amount = -t.amountCents;
    const otherSide = txns.some((u, j) => {
      if (j === i || !posted(u) || u.amountCents !== amount) return false;
      const type = accountTypeById.get(u.accountId) ?? '';
      // 4. the card side already shows it: the pair rule owns it.
      if (type === 'CREDIT') return within(u.date, t.date);
      // 5. a move between the reader's own bank accounts, or money that came back.
      if (PAYS_A_CARD.has(type)) {
        if (u.accountId !== t.accountId) return within(u.date, t.date);
        return compareDates(isoDate(u.date), isoDate(t.date)) >= 0;
      }
      return false;
    });
    if (otherSide) continue;
    const matches = open.filter(
      (c) => c.unpaidCents === amount && compareDates(isoDate(t.date), isoDate(c.cycleEnd)) > 0,
    );
    if (matches.length !== 1) continue;
    const hit = matches[0]!;
    out.push({
      cardAccountId: hit.cardAccountId,
      statementId: hit.statementId,
      amountCents: amount,
      date: isoDate(t.date),
      fromAccountId: t.accountId,
      txnIndex: i,
    });
    hit.unpaidCents = 0;
  }
  return out;
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
