/**
 * When does a brokerage's NAME in a bank description mean money moving into or out of
 * investing? (DECISIONS #789, critic cycle 1 P1-3.)
 *
 * The categorizer's investment rule (#163) read any of ten brokerage names, bare, as
 * Investment & Savings — and ordinary businesses carry six of them: LES SCHWAB TIRES (a
 * regional tire chain), SQ *SCHWAB MEATS, MERRILL GARDENS (senior living), VANGUARD
 * CLEANING SYSTEMS, VANGUARD CAR RENTAL, TST* ROBINHOOD BURGERS, BETTERMENT HOME
 * SERVICES, LITTLE ACORNS DAYCARE. While Investment & Savings counted as spending that
 * misfile only mislabelled a purchase; once #789 made the leaf a money move it would
 * have DELETED real spending. So:
 *
 *  - a name only a brokerage carries ("FIDELITY INVESTMENTS", "FID BKG", "CHARLES
 *    SCHWAB", "COINBASE", "E*TRADE", "WEALTHFRONT") names the brokerage;
 *  - a name a business also carries (VANGUARD, SCHWAB, ROBINHOOD, BETTERMENT, ACORNS,
 *    MERRILL) names the brokerage only beside a word a brokerage's own money movement
 *    carries — BUY, SELL, INVEST…, MONEYLINK/MONEYLINE, BROKERAGE, SECURITIES, FUNDS,
 *    DEBITS, EDI, LYNCH, EDGE, IRA, ROTH, 401K, CONTRIB…, TRANSFER/XFER, REDEMPTION,
 *    WITHDRAWAL, SWEEP. "VANGUARD BUY INVESTMENT", "SCHWAB BROKERAGE MONEYLINK",
 *    "ROBINHOOD DEBITS", "MERRILL LYNCH", "ACORNS INVEST" do; "LES SCHWAB TIRES" does not.
 *
 * And a brokerage's name beside a word that makes the row a payment to the FIRM ITSELF —
 * a fee, a premium, a membership, a loan, margin interest ("COINBASE ONE", "FIDELITY
 * INVESTMENTS LIFE INS PREMIUM", "MERRILL LYNCH ADVISORY FEE") — is spending, never money
 * moved into investing (critic cycle 2, P1-2): the categorizer does not file it Investment
 * & Savings, and "Money you put in" lists it with the same word.
 *
 * One author for the categorizer (`normalize.ts`, the investment rules) and "Money you put
 * in" (`deposits.ts`: the payment-to-the-firm word and the bank's return words), so the two
 * cannot disagree about one description. Plain leaf module.
 */

/** Names only a brokerage, robo-adviser or exchange carries. */
export const BROKERAGE_ONLY_NAME_RE = /\b(FIDELITY INVEST\w*|FID BKG|CHARLES SCHWAB|COINBASE|E\*?TRADE|WEALTHFRONT)\b/i;

/** Brokerage names ordinary businesses also carry. */
export const SHARED_BROKERAGE_NAME_RE = /\b(VANGUARD|SCHWAB|ROBINHOOD|BETTERMENT|ACORNS|MERRILL)\b/i;

/**
 * How a BANK words money it sends back: a returned item, an ACH return, a reversal, a
 * chargeback. A bare "REV" or "RETURN" is not enough — "SMITH REV TRUST", "DEPT OF REV",
 * "TAX RETURN", "RETURN OF CAPITAL" and a store's "RETURN" are other money.
 */
export const BANK_RETURN_RE =
  /\b(RETURNED ITEM|RETURN ITEM|RETURNED|ACH RETURN|ACH DEBIT RETURN|RETURN ACH|ACH RTN|RTN|ACH REV|NSF|UNPAID ITEM|UNPAID|ELECTRONIC RETURN|RETURN OF POSTED|TRANSFER RETURN|REVERSAL|REVERSED|CHARGEBACK|CHGBK)\b/i;

/**
 * Words a brokerage's own money movement carries and a purchase at a same-named business
 * does not — money going in, and money coming back out: a withdrawal, a sale's credit, or a
 * deposit the bank returned, worded the way a bank words a return (`BANK_RETURN_RE`; critic
 * cycle 2, P2-1 — "VANGUARD ACH RTN" is the deposit coming back, not income).
 */
export const INVESTING_MOVE_WORD_RE = new RegExp(
  String.raw`\b(BUY|SELL|INVEST\w*|MONEY ?LINK|MONEY ?LINE|BROKERAGE|BKG|SECURITIES|FUNDS?|DEBITS|CREDITS|EDI|LYNCH|EDGE|IRA|ROTH|401\(?K\)?|CONTRIB\w*|TRANSFER|XFER|TRNSFR|REDEMPTION|REDEEM|WITHDRAW\w*|SWEEP)\b|${BANK_RETURN_RE.source}`,
  'i',
);

/** A shared name AND an investing word, in either order — the categorizer's second investment rule. */
export const SHARED_BROKERAGE_MOVE_RE = new RegExp(
  String.raw`^(?=[\s\S]*${SHARED_BROKERAGE_NAME_RE.source})(?=[\s\S]*(?:${INVESTING_MOVE_WORD_RE.source}))`,
  'i',
);

/**
 * Words that make a brokerage-named row a payment to (or a refund or payout from) the
 * brokerage ITSELF — a fee, a bill, a loan or mortgage, an insurance premium, a membership,
 * a card payment, a rebate — not money put in or taken out of investing.
 */
export const PAYS_THE_FIRM_RE =
  /\b(FEES?|MEMBERSHIP|SUBSCRIPTION|CARD PAYMENT|CARD PMT|CREDIT CARD|(?:VISA|MASTERCARD|AMEX)(?: CARD)? (?:PAYMENT|PMT|AUTOPAY|BILL)|INTEREST(?! (?:INCOME|FUND))|ADVISORY|LOANS?|MORTGAGE|MTG|LENDING|INSURANCE|INS|PREMIUM|REBATE|REFUND|CASH ?BACK|ROBINHOOD GOLD|COINBASE ONE)\b/i;

/**
 * The word that makes this row a payment to or from the firm itself, else null. Pass the text
 * AFTER the bank-channel prefixes are stripped (`stripBankNoise`), so a debit-card buy ("DEBIT
 * CARD PMT COINBASE") is never read as a card payment.
 */
export function paysTheFirmWord(stripped: string): string | null {
  const read = stripped.replace(/^POS\s+CARD\s+(?:PAYMENT|PMT)\s*[-–—]?\s*/i, '');
  const m = PAYS_THE_FIRM_RE.exec(read);
  return m ? m[1]!.toUpperCase() : null;
}

/**
 * Does this description name a brokerage the way the brokerage's own money movement does —
 * and not as a payment to the firm itself? `stripped` is the description after
 * `stripBankNoise` (the categorizer passes it; it defaults to the description).
 */
export function readsAsBrokerageMove(descriptor: string, stripped: string = descriptor): boolean {
  return (BROKERAGE_ONLY_NAME_RE.test(descriptor) || SHARED_BROKERAGE_MOVE_RE.test(descriptor)) && !paysTheFirmWord(stripped);
}
