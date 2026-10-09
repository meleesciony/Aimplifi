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
 * A CHARGE counts when the row is money out filed under Fees & Charges, ATM Fee or Late Fee
 * AND its bank text reads as a bank or card fee (`readFeeText`): a fee word (fee / charge /
 * surcharge), no word naming another kind of business (an HOA, a landlord, a school, a
 * utility …), not a returned DEPOSIT, and one of the kinds' phrases — the filing decides the
 * kind for ATM Fee and Late Fee. Everything else filed under those categories is listed as
 * NOT COUNTED, with its amount: the categorizer files HOA maintenance fees, apartment late
 * fees and overdraft-protection transfers there, and a bounced deposit's principal reads
 * "INSUFFICIENT FUNDS" with no fee word (critic cycle 1, P1-2).
 *
 * Money BACK counts, wherever it is filed, only when its bank text names one of those fee
 * kinds AND says it was refunded / reversed / rebated / reimbursed / waived / credited
 * (`readsAsFeeGivenBack`). An ATM withdrawal reversal, an overdraft-protection transfer from
 * savings, an airline "fee credit" or a tuition refund is not a bank fee coming back (critic
 * cycle 1, P0-1).
 *
 * Interest and finance charges (Interest & Finance Charges, or the interest PHRASES under
 * Fees & Charges — never the bare word, which "INTEREST CHECKING MONTHLY SERVICE FEE" carries)
 * and annual fees are LEFT OUT and totalled separately: interest is the price of a carried
 * balance, which the debt plan is about, and an annual fee is the price of keeping a card or
 * account.
 *
 * The text is all there is to go on, so a fee from someone else worded like a bank's can
 * still be counted, and a bank fee worded unusually is listed rather than counted. The card
 * prints no net: a refund the text can't place would make one overstate.
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
const KIND_SET: ReadonlySet<string> = new Set(FEE_KINDS);

// Bank text, upper-cased once. The checks run in the order `readFeeText` lists them.
const INTEREST_RE =
  /\b(INTEREST (CHARGE[DS]?|CHG|FEE|ON (PURCHASES|CASH|BALANCES?))|(PURCHASE|CASH ADVANCE|BALANCE TRANSFER|PLAN|MINIMUM) INTEREST|FINANCE CHARGES?)\b/;
const ANNUAL_RE = /\bANNUAL (MEMBERSHIP |CARD |ACCOUNT )?FEE\b/;
const NOT_A_BANK_RE =
  /\b(HOA|HOMEOWNERS?|ASSOCIATION|ASSN|ASSOC|CONDO\w*|TIMESHARE|RESORTS?|APARTMENTS?|APTS?|STORAGE|RENT|RENTAL|LEASE|LEASING|LANDLORD|PROPERTY|PROPERTIES|TUITION|UNIVERSITY|COLLEGE|SCHOOL|PARKING|TOLLS?|LIBRARY|COURT|DMV|UTILITY|UTILITIES|ELECTRIC|WATER|SEWER|CABLE|WIRELESS|INTERNET|INSURANCE|MEDICAL|HOSPITAL|CLINIC|DENTAL|GYM|FITNESS|CLUB|MEMBERSHIP|AIRLINES?|AIRWAYS|BAG|BAGGAGE|TICKET\w*|CONVENIENCE|SHIPPING|DELIVERY|SUBSCRIPTION)\b/;
const DEPOSIT_RETURN_RE = /\b(DEPOSIT(ED)? (ITEM|CHECK)|RETURNED DEPOSIT|DEPOSIT RETURN(ED)?)\b/;
const FEE_WORD_RE = /\b(FEES?|CHARGES?|SURCHARGE)\b/;
const OVERDRAFT_RE =
  /\b(OVERDRAFT|OVERDRAWN|OD (FEE|ITEM|CHARGE)|NSF|NON-?SUFFICIENT|INSUFFICIENT FUNDS?|RETURNED (ITEM|CHECK|CHEQUE|PAYMENT|ACH|DEBIT)|RETURN ITEM|PAID ITEM|ITEM PAID|COURTESY PAY)\b/;
