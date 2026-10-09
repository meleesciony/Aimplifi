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
 * months ending today. A reconnected account is one account: its predecessor's rows count
 * under its live successor (`terminalOf`).
 *
 * THE TEXT IS READ BY ALLOWLIST (critic cycle 2). After the noise a bank adds is taken off —
 * digits, amounts, account masks, dates written as a month and a number, "NON-<BANK>" before
 * ATM, and, after an overdraft or returned-item fee's own words, the "FOR A $12.00 … /
 * DETAILS: …" tail naming the item that caused it — EVERY word left must be a fee word, a
 * connective, or one kind's own words, with a word that names the kind (its anchor). One
 * word outside — a business's name, a payment, a principal (CHARGE-BACK, DEPOSITED ITEM), a
 * product (IRA, STOP PAYMENT) — and the row is not read as a bank or card fee.
 *
 *  - A CHARGE is money out filed under Fees & Charges, ATM Fee or Late Fee whose text reads as
 *    a kind. The text's own kind wins; when the text names no kind, an ATM Fee or Late Fee
 *    filing supplies one (its anchor, never its vocabulary). Everything else filed there is
 *    listed as NOT COUNTED, with its amount.
 *  - CAME BACK is money in, under any filing, whose text — less the words saying it was given
 *    back (REFUND, REVERSAL, REBATE, REIMBURSEMENT, WAIVED, CREDIT …; CREDIT kept beside WIRE)
 *    — reads as a counted kind, and ONLY UP TO WHAT WAS CHARGED of that kind on that account in
 *    the window (critic cycle 3, P1-2). Credits are taken oldest first; one that would take the
 *    account's give-back for that kind past its charges is not counted. So money in can never
 *    be read as more returned fees than the fees there were — an incoming wire worded only in
 *    wire words, an ATM withdrawal reversed, never mind how it is worded.
 *  - Interest PHRASES (Interest & Finance Charges, "INTEREST CHARGE", "FINANCE CHARGE" …) and
 *    a card's or account's annual fee (the phrase, with no other word beside it) are read first
 *    and LEFT OUT, totalled separately.
 *
 * Everything errs low by construction: a real fee worded with any word the vocabulary lacks is
 * listed rather than counted, and a refund that can't be placed isn't shown. The card says
 * "at least" and prints no net.
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
export const FEE_WORDS = words('FEE FEES CHARGE CHARGES SURCHARGE');
/** Connectives any kind may carry. */
export const FILLER = words('FOR A AN THE OF ON PER AND ASSESSED POSTED');

/**
 * Each kind: the words that name it (`anchors` — one required unless an ATM Fee / Late Fee
 * filing supplies the kind) and every other word it may carry (`vocab`). With an anchor
 * required, no text is wholly two kinds' words, so the order kinds are tried in never decides.
 */
