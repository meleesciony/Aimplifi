/**
 * Fees you paid — the bank fees in the reader's last 12 months of records, by kind, net of
 * what came back (DECISIONS #796).
 *
 * The opportunity list ("Worth a look") is built from RECURRING SERIES and every figure on it
 * flows into the FI cut, the radar cut-walk, Ask's "what to cut" total and the Today feed. A
 * fee is not a series — an overdraft is the opposite of a rhythm — so this is its own engine
 * and its own card, and none of those totals move.
 *
 * What counts:
 *  - Rows the reader has FILED under Fees & Charges, ATM Fee or Late Fee (the stored
 *    category — a correction is honoured), on the one flow basis (`countsInFlows`: posted,
 *    not a transfer or money move, not a split parent, not excluded), dated in the 12 months
 *    ending today.
 *  - Money out is a charge. Money in on one of those rows is a fee given back.
 *  - Money in filed anywhere else counts as given back only when its bank text says it is a
 *    fee being returned (`readsAsFeeGivenBack`). Both directions err LOW: a fee filed under
 *    some other category is never counted, and a returned fee is subtracted wherever it was
 *    filed — the figure can understate what the reader paid, never overstate it.
 *  - Interest and finance charges (filed under Interest & Finance Charges, or worded that way
 *    under Fees & Charges) and annual card fees are LEFT OUT and totalled separately: interest
 *    is the price of a carried balance, which the debt plan is about, and an annual fee is a
 *    card the reader chose to keep. Money coming back for either is left out with them.
 *
 * The kind is read from the filing first (ATM Fee, Late Fee) and then from the bank's own
 * text — never from the register's display name, which a reader can rename to anything.
 *
 * Pure: no I/O, integer cents, calendar dates, deterministic.
 */

import { addDays, addMonthsClamped, type ISODate } from '@/lib/dates';
import { type Cents, cents } from '@/lib/money';
import { countsInFlows, type TxnLike } from '@/lib/engine/fi/insights';
import { handoverKey } from '@/lib/engine/account/reconcile-boundary';

/** The filed categories whose rows this card reads as fees. One author. */
export const COUNTED_FEE_CATEGORY_IDS = ['fees', 'atm-fee', 'late-fee'] as const;

/** The filed category that is interest, never a fee here. */
export const INTEREST_CATEGORY_ID = 'fees-interest';

/** The kinds a counted fee can be, in the order a tie between two equal totals prints. */
export const FEE_KINDS = [
  'overdraft',
  'account',
  'late',
  'atm',
  'foreign',
  'wire',
  'advisory',
  'other',
] as const;
export type FeeKind = (typeof FEE_KINDS)[number];

/** What a fee-category row can be that this card does NOT count. */
export type LeftOutFeeKind = 'interest' | 'annual';

const COUNTED_SET: ReadonlySet<string> = new Set(COUNTED_FEE_CATEGORY_IDS);

// Bank text, upper-cased once. Order matters and is the order below: a row worded
// "INTL ATM FEE" is an ATM fee, "INTL WIRE FEE" a wire fee, "INTEREST CHARGE REVERSAL"
// interest (left out), "ANNUAL FEE" left out before any other word can claim it.
const INTEREST_RE = /\b(INTEREST|FINANCE CHARGES?)\b/;
const ANNUAL_RE = /\b(ANNUAL (MEMBERSHIP |CARD )?FEE|MEMBERSHIP FEE)\b/;
const OVERDRAFT_RE =
  /\b(OVERDRAFT|OVERDRAWN|OD (FEE|ITEM|CHARGE)|NSF|NON-?SUFFICIENT|INSUFFICIENT FUNDS?|RETURNED (ITEM|CHECK|CHEQUE|PAYMENT|ACH|DEBIT)|RETURN ITEM|PAID ITEM|ITEM PAID|COURTESY PAY)\b/;
const ATM_RE = /\bATM\b/;
const LATE_RE = /\b(LATE (FEE|CHARGE|PAYMENT|PMT)|PAST DUE (FEE|CHARGE))\b/;
const WIRE_RE = /\bWIRE\b/;
const FOREIGN_RE =
  /\b(FOREIGN (TRANSACTION|TRANS|TXN|EXCHANGE|CURRENCY|PURCHASE)|INTERNATIONAL (TRANSACTION|TRANS|TXN|PURCHASE|SERVICE)|INTL (TRANSACTION|TRANS|TXN|PURCHASE|SERVICE)|FX FEE|CURRENCY CONVERSION|CROSS[- ]BORDER)\b/;
const ADVISORY_RE = /\b(ADVISORY|ADVISOR|MANAGEMENT FEE|MGMT FEE|WRAP FEE|ASSET[- ]BASED FEE|AUM FEE|PORTFOLIO FEE)\b/;
const ACCOUNT_RE =
  /\b(MONTHLY (MAINTENANCE |SERVICE |ACCOUNT )?(FEE|CHARGE)|MAINTENANCE (FEE|CHARGE)|SERVICE CHARGES?|ACCOUNT (FEE|CHARGE)|MINIMUM BALANCE|LOW BALANCE|BELOW MINIMUM|PAPER STATEMENT|STATEMENT FEE)\b/;

/**
 * Which kind a fee-category row is. `null` for a row not filed under a fee category at all.
 *
 * The filing decides first: a row the reader filed under ATM Fee or Late Fee is that kind
 * whatever its text says, and Interest & Finance Charges is interest. Under Fees & Charges
 * the bank's text decides; anything the text does not place is `other` — still counted.
 */
export function feeKindOf(
  categoryId: string | null | undefined,
  rawDescriptor: string,
): FeeKind | LeftOutFeeKind | null {
  if (categoryId === INTEREST_CATEGORY_ID) return 'interest';
  if (categoryId === 'atm-fee') return 'atm';
  if (categoryId === 'late-fee') return 'late';
  if (categoryId !== 'fees') return null;
  return feeKindFromText(rawDescriptor);
}

