/**
 * The words of the "Fees you paid" card on /coach (DECISIONS #796). One author per sentence;
 * the engine is `bank-fees.ts`.
 *
 * Every figure sentence is a statement about the reader's RECORDS over a named window, and the
 * rule — one tap under the figures — says which rows those are, in the same terms the engine
 * reads them. A zero names its basis ("counted"), because a fee filed under another category
 * is in the records and is not counted here. No sentence states a net: a refund whose text the
 * engine can't place would make "they cost you" overstate (critic cycle 1).
 *
 * Educational, never advisory: each kind says how that kind of fee is usually avoided, in
 * general terms; nothing names a bank, a card or a product.
 */

import type { ISODate } from '@/lib/dates';
import { formatMonth } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import type { BankFees, FeeKind, FeeKindTotal } from '@/lib/engine/fi/bank-fees';

export const BANK_FEES_CARD_ID = 'fees-you-paid';

export const BANK_FEES_TITLE = 'Fees you paid';

export const FEE_KIND_COPY: Record<FeeKind, { label: string; avoid: string }> = {
  overdraft: {
    label: 'Overdraft and returned-item fees',
    avoid:
      'Charged when a payment is bigger than the balance. Linking savings as overdraft backup, a low-balance alert, or having the bank decline a card purchase instead of covering it usually prevents them.',
  },
  account: {
    label: 'Monthly account fees',
    avoid:
      'Banks usually publish a way to waive these, such as a minimum balance or a direct deposit, and accounts with no monthly fee exist.',
  },
  late: {
    label: 'Late fees',
    avoid:
      'Autopay for at least the minimum due usually prevents these; you can still pay more by hand before the due date.',
  },
  atm: {
    label: 'ATM fees',
    avoid:
      "Your own bank's ATMs, cash back at a store checkout, or an account that refunds ATM fees usually avoids these.",
  },
  foreign: {
    label: 'Foreign transaction fees',
    avoid:
      'Some cards charge no foreign transaction fee; paying with one abroad or on foreign websites avoids these.',
  },
  wire: {
    label: 'Wire fees',
    avoid: "A standard bank transfer is usually free when the money doesn't have to arrive the same day.",
  },
};

/** "Jun 2, 2026" — a calendar date for a sentence or a row. UI boundary only. */
export function feeDate(date: ISODate): string {
  const month = formatMonth(date.slice(0, 7)).split(' ')[0];
  return `${month} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`;
}

/**
 * The window as the lead names it, given records exist. "in the last 12 months" only when the
 * records reach back to the window's first day; otherwise the window is shorter than 12 months
 * of records and the sentence says where they begin.
 */
export function feeWindowPhrase(f: Pick<BankFees, 'from'> & { recordsFrom: ISODate }): string {
  if (f.recordsFrom > f.from) return `since your records begin on ${feeDate(f.recordsFrom)}`;
  return 'in the last 12 months';
}

function charges(n: number): string {
  return n === 1 ? '1 charge' : `${n} charges`;
}

/** The card's lead when there are no checking, savings or card rows to read at all. */
export const BANK_FEES_NO_RECORDS = 'No checking, savings or card records yet, so there are no fees to count.';

/** The card's first sentence. */
export function bankFeesLead(f: BankFees): string {
  if (f.recordsFrom === null) return BANK_FEES_NO_RECORDS;
  const when = feeWindowPhrase({ from: f.from, recordsFrom: f.recordsFrom });
  const back = `${formatCents(f.givenBackCents)} in fees came back`;
  if (f.chargedCents === 0) {
    return f.givenBackCents === 0
      ? `No bank or card fees counted ${when}.`
      : `No bank or card fees counted ${when}; ${back}.`;
  }
  const count = f.kinds.reduce((s, k) => s + k.rows.length, 0);
  const paid = `You paid ${formatCents(f.chargedCents)} in bank and card fees (${charges(count)}) ${when}`;
  return f.givenBackCents === 0 ? `${paid}.` : `${paid}, and ${back}.`;
}

/** One kind's heading line: "Late fees — $29.00 (1 charge)". */
export function feeKindLine(k: Pick<FeeKindTotal, 'kind' | 'chargedCents' | 'rows'>): string {
  return `${FEE_KIND_COPY[k.kind].label} — ${formatCents(k.chargedCents)} (${charges(k.rows.length)})`;
}

/** The given-back heading line. */
export function feesGivenBackLine(f: Pick<BankFees, 'givenBack' | 'givenBackCents'>): string {
  const n = f.givenBack.length;
  return `Came back — ${formatCents(f.givenBackCents)} (${n === 1 ? '1 fee returned' : `${n} fees returned`})`;
}

/** The not-counted heading line. */
export function feesUncountedLine(f: Pick<BankFees, 'uncounted' | 'uncountedCents'>): string {
  return `Filed as fees, not counted — ${formatCents(f.uncountedCents)} (${charges(f.uncounted.length)})`;
}

/** Under the not-counted heading: why those rows are listed and not in the total. */
export const BANK_FEES_UNCOUNTED_NOTE =
  "Their bank text doesn't read as one of the bank and card fees above, so they're listed here and left out of the total.";

/**
 * What the figures leave out, by amount, when there is any. `null` when nothing was left out.
 * Each reason prints only beside the money it explains.
 */
export function feesLeftOutLine(f: Pick<BankFees, 'leftOut'>): string | null {
  const { interestCents, interestCount, annualCents, annualCount } = f.leftOut;
  const parts: string[] = [];
  const why: string[] = [];
  if (interestCount > 0) {
    parts.push(`${formatCents(interestCents)} of interest and finance charges (${charges(interestCount)})`);
    why.push('Interest is the cost of a balance carried from month to month.');
  }
  if (annualCount > 0) {
    parts.push(`${formatCents(annualCents)} of annual fees (${charges(annualCount)})`);
    why.push('An annual fee is the yearly price of keeping a card or account.');
  }
  if (parts.length === 0) return null;
  return `Not counted here: ${parts.join(' and ')}. ${why.join(' ')}`;
}

/** The disclosure that holds the rule. */
export const BANK_FEES_RULE_SUMMARY = 'How these are counted';

/**
 * The rule, one tap under the figures. A statement about this card, never about the reader —
 * and in the engine's own terms (critic cycle 1, P2-6: the first rule described a narrower
 * test than the code ran).
 */
export const BANK_FEES_RULE =
  "Reads your checking, savings and card accounts over the 12 months up to and including today. A charge counts when it's filed under Fees & Charges, ATM Fee or Late Fee and its bank text reads as one of the fees above: it has a fee word (fee, charge or surcharge), names the kind of fee (a row filed under ATM Fee or Late Fee is that kind), and doesn't name another kind of business, such as an HOA, a landlord, a school or a utility. Anything else filed there is listed as not counted. Money back counts, wherever it's filed, when its bank text names one of those fees and says it was refunded, reversed, rebated, reimbursed, waived or credited. The text is all there is to go on, so a fee from someone else worded like a bank's can still be counted. Interest and finance charges and annual fees are left out, and a row you've excluded isn't read.";
