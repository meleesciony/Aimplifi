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
//   2. it reads as a card payment: filed Credit Card Payment; or filed Transfer (or not
//      filed but flagged a transfer) and its bank text carries a card-payment word
//      (`CARD_PAYMENT_WORDS_RE`), or a bill-pay word beside a card issuer's name
//      (`BILL_PAY_WORDS_RE` + `CARD_ISSUER_RE`). A row filed to anything else is the
//      reader's or the categorizer's word that it is not a card payment, flag or no flag;
//   3. its amount is EXACTLY what was left to pay on that statement on the day the money
//      left (the statement balance less the payments to it on or before that day — a
//      payment made later never changes what this one paid), or EXACTLY the whole
//      statement balance; and no other card's current statement matches it — the
//      cent-exact amount is the fingerprint, and an ambiguous one names no card;
//   4. the card side has not shown it yet: no POSTED credit of the same amount on any
//      card within the pair window (when there is one, the pair rule above owns it, so
//      the payment is counted once whichever way it is seen);
//   5. it is not a move between the reader's own bank accounts (no POSTED equal and
//      opposite row on another checking or savings account within the pair window),
//      and it did not come back (no POSTED inflow of the same amount on the same
//      account on a LATER day — a returned payment — unless that inflow is itself one
//      half of a move in from another of the reader's accounts, each move explaining
//      ONE inflow: a top-up never hides a return beside it).
//
// A card-side credit of the same amount on the matched card, filed as a payment (Credit
// Card Payment, Transfer, or not filed), not one the pair rule already used, dated after
// the statement closed and outside the pair window — from 14 days before the bank side to
// 31 days after it — is that payment ARRIVING: it stays credited, is never announced as a
// credit for the next statement, and is no longer described as not yet shown.
//
// Every other bank outflow abstains, and the bill is demanded as before. A part
// payment never matches — the card side picks it up when it posts. One payment pays one
// statement; a second payment of the same amount finds the statement already paid.

/** Words a bank prints on a card payment. Read only on a row already filed as a move. */
export const CARD_PAYMENT_WORDS_RE =
  /\b(CRCARD ?PMT|CR ?CARD|CARD (?:ONLINE )?(?:PMT|PAYMENT)|CARDPMT|CREDIT ?CARD|CREDIT ?CRD|CRD ?PMT)\b/i;
/**
 * Words every kind of bill prints ("VERIZON WIRELESS EPAY", "TOYOTA FINANCIAL AUTOPAY"),
 * so they read as a card payment only beside a card issuer's name (critic cycle 1, P2-2).
 */
export const BILL_PAY_WORDS_RE = /\b(AUTOPAY|AUTO ?PAY|AUTOMATIC PAYMENT|E-?PAYMENT|EPAY|ONLINE PMT|ONLINE PAYMENT)\b/i;
/** Card issuers' names as banks print them on a payment. */
export const CARD_ISSUER_RE =
  /\b(AMEX|AMERICAN EXPRESS|CHASE|CITI|CITIBANK|CITI CARDS?|DISCOVER|CAPITAL ONE|CAPITALONE|BARCLAYS?|BARCLAYCARD|SYNCB|SYNCHRONY|WELLS FARGO|BK OF AMER|BANK OF AMERICA|BOFA|US ?BANK|GOLDMAN SACHS|GS BANK|APPLE ?CARD|ELAN|COMENITY|TD BANK|PNC|NAVY FEDERAL|USAA|CREDIT ONE|MERRICK)\b/i;
/**
 * The issuers also lend and insure: "CHASE MORTGAGE EPAY", "DISCOVER STUDENT LOAN EPAY",
 * "CAPITAL ONE AUTO FINANCE EPAY", "USAA P&C EPAY" are not card payments (critic cycle 2,
 * P3-4). "AUTO" is a loan only when it is not "AUTO PAY".
 */
