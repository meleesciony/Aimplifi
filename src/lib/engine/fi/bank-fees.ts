/**
 * Fees you paid — the bank and card fees in the reader's last 12 months of records, by kind,
 * and what came back (DECISIONS #796).
 *
 * The opportunity list ("Worth a look") is built from RECURRING SERIES and every figure on it
 * flows into the FI cut, the radar cut-walk, Ask's "what to cut" total and the Today feed. A
 * fee is not a series — an overdraft is the opposite of a rhythm — so this is its own engine
 * and its own card, and none of those totals move.
 *
 * The rows are the coach's own: checking, savings and card accounts (the snapshot carries no
 * investment rows), on the one flow basis (`countsInFlows`: posted, not a transfer or money
 * move, not a split parent, not excluded, not a loan-payment exclusion), dated in the 12
 * months ending today.
 *
 * THE TEXT IS READ BY ALLOWLIST (critic cycle 2). After the noise a bank adds is taken off —
 * digits, masks, month names, an overdraft's "FOR A $12.00 … DETAILS: …" tail, a "NON-<BANK>"
 * before ATM — EVERY word left must belong to one kind's own vocabulary (plus a fee word and a
 * few connectives), with at least one of that kind's anchor words. One word outside it — a
 * business's name (WESTGATE, RENTCAFE, DIRECTV, SOLID WASTE), a payment (NAVIENT PAYMENT INCL),
 * a principal (CHARGE-BACK, DEPOSITED ITEM), a product (IRA, STOP PAYMENT) — and the row is not
 * read as a bank or card fee. The cycle-1 rule blocked a list of businesses; a list of
 * businesses can't be finished, and each name it missed was counted.
 *
 *  - A CHARGE is money out filed under Fees & Charges, ATM Fee or Late Fee whose text reads as
 *    a kind. The ATM Fee and Late Fee filings supply the kind (the anchor), not the vocabulary:
 *    their text must still be that kind's words alone. Everything else filed there is listed
 *    as NOT COUNTED, with its amount.
 *  - CAME BACK is money in, under any filing, whose text reads as a kind once the words saying
 *    it was given back (REFUND, REVERSAL, REBATE, REIMBURSEMENT, WAIVED, CREDIT …) are taken
 *    off — so an "INCOMING WIRE CREDIT … PROFESSIONAL FEES" is not a fee coming back, and a
 *    +$39.00 "LATE FEE" is. CREDIT never counts beside WIRE: "WIRE … CREDIT" is how a bank
 *    words money arriving by wire.
 *  - Interest PHRASES (Interest & Finance Charges, "INTEREST CHARGE", "FINANCE CHARGE" …) and
 *    annual-fee PHRASES are read first and LEFT OUT, totalled separately.
 *
 * Everything errs low by construction: a real fee worded with any word the vocabulary lacks is
 * listed rather than counted. The card says "at least" and prints no net.
 *
 * The kind is read from the filing and the bank's own text — never from the register's
 * display name, which a reader can rename to anything.
 *
 * Pure: no I/O, integer cents, calendar dates, deterministic.
 */

import { addDays, addMonthsClamped, type ISODate } from '@/lib/dates';
import { type Cents, cents } from '@/lib/money';
import { countsInFlows, type TxnLike } from '@/lib/engine/fi/insights';
import { handoverKey } from '@/lib/engine/account/reconcile-boundary';

/** The filed categories whose money out this card reads as charges. One author. */
export const COUNTED_FEE_CATEGORY_IDS = ['fees', 'atm-fee', 'late-fee'] as const;

/** The filed category that is interest, never a fee here. */
export const INTEREST_CATEGORY_ID = 'fees-interest';

/** The kinds a counted fee can be, in the order a tie between two equal totals prints. */
export const FEE_KINDS = ['overdraft', 'account', 'late', 'atm', 'foreign', 'wire'] as const;
export type FeeKind = (typeof FEE_KINDS)[number];

/** How a fee-category row reads: a counted kind, a left-out kind, or not readable as a bank or card fee. */
export type FeeReading = FeeKind | 'interest' | 'annual' | 'unread';

const COUNTED_SET: ReadonlySet<string> = new Set(COUNTED_FEE_CATEGORY_IDS);

const INTEREST_RE =
  /\b(INTEREST (CHARGE[DS]?|CHG|FEE|ON (PURCHASES|CASH|BALANCES?))|(PURCHASE|CASH ADVANCE|BALANCE TRANSFER|PLAN|MINIMUM) INTEREST|FINANCE CHARGES?)\b/;
const ANNUAL_RE = /\bANNUAL (MEMBERSHIP |CARD |ACCOUNT )?FEE\b/;