function feeKindFromText(rawDescriptor: string): FeeKind | LeftOutFeeKind {
  const s = rawDescriptor.toUpperCase();
  if (INTEREST_RE.test(s)) return 'interest';
  if (ANNUAL_RE.test(s)) return 'annual';
  if (OVERDRAFT_RE.test(s)) return 'overdraft';
  if (ATM_RE.test(s)) return 'atm';
  if (LATE_RE.test(s)) return 'late';
  if (WIRE_RE.test(s)) return 'wire';
  if (FOREIGN_RE.test(s)) return 'foreign';
  if (ADVISORY_RE.test(s)) return 'advisory';
  if (ACCOUNT_RE.test(s)) return 'account';
  return 'other';
}

const FEE_WORD_RE = /\bFEES?\b/;
const GIVEN_BACK_WORD_RE = /\b(REVERS\w*|REFUND\w*|REBATE\w*|REIMB\w*|WAIVE\w*|CREDIT)\b/;
const NAMED_FEE_GIVEN_BACK_RE = /\b(OVERDRAFT|NSF|ATM)\b.*\b(REVERS\w*|REFUND\w*|REBATE\w*|REIMB\w*)\b/;

/**
 * Bank text that says a fee is being handed back — read only on MONEY IN filed outside the fee
 * categories ("ATM FEE REBATE" filed as Refunds, "OVERDRAFT REVERSAL" filed as Other income).
 * Interest and annual-fee wording stays with the left-out kinds.
 */
export function readsAsFeeGivenBack(rawDescriptor: string): boolean {
  const s = rawDescriptor.toUpperCase();
  const reads =
    (FEE_WORD_RE.test(s) && GIVEN_BACK_WORD_RE.test(s)) || NAMED_FEE_GIVEN_BACK_RE.test(s);
  if (!reads) return false;
  const kind = feeKindFromText(s);
  return kind !== 'interest' && kind !== 'annual';
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
  /** Money in counted as fees given back. Newest first. Σ amountCents === givenBackCents. */
  givenBack: FeeRow[];
  givenBackCents: Cents;
  /** max(0, charged − given back) — what the fees cost after what came back. */
  netCents: Cents;
  leftOut: LeftOutFees;
  /** Charged and given-back rows (the ones these amounts are summed from) on a handover day. */
  countedOnHandoverDays: number;
}

/** First day of the 12-month window ending `today` (both ends inclusive). */
export function bankFeeWindowStart(today: ISODate): ISODate {
  return addDays(addMonthsClamped(today, -12), 1);
}

function byDateDesc(a: FeeRow, b: FeeRow): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.transactionId < b.transactionId ? -1 : a.transactionId > b.transactionId ? 1 : 0;
}

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
  let interestCents = 0;
  let interestCount = 0;
  let annualCents = 0;
  let annualCount = 0;

  for (const t of rows) {
    if (recordsFrom === null || t.date < recordsFrom) recordsFrom = t.date as ISODate;
    if (t.date < from || t.date > today) continue;
    if (t.amountCents === 0) continue;
    if (!countsInFlows(t, opts.excludedFlowIds)) continue;

    const filedAsFee = COUNTED_SET.has(t.categoryId ?? '') || t.categoryId === INTEREST_CATEGORY_ID;
    const kind = filedAsFee ? feeKindOf(t.categoryId, t.rawDescriptor) : null;
    const isMoneyIn = t.amountCents > 0;

    if (kind === null) {
      // Not filed as a fee: only money in whose bank text says a fee is coming back.
      if (!isMoneyIn || !readsAsFeeGivenBack(t.rawDescriptor)) continue;
      givenBack.push(toFeeRow(t, handoverKeys));
      continue;
    }
    if (kind === 'interest' || kind === 'annual') {
      if (isMoneyIn) continue; // a reversal of a left-out charge is left out with it
      const magnitude = -t.amountCents;
      if (kind === 'interest') {
        interestCents += magnitude;
        interestCount += 1;
      } else {
        annualCents += magnitude;
        annualCount += 1;
      }
      continue;
    }
    const row = toFeeRow(t, handoverKeys);
    if (isMoneyIn) {
      givenBack.push(row);
      continue;
    }
    const list = charged.get(kind) ?? [];
    list.push(row);
    charged.set(kind, list);
  }

  const kinds: FeeKindTotal[] = FEE_KINDS.filter((k) => charged.has(k)).map((kind) => {
    const list = (charged.get(kind) ?? []).sort(byDateDesc);
    return { kind, chargedCents: cents(list.reduce((s, r) => s + r.amountCents, 0)), rows: list };
  });
  // Stable sort: equal totals keep FEE_KINDS order.
  kinds.sort((a, b) => b.chargedCents - a.chargedCents);
  givenBack.sort(byDateDesc);

  const chargedCents = cents(kinds.reduce((s, k) => s + k.chargedCents, 0));
  const givenBackCents = cents(givenBack.reduce((s, r) => s + r.amountCents, 0));
  const countedOnHandoverDays =
    kinds.reduce((s, k) => s + k.rows.filter((r) => r.onHandoverDay).length, 0) +
    givenBack.filter((r) => r.onHandoverDay).length;

  return {
    from,
    to: today,
    recordsFrom,
    kinds,
    chargedCents,
    givenBack,
    givenBackCents,
    netCents: cents(Math.max(0, chargedCents - givenBackCents)),
    leftOut: {
      interestCents: cents(interestCents),
      interestCount,
      annualCents: cents(annualCents),
      annualCount,
    },
    countedOnHandoverDays,
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