export const NOT_A_CARD_BILL_RE =
  /\b(MORTGAGE|MTG|HOME LENDING|HOME LOAN|LOAN|LENDING|STUDENT|AUTO(?! ?PAY)|FINANCE|INSURANCE|INS|P&C|MARCUS|SAVINGS|CHECKING)\b/i;
/** How long BEFORE the bank side a card-side credit can be that payment arriving early. */
export const IN_TRANSIT_ARRIVAL_BEFORE_DAYS = 14;
/** How long AFTER the bank side a card-side credit can be that payment arriving late. */
export const IN_TRANSIT_ARRIVAL_AFTER_DAYS = 31;

export interface InTransitTxn extends DetectedPaymentTxn {
  rawDescriptor: string;
  categoryId?: string | null;
  isTransfer: boolean;
}

/** One card's current statement, with the payments already credited against it. */
export interface InTransitCandidate {
  cardAccountId: string;
  statementId: string;
  cycleEnd: string;
  statementBalanceCents: number;
  /** Stored and pair-detected payments against this statement, with their dates. */
  payments: readonly { date: string; amountCents: number }[];
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
  /** Position of the card-side credit that arrived outside the pair window, if one has. */
  arrivedTxnIndex: number | null;
}

export function detectInTransitCardPayments(params: {
  transactions: readonly InTransitTxn[];
  accountTypeById: ReadonlyMap<string, string>;
  today: ISODate;
  candidates: readonly InTransitCandidate[];
  /** Indexes of the card credits the pair rule already credited — never an arrival. */
  pairedIndexes?: ReadonlySet<number>;
}): InTransitPayment[] {
  const { transactions: txns, accountTypeById, today } = params;
  const paired = params.pairedIndexes ?? new Set<number>();
  const posted = (t: InTransitTxn) => t.status === 'POSTED' && !t.isSplitParent;
  const within = (a: string, b: string) => Math.abs(daysBetween(isoDate(a), isoDate(b))) <= PAYMENT_PAIR_WINDOW_DAYS;
  const unfiled = (t: InTransitTxn) => !t.categoryId || t.categoryId === 'uncategorized';
  const isBank = (accountId: string) => PAYS_A_CARD.has(accountTypeById.get(accountId) ?? '');
  const readsAsCardPayment = (t: InTransitTxn) =>
    t.categoryId === 'credit-card-payment' ||
    ((t.categoryId === 'transfer' || (unfiled(t) && t.isTransfer)) &&
      (CARD_PAYMENT_WORDS_RE.test(t.rawDescriptor) ||
        (BILL_PAY_WORDS_RE.test(t.rawDescriptor) &&
          CARD_ISSUER_RE.test(t.rawDescriptor) &&
          !NOT_A_CARD_BILL_RE.test(t.rawDescriptor))));

  // What a candidate statement still owed on a given day, and its whole balance.
  const unpaidOn = (c: InTransitCandidate, day: string) =>
    c.statementBalanceCents -
    c.payments.filter((x) => compareDates(isoDate(x.date), isoDate(day)) <= 0).reduce((sum, x) => sum + x.amountCents, 0);
  const fingerprints = (c: InTransitCandidate, day: string) => [unpaidOn(c, day), c.statementBalanceCents].filter((v) => v > 0);
  // Only debits that could pay a candidate are worth the history scans below (critic
  // cycle 2, P3-5): dated after some candidate closed, of an amount some candidate owes.
  const earliestClose = params.candidates.reduce<string | null>(
    (min, c) => (min === null || compareDates(isoDate(c.cycleEnd), isoDate(min)) < 0 ? c.cycleEnd : min),
    null,
  );
  if (earliestClose === null) return [];

  // Top-ups: each move IN from another of the reader's bank accounts explains ONE inflow,
  // closest dates first (critic cycle 2, P2-1) — one savings withdrawal can never be both
  // the top-up beside a return and the reason the return is ignored.
  const topUps = new Set<number>();
  {
    const edges: { inflow: number; outflow: number; gap: number }[] = [];
    txns.forEach((u, j) => {
      if (!posted(u) || u.amountCents <= 0 || !isBank(u.accountId)) return;
      txns.forEach((w, k) => {
        if (!posted(w) || w.amountCents !== -u.amountCents || w.accountId === u.accountId || !isBank(w.accountId)) return;
        if (within(w.date, u.date)) edges.push({ inflow: j, outflow: k, gap: Math.abs(daysBetween(isoDate(w.date), isoDate(u.date))) });
      });
    });
    edges.sort((a, b) => a.gap - b.gap || a.inflow - b.inflow || a.outflow - b.outflow);
    const usedOut = new Set<number>();
    for (const e of edges) {
      if (topUps.has(e.inflow) || usedOut.has(e.outflow)) continue;
      topUps.add(e.inflow);
      usedOut.add(e.outflow);
    }
  }

  const debits = txns
    .map((t, i) => ({ t, i }))
    .filter(
      ({ t }) =>
        posted(t) &&
        t.amountCents < 0 &&
        isBank(t.accountId) &&
        compareDates(isoDate(t.date), isoDate(earliestClose)) > 0 &&
        compareDates(isoDate(t.date), today) <= 0 &&
        readsAsCardPayment(t) &&
        params.candidates.some((c) => fingerprints(c, t.date).includes(-t.amountCents)),
    )
    .sort((a, b) => compareDates(isoDate(a.t.date), isoDate(b.t.date)) || a.i - b.i);

  const consumed = new Set<string>();
  const out: InTransitPayment[] = [];
  const arrivals = new Set<number>();
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
        return compareDates(isoDate(u.date), isoDate(t.date)) > 0 && !topUps.has(j);
      }
      return false;
    });
    if (otherSide) continue;
    const matches = params.candidates.filter(
      (c) =>
        !consumed.has(c.statementId) &&
        compareDates(isoDate(t.date), isoDate(c.cycleEnd)) > 0 &&
        fingerprints(c, t.date).includes(amount),
    );
    if (matches.length !== 1) continue;
    const hit = matches[0]!;
    const arrived = txns.findIndex((u, j) => {
      if (arrivals.has(j) || paired.has(j) || !posted(u)) return false;
      if (u.accountId !== hit.cardAccountId || u.amountCents !== amount) return false;
      if (!(u.categoryId === 'credit-card-payment' || u.categoryId === 'transfer' || unfiled(u))) return false;
      if (compareDates(isoDate(u.date), isoDate(hit.cycleEnd)) <= 0 || within(u.date, t.date)) return false;
      const gap = daysBetween(isoDate(t.date), isoDate(u.date));
      return gap >= -IN_TRANSIT_ARRIVAL_BEFORE_DAYS && gap <= IN_TRANSIT_ARRIVAL_AFTER_DAYS;
    });
    if (arrived >= 0) arrivals.add(arrived);
    out.push({
      cardAccountId: hit.cardAccountId,
      statementId: hit.statementId,
      amountCents: amount,
      date: isoDate(t.date),
      fromAccountId: t.accountId,
      txnIndex: i,
      arrivedTxnIndex: arrived >= 0 ? arrived : null,
    });
    consumed.add(hit.statementId);
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
  return detectedPaymentsForStatement(params).reduce((sum, d) => sum + d.amountCents, 0);
}

/**
 * The detected payments creditable against ONE statement, as rows — the list
 * `detectedPaymentCentsForStatement` sums, shared so the in-transit matcher (#791) reads
 * the same payments, with their dates, that the amount due subtracted.
 */
export function detectedPaymentsForStatement(params: {
  detected: readonly DetectedCardPayment[];
  cardAccountId: string;
  cycleEnd: string;
  storedPayments: readonly { date: string; amountCents: number }[];
}): DetectedCardPayment[] {
  const close = isoDate(params.cycleEnd);
  const unclaimed = params.storedPayments.map((p) => ({ date: isoDate(p.date), amountCents: p.amountCents, used: false }));
  const out: DetectedCardPayment[] = [];
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
    out.push(d);
  }
  return out;
}