const words = (s: string): ReadonlySet<string> => new Set(s.split(' '));

/** At least one of these is required: a row with no fee word is a payment, a transfer or principal. */
const FEE_WORDS = words('FEE FEES CHARGE CHARGES SURCHARGE');
/** Connectives any kind may carry. */
const FILLER = words('FOR A AN THE OF ON PER AND ASSESSED POSTED JAN FEB MAR APR MAY JUN JUL AUG SEP SEPT OCT NOV DEC');

/**
 * Each kind: the words that make a row that kind (`anchors`, one required unless the filing
 * supplies the kind) and every other word it may carry (`vocab`). Checked in this order; a text
 * that is wholly one kind's words is very rarely wholly another's.
 */
export const FEE_KIND_WORDS: Record<FeeKind, { anchors: ReadonlySet<string>; vocab: ReadonlySet<string> }> = {
  overdraft: {
    anchors: words('OVERDRAFT OVERDRAWN OD NSF INSUFFICIENT NONSUFFICIENT RETURNED RETURN COURTESY PAID'),
    vocab: words('ITEM ITEMS FUND FUNDS NON SUFFICIENT CHECK CHECKS ACH DEBIT PAYMENT PAY EXTENDED CONTINUOUS SUSTAINED DAILY PROTECTION TRANSFER XFER ACCOUNT ACCT'),
  },
  atm: {
    anchors: words('ATM'),
    vocab: words('WITHDRAWAL WITHDRAW WITH WDRL WD CASH BALANCE INQUIRY INQ NON NETWORK OUT FOREIGN INTL INTERNATIONAL DOMESTIC OPERATOR OWNER USAGE USE TRANSACTION TXN'),
  },
  late: {
    anchors: words('LATE PAST'),
    vocab: words('PAYMENT PMT DUE'),
  },
  wire: {
    anchors: words('WIRE'),
    vocab: words('INCOMING OUTGOING DOMESTIC INTERNATIONAL INTL FOREIGN TRANSFER TRF IN OUT SERVICE SVC'),
  },
  foreign: {
    anchors: words('FOREIGN INTERNATIONAL INTL FX CURRENCY CROSS'),
    vocab: words('TRANSACTION TRANS TXN EXCHANGE PURCHASE CONVERSION BORDER SERVICE'),
  },
  account: {
    anchors: words('MONTHLY MAINTENANCE SERVICE MINIMUM LOW BELOW ACCOUNT ACCT'),
    vocab: words('BALANCE BAL MIN CHECKING SAVINGS'),
  },
};

/** Words that say money is being handed back. CREDIT is not one of them beside WIRE. */
const GIVEN_BACK_WORDS = words('REFUND REFUNDED REFUNDS REVERSAL REVERSALS REVERSED REVERSE REV REBATE REBATED REIMBURSEMENT REIMBURSED REIMB WAIVED WAIVER WAIVE CREDIT CREDITED');

/**
 * The words of a bank's text, with the noise a bank adds taken off: an overdraft notice's
 * "FOR A $12.00 … PURCHASE - DETAILS: …" tail (it names the item that caused the fee, not who
 * charged it), a "NON-<BANK>" before ATM, and every token that is a number, an amount, a date
 * or an account mask.
 */
export function feeTextWords(rawDescriptor: string): string[] {
  const s = rawDescriptor
    .toUpperCase()
    .replace(/\bFOR AN? \$?\d[\d,]*(\.\d+)?\b.*$/, ' ')
    .replace(/\bDETAILS?:.*$/, ' ')
    .replace(/\bNON-[A-Z0-9&]+(?=\s+ATM\b)/g, ' NON ');
  return s
    .split(/[^A-Z0-9&]+/)
    .filter((t) => t !== '' && !/^\d+$/.test(t) && !/^X+\d*$/.test(t) && !/^\d+(ST|ND|RD|TH)$/.test(t));
}

/** The order kinds are tried in when the text alone decides. */
const TEXT_ORDER: readonly FeeKind[] = ['overdraft', 'atm', 'late', 'wire', 'foreign', 'account'];

/**
 * The kind a set of words is wholly made of, or null. `filed` = the kind the ATM Fee or Late Fee
 * filing supplies: tried first, its anchor waived; then every kind on its own anchors, so a row
 * filed under Late Fee that reads "OVERDRAFT FEE" is an overdraft fee, never "not a bank fee".
 */