export const FEE_KIND_WORDS: Record<FeeKind, { anchors: ReadonlySet<string>; vocab: ReadonlySet<string> }> = {
  overdraft: {
    anchors: words('OVERDRAFT OVERDRAWN OD NSF INSUFFICIENT NONSUFFICIENT RETURNED RETURN COURTESY PAID'),
    vocab: words('ITEM ITEMS FUND FUNDS CHECK CHECKS ACH DEBIT PAYMENT PAY EXTENDED CONTINUOUS SUSTAINED DAILY PROTECTION TRANSFER XFER ACCOUNT ACCT'),
  },
  atm: {
    anchors: words('ATM NETWORK INQUIRY INQ'),
    vocab: words('WITHDRAWAL WITHDRAW WITH WDRL WD CASH BALANCE NON OUT FOREIGN INTL INTERNATIONAL DOMESTIC OPERATOR OWNER USAGE USE TRANSACTION TXN'),
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
export const GIVEN_BACK_WORDS = words('REFUND REFUNDED REFUNDS REVERSAL REVERSALS REVERSED REVERSE REV REBATE REBATED REIMBURSEMENT REIMBURSED REIMB WAIVED WAIVER WAIVE CREDIT CREDITED');

const MONTH =
  '(JAN(UARY)?|FEB(RUARY)?|MAR(CH)?|APR(IL)?|MAY|JUNE?|JULY?|AUG(UST)?|SEPT?(EMBER)?|OCT(OBER)?|NOV(EMBER)?|DEC(EMBER)?)';
const TAIL_RE = /[\s-](FOR AN? \$\d|DETAILS?:)/;
/** A date written with a month's name: "AUG 31", "AUG-31", "AUG31", "AUG 31ST", "AUG 2026", "31 AUG", "31-AUG". */
const MONTH_DATE_RES = [
  new RegExp(`\\b${MONTH}[-./ ]?\\d{1,4}(ST|ND|RD|TH)?\\b`, 'g'),
  new RegExp(`\\b\\d{1,2}(ST|ND|RD|TH)?[-./ ]?${MONTH}\\b`, 'g'),
];
/** "NON-<BANK> ATM" — a bank's name of up to four words, hyphen-joined to NON, right before ATM. */
const NON_BANK_ATM_RE = /\bNON-[A-Z0-9&]+(?:\s+[A-Z0-9&]+){0,3}?(?=\s+ATM\b)/g;

/** The only words an annual fee left out may carry: an annual CARD or ACCOUNT fee, not a club's or an HOA's. */
const ANNUAL_WORDS = words('ANNUAL MEMBERSHIP CARD ACCOUNT ACCT');

function tokens(s: string): string[] {
  return s
    .split(/[^A-Z0-9&]+/)
    .filter((t) => t !== '' && !/^\d+$/.test(t) && !/^X+\d+$/.test(t) && !/^\d+(ST|ND|RD|TH)$/.test(t));
}

const OVERDRAFT_ANCHORS = FEE_KIND_WORDS.overdraft.anchors;

/**
 * The words of a bank's text, with the noise a bank adds taken off: numbers, amounts, account
 * masks (X…1234), ordinals, a date written with a month's name ("AUG 31", "31 AUG", "AUG31" —
 * never a lone month name), "NON-<BANK>" before ATM (a bank's name of up to four words), and —
 * only after an overdraft or returned-item fee's own words — the "FOR A $12.00 … PURCHASE /
 * DETAILS: …" tail, which names the item that caused the fee, not who charged it (critic cycle 3,
 * P2-3: on any other text that tail can be a business's name). Critic cycle 4, P2-4: the rule
 * promised these and the code set aside less.
 */
export function feeTextWords(rawDescriptor: string): string[] {
  let s = rawDescriptor.toUpperCase().replace(/\bNON[- ]SUFFICIENT\b/g, 'NONSUFFICIENT');
  for (const re of MONTH_DATE_RES) s = s.replace(re, ' ');
  s = s.replace(NON_BANK_ATM_RE, ' NON ');
  const tail = TAIL_RE.exec(s);
  if (tail && tokens(s.slice(0, tail.index)).some((t) => OVERDRAFT_ANCHORS.has(t))) {
    s = s.slice(0, tail.index);
  }
  return tokens(s);
}

const TEXT_ORDER: readonly FeeKind[] = ['overdraft', 'atm', 'late', 'wire', 'foreign', 'account'];

/**
 * The kind a set of words is wholly made of, or null. The text's own kind first (an anchor
 * required); failing that, `filed` — the kind an ATM Fee or Late Fee filing supplies, its
 * anchor waived but never its vocabulary (critic cycle 3, P3-6: a card's foreign transaction
 * fee filed under ATM Fee is a foreign transaction fee).
 */
function kindOfWords(tokensIn: readonly string[], filed: FeeKind | null): FeeKind | null {
  if (!tokensIn.some((t) => FEE_WORDS.has(t))) return null;
  const fitsKind = (kind: FeeKind, anchorRequired: boolean) => {
    const { anchors, vocab } = FEE_KIND_WORDS[kind];
    const fits = tokensIn.every((t) => FEE_WORDS.has(t) || FILLER.has(t) || anchors.has(t) || vocab.has(t));
    return fits && (!anchorRequired || tokensIn.some((t) => anchors.has(t)));
  };
  const byText = TEXT_ORDER.find((kind) => fitsKind(kind, true));
  if (byText) return byText;
  return filed !== null && fitsKind(filed, false) ? filed : null;
}

/**
 * How a row filed under a fee category reads. `null` for a row not filed under one.
 *
 * Interest & Finance Charges is interest whatever its text; interest phrases, and a card's or
 * account's annual fee worded alone, are left out under every filing. Otherwise the text must be
 * wholly one kind's words or the row is `unread`.
 */
export function feeKindOf(categoryId: string | null | undefined, rawDescriptor: string): FeeReading | null {
  if (categoryId === INTEREST_CATEGORY_ID) return 'interest';
  if (!COUNTED_SET.has(categoryId ?? '')) return null;
  const upper = rawDescriptor.toUpperCase();
  if (INTEREST_RE.test(upper)) return 'interest';
  const textWords = feeTextWords(rawDescriptor);
  // Critic cycle 4, P2-5: the annual phrase alone put an HOA's or a club's annual fee beside
  // "the yearly price of keeping a card or account". Left out as annual only when the text is
  // wholly a card's or account's annual-fee words; otherwise the word test decides.
  if (ANNUAL_RE.test(upper) && textWords.every((t) => ANNUAL_WORDS.has(t) || FEE_WORDS.has(t) || FILLER.has(t))) {
    return 'annual';
  }
  const filed: FeeKind | null = categoryId === 'atm-fee' ? 'atm' : categoryId === 'late-fee' ? 'late' : null;
  return kindOfWords(textWords, filed) ?? 'unread';
}

/**
 * The counted kind money in reads as handing back, or null: its text, less the words saying it
 * was given back, must be wholly one kind's words (CREDIT kept beside WIRE). Interest and
 * annual-fee wording needs no check of its own: INTEREST, FINANCE and ANNUAL are in no kind's
 * words. Whether it COUNTS also depends on what was charged — see `findBankFees`.
 */
export function feeGivenBackKind(rawDescriptor: string): FeeKind | null {
  const all = feeTextWords(rawDescriptor);
  const wire = all.includes('WIRE');
  const rest = all.filter((t) => !GIVEN_BACK_WORDS.has(t) || (wire && (t === 'CREDIT' || t === 'CREDITED')));
  return kindOfWords(rest, null);
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

/** How far back the records reach, account by account — a reconnected account is one account. */
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
  /**
   * Money in counted as a fee coming back — never more, per account and kind, than was charged.
   * Newest first. Σ amountCents === givenBackCents ≤ chargedCents.
   */
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
    /** `snap.terminalOf` — a superseded account's id → its live successor's (one real account). */
    terminalOf?: ReadonlyMap<string, string>;
  } = {},
): BankFees {
  const from = bankFeeWindowStart(today);
  const handoverKeys = opts.handoverKeys ?? new Set<string>();
  const accountOf = (id: string) => opts.terminalOf?.get(id) ?? id;

  const firstRowByAccount = new Map<string, string>();
  const charged = new Map<FeeKind, FeeRow[]>();
  const chargedByAccountKind = new Map<string, number>();
  const credits: { row: FeeRow; key: string }[] = [];
  const uncounted: FeeRow[] = [];
  const interest: FeeRow[] = [];
  const annual: FeeRow[] = [];

  for (const t of rows) {
    const account = accountOf(t.accountId);
    if (t.date > today) continue; // a row dated after today is no record yet (critic cycle 4, P3-7)
    const first = firstRowByAccount.get(account);
    if (first === undefined || t.date < first) firstRowByAccount.set(account, t.date);
    if (t.date < from) continue;
    if (t.amountCents === 0) continue;
    if (!countsInFlows(t, opts.excludedFlowIds)) continue;

    if (t.amountCents > 0) {
      const kind = feeGivenBackKind(t.rawDescriptor);
      if (kind !== null) credits.push({ row: toFeeRow(t, handoverKeys), key: `${account}|${kind}` });
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
      const key = `${account}|${reading}`;
      chargedByAccountKind.set(key, (chargedByAccountKind.get(key) ?? 0) + row.amountCents);
    }
  }

  // Oldest first, so the cap is spent in the order the money arrived (ties by id: deterministic).
  credits.sort((a, b) => -byDateDesc(a.row, b.row));
  const givenBack: FeeRow[] = [];
  const spent = new Map<string, number>();
  for (const { row, key } of credits) {
    const room = (chargedByAccountKind.get(key) ?? 0) - (spent.get(key) ?? 0);
    if (row.amountCents > room) continue;
    spent.set(key, (spent.get(key) ?? 0) + row.amountCents);
    givenBack.push(row);
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