const ATM_RE = /\bATM\b/;
const LATE_RE = /\b(LATE (FEE|CHARGE|PAYMENT|PMT)|PAST DUE (FEE|CHARGE))\b/;
const WIRE_RE = /\bWIRE\b/;
const FOREIGN_RE =
  /\b(FOREIGN (TRANSACTION|TRANS|TXN|EXCHANGE|CURRENCY|PURCHASE)|INTERNATIONAL (TRANSACTION|TRANS|TXN|PURCHASE|SERVICE)|INTL (TRANSACTION|TRANS|TXN|PURCHASE|SERVICE)|FX FEE|CURRENCY CONVERSION|CROSS[- ]BORDER)\b/;
const ACCOUNT_RE =
  /\b(MONTHLY (MAINTENANCE |SERVICE |ACCOUNT )?(FEE|CHARGE)|MAINTENANCE (FEE|CHARGE)|SERVICE CHARGES?|ACCOUNT (FEE|CHARGE)|MINIMUM BALANCE|LOW BALANCE|BELOW MINIMUM|PAPER STATEMENT|STATEMENT FEE)\b/;
const GIVEN_BACK_RE = /\b(REVERS\w*|REFUND\w*|REBATE\w*|REIMB\w*|WAIVE\w*|CREDIT(ED)?)\b/;

/**
 * What a row's bank text says, before the filing has its say. `'fee'` = it reads as a bank or
 * card fee but names no kind — the ATM Fee and Late Fee filings supply one; Fees & Charges
 * cannot.
 */
function readFeeText(rawDescriptor: string): FeeReading | 'fee' {
  const s = rawDescriptor.toUpperCase();
  if (INTEREST_RE.test(s)) return 'interest';
  if (ANNUAL_RE.test(s)) return 'annual';
  if (NOT_A_BANK_RE.test(s)) return 'unread';
  if (DEPOSIT_RETURN_RE.test(s)) return 'unread';
  if (!FEE_WORD_RE.test(s)) return 'unread';
  if (OVERDRAFT_RE.test(s)) return 'overdraft';
  if (ATM_RE.test(s)) return 'atm';
  if (LATE_RE.test(s)) return 'late';
  if (WIRE_RE.test(s)) return 'wire';
  if (FOREIGN_RE.test(s)) return 'foreign';
  if (ACCOUNT_RE.test(s)) return 'account';
  return 'fee';
}

/**
 * How a row filed under a fee category reads. `null` for a row not filed under one.
 *
 * Interest & Finance Charges is interest whatever its text. Otherwise the text decides first —
 * interest and annual phrases are left out, and text that doesn't read as a bank or card fee
 * is `unread` under every filing — then the ATM Fee and Late Fee filings decide the kind, and
 * under Fees & Charges the text's own kind does (no kind → `unread`).
 */
export function feeKindOf(categoryId: string | null | undefined, rawDescriptor: string): FeeReading | null {
  if (categoryId === INTEREST_CATEGORY_ID) return 'interest';
  if (!COUNTED_SET.has(categoryId ?? '')) return null;
  const text = readFeeText(rawDescriptor);
  if (text === 'interest' || text === 'annual' || text === 'unread') return text;
  if (categoryId === 'atm-fee') return 'atm';
  if (categoryId === 'late-fee') return 'late';
  return text === 'fee' ? 'unread' : text;
}

/**
 * Bank text that names one of the counted fee kinds and says it is being handed back. Read on
 * MONEY IN under any filing — and the only way money in counts.
 */
export function readsAsFeeGivenBack(rawDescriptor: string): boolean {
  const s = rawDescriptor.toUpperCase();
  return GIVEN_BACK_RE.test(s) && KIND_SET.has(readFeeText(s));
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

export interface BankFees {
  /** First day of the window (inclusive): the day after today minus 12 months. */
  from: ISODate;
  /** Last day of the window (inclusive): today. */
  to: ISODate;
  /** The earliest row date among every row handed in (all filings), or null when none. */
  recordsFrom: ISODate | null;
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

  let recordsFrom: ISODate | null = null;
  const charged = new Map<FeeKind, FeeRow[]>();
  const givenBack: FeeRow[] = [];
  const uncounted: FeeRow[] = [];
  const interest: FeeRow[] = [];
  const annual: FeeRow[] = [];

  for (const t of rows) {
    if (recordsFrom === null || t.date < recordsFrom) recordsFrom = t.date as ISODate;
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

  const printed = [...kinds.flatMap((k) => k.rows), ...givenBack, ...uncounted, ...interest, ...annual];

  return {
    from,
    to: today,
    recordsFrom,
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