function kindOfWords(tokens: readonly string[], filed: FeeKind | null): FeeKind | null {
  if (!tokens.some((t) => FEE_WORDS.has(t))) return null;
  const fitsKind = (kind: FeeKind, anchorRequired: boolean) => {
    const { anchors, vocab } = FEE_KIND_WORDS[kind];
    const fits = tokens.every((t) => FEE_WORDS.has(t) || FILLER.has(t) || anchors.has(t) || vocab.has(t));
    return fits && (!anchorRequired || tokens.some((t) => anchors.has(t)));
  };
  if (filed !== null && fitsKind(filed, false)) return filed;
  return TEXT_ORDER.find((kind) => fitsKind(kind, true)) ?? null;
}

/**
 * How a row filed under a fee category reads. `null` for a row not filed under one.
 *
 * Interest & Finance Charges is interest whatever its text; interest and annual-fee phrases are
 * left out under every filing. Otherwise the text must be wholly one kind's words — under ATM
 * Fee and Late Fee, that kind's — or the row is `unread`.
 */
export function feeKindOf(categoryId: string | null | undefined, rawDescriptor: string): FeeReading | null {
  if (categoryId === INTEREST_CATEGORY_ID) return 'interest';
  if (!COUNTED_SET.has(categoryId ?? '')) return null;
  const upper = rawDescriptor.toUpperCase();
  if (INTEREST_RE.test(upper)) return 'interest';
  if (ANNUAL_RE.test(upper)) return 'annual';
  const filed: FeeKind | null = categoryId === 'atm-fee' ? 'atm' : categoryId === 'late-fee' ? 'late' : null;
  return kindOfWords(feeTextWords(rawDescriptor), filed) ?? 'unread';
}

/**
 * The counted kind of fee money in hands back, or null. Under any filing: the text, less the
 * words saying it was given back, must be wholly one kind's words. CREDIT doesn't count as
 * "given back" beside WIRE. (Interest and annual-fee wording needs no check of its own here:
 * INTEREST, FINANCE and ANNUAL are in no kind's vocabulary, so the allowlist refuses them.)
 */
export function feeGivenBackKind(rawDescriptor: string): FeeKind | null {
  const all = feeTextWords(rawDescriptor);
  const wire = all.includes('WIRE');
  const rest = all.filter((t) => !GIVEN_BACK_WORDS.has(t) || (wire && (t === 'CREDIT' || t === 'CREDITED')));
  return kindOfWords(rest, null);
}

export function readsAsFeeGivenBack(rawDescriptor: string): boolean {
  return feeGivenBackKind(rawDescriptor) !== null;
}

export interface BankFeeRowInput extends TxnLike {
  id: string;
}

/** One row as the card lists it. `amountCents` is a magnitude (always positive). */
export interface FeeRow {
  transactionId: string;
  date: ISODate;
  /** The register's display name when the caller had one, else the bank text. */
  label: string;
  /** The bank's own text, present only when it says more than `label` (not a case change of it). */
  rawDescriptor: string | null;
  amountCents: Cents;
  /** Dated on a day both of a combined pair's connections are kept (U.16) — may have a twin. */
  onHandoverDay: boolean;
}

export interface FeeKindTotal {
  kind: FeeKind;
  chargedCents: Cents;
  /** Newest first. Σ amountCents === chargedCents. */
  rows: FeeRow[];
}

export interface LeftOutFees {
  interestCents: Cents;
  interestCount: number;
  annualCents: Cents;
  annualCount: number;
}

/** How far back the records reach, account by account (critic cycle 2, P2-7). */
export interface FeeRecords {
  /** The earliest row date among every row handed in, or null when none. */
  from: ISODate | null;
  /** Accounts whose own earliest row falls after the window's first day. */
  accountsStartingInWindow: number;
  /** The latest of those accounts' first rows (null when none starts in the window). */
  latestAccountStart: ISODate | null;
  /** Accounts with any row at all. */
  accounts: number;
}

export interface BankFees {
  /** First day of the window (inclusive): the day after today minus 12 months. */
  from: ISODate;
  /** Last day of the window (inclusive): today. */
  to: ISODate;
  records: FeeRecords;
  /** Kinds with at least one charge, largest total first; ties in `FEE_KINDS` order. */
  kinds: FeeKindTotal[];
  /** Σ kinds[].chargedCents. */
  chargedCents: Cents;
  /** Money in read as a fee coming back. Newest first. Σ amountCents === givenBackCents. */
  givenBack: FeeRow[];
  givenBackCents: Cents;
  /** Money out filed as a fee whose text doesn't read as a bank or card fee. Newest first. */
  uncounted: FeeRow[];
  uncountedCents: Cents;
  leftOut: LeftOutFees;
  /** Rows behind any amount this card prints (charged, back, not counted, left out) on a handover day. */
  amountsOnHandoverDays: number;
}

/** First day of the 12-month window ending `today` (both ends inclusive). */
export function bankFeeWindowStart(today: ISODate): ISODate {
  return addDays(addMonthsClamped(today, -12), 1);
}

function byDateDesc(a: FeeRow, b: FeeRow): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.transactionId < b.transactionId ? -1 : a.transactionId > b.transactionId ? 1 : 0;
}

const sumRows = (rows: readonly FeeRow[]): Cents => cents(rows.reduce((s, r) => s + r.amountCents, 0));

export function findBankFees(
  rows: readonly BankFeeRowInput[],
  today: ISODate,
  opts: {
    /** The same loan-payment exclusion ids every coach flow passes to `countsInFlows`. */
    excludedFlowIds?: ReadonlySet<string>;
    /** `snap.handoverKeys` — `handoverKey(accountId, date)` for released handover days. */
    handoverKeys?: ReadonlySet<string>;
  } = {},
): BankFees {
  const from = bankFeeWindowStart(today);
  const handoverKeys = opts.handoverKeys ?? new Set<string>();

  const firstRowByAccount = new Map<string, string>();
  const charged = new Map<FeeKind, FeeRow[]>();
  const givenBack: FeeRow[] = [];
  const uncounted: FeeRow[] = [];
  const interest: FeeRow[] = [];
  const annual: FeeRow[] = [];

  for (const t of rows) {
    const first = firstRowByAccount.get(t.accountId);
    if (first === undefined || t.date < first) firstRowByAccount.set(t.accountId, t.date);
    if (t.date < from || t.date > today) continue;
    if (t.amountCents === 0) continue;
    if (!countsInFlows(t, opts.excludedFlowIds)) continue;

    if (t.amountCents > 0) {
      if (readsAsFeeGivenBack(t.rawDescriptor)) givenBack.push(toFeeRow(t, handoverKeys));
      continue;
    }
    const reading = feeKindOf(t.categoryId, t.rawDescriptor);
    if (reading === null) continue;
    const row = toFeeRow(t, handoverKeys);
    if (reading === 'interest') interest.push(row);
    else if (reading === 'annual') annual.push(row);
    else if (reading === 'unread') uncounted.push(row);
    else {
      const list = charged.get(reading) ?? [];
      list.push(row);
      charged.set(reading, list);
    }
  }

  const kinds: FeeKindTotal[] = FEE_KINDS.filter((k) => charged.has(k)).map((kind) => {
    const list = (charged.get(kind) ?? []).sort(byDateDesc);
    return { kind, chargedCents: sumRows(list), rows: list };
  });
  // Stable sort: equal totals keep FEE_KINDS order.
  kinds.sort((a, b) => b.chargedCents - a.chargedCents);
  givenBack.sort(byDateDesc);
  uncounted.sort(byDateDesc);

  const starts = [...firstRowByAccount.values()].sort();
  const lateStarts = starts.filter((d) => d > from);
  const printed = [...kinds.flatMap((k) => k.rows), ...givenBack, ...uncounted, ...interest, ...annual];

  return {
    from,
    to: today,
    records: {
      from: (starts[0] as ISODate | undefined) ?? null,
      accountsStartingInWindow: lateStarts.length,
      latestAccountStart: (lateStarts[lateStarts.length - 1] as ISODate | undefined) ?? null,
      accounts: starts.length,
    },
    kinds,
    chargedCents: cents(kinds.reduce((s, k) => s + k.chargedCents, 0)),
    givenBack,
    givenBackCents: sumRows(givenBack),
    uncounted,
    uncountedCents: sumRows(uncounted),
    leftOut: {
      interestCents: sumRows(interest),
      interestCount: interest.length,
      annualCents: sumRows(annual),
      annualCount: annual.length,
    },
    amountsOnHandoverDays: printed.filter((r) => r.onHandoverDay).length,
  };
}

function toFeeRow(t: BankFeeRowInput, handoverKeys: ReadonlySet<string>): FeeRow {
  const label = t.merchantName?.trim() ? t.merchantName.trim() : t.rawDescriptor;
  return {
    transactionId: t.id,
    date: t.date as ISODate,
    label,
    // The register's name is often the bank text re-cased ("Overdraft Item Fee"); printing both
    // would say the same words twice.
    rawDescriptor: sameWords(label, t.rawDescriptor) ? null : t.rawDescriptor,
    amountCents: cents(Math.abs(t.amountCents)),
    onHandoverDay: handoverKeys.has(handoverKey(t.accountId, t.date)),
  };
}

function sameWords(a: string, b: string): boolean {
  const norm = (x: string) => x.trim().replace(/\s+/g, ' ').toUpperCase();
  return norm(a) === norm(b);
}
