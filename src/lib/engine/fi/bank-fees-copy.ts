/**
 * The words of the "Fees you paid" card on /coach (DECISIONS #796). One author per sentence;
 * the engine is `bank-fees.ts`.
 *
 * Every figure sentence is a statement about the reader's RECORDS over a named window, and the
 * rule — one tap under the figures — says which rows those are, in the same terms the engine
 * reads them. The engine errs low by construction (an allowlist of fee words), so the paid
 * figure says "at least", a zero says "counted", and no sentence states a net.
 *
 * No sentence points at another part of the card ("above", "below"): the kinds are named where
 * they are meant (critic cycle 2, P2-6 — "the fees above" with nothing above).
 *
 * Educational, never advisory: each kind says how that kind of fee is usually avoided, in
 * general terms; nothing names a bank, a card or a product.
 */

import type { ISODate } from '@/lib/dates';
import { formatMonth } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import type { BankFees, FeeKind, FeeKindTotal, FeeRecords } from '@/lib/engine/fi/bank-fees';

export const BANK_FEES_CARD_ID = 'fees-you-paid';

export const BANK_FEES_TITLE = 'Fees you paid';

export const FEE_KIND_COPY: Record<FeeKind, { label: string; avoid: string }> = {
  overdraft: {
    label: 'Overdraft and returned-item fees',
    avoid:
      'Charged when a payment is bigger than the balance. A low-balance alert, a cushion left in checking, or having the bank decline a card purchase instead of covering it usually prevents them.',
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
    avoid:
      "Charged for sending a wire, and by some banks for receiving one; a standard bank transfer is usually free when the money doesn't have to arrive the same day.",
  },
};

/** The counted kinds in words, for the sentences that must name them. */
const KINDS_IN_WORDS = 'overdraft or returned-item, monthly account, late, ATM, foreign transaction or wire';

/** "Jun 2, 2026" — a calendar date for a sentence or a row. UI boundary only. */
export function feeDate(date: ISODate): string {
  const month = formatMonth(date.slice(0, 7)).split(' ')[0];
  return `${month} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`;
}

/**
 * The window as the lead names it, given records exist — decided ACCOUNT BY ACCOUNT (critic
 * cycle 2, P2-7): "in the last 12 months" only when every account's records reach the window's
 * first day; "since your records begin on …" when none does; otherwise the window, and how many
 * accounts' records begin inside it.
 */
export function feeWindowPhrase(records: FeeRecords & { from: ISODate }): string {
  const n = records.accountsStartingInWindow;
  if (n === 0) return 'in the last 12 months';
  if (n === records.accounts) return `since your records begin on ${feeDate(records.from)}`;
  const latest = feeDate(records.latestAccountStart ?? records.from);
  return n === 1
    ? `in the last 12 months (one account's records begin later, on ${latest})`
    : `in the last 12 months (records for ${n} accounts begin later, the latest on ${latest})`;
}

function charges(n: number): string {
  return n === 1 ? '1 charge' : `${n} charges`;
}

/** The card's lead when there are no checking, savings or card rows to read at all. */
export const BANK_FEES_NO_RECORDS = 'No checking, savings or card records yet, so there are no fees to count.';

/**
 * The card's first sentence. Money back never exceeds what was charged (the engine caps it per
 * account and kind), so with nothing charged there is nothing back — one zero sentence.
 */
export function bankFeesLead(f: BankFees): string {
  if (f.records.from === null) return BANK_FEES_NO_RECORDS;
  const when = feeWindowPhrase({ ...f.records, from: f.records.from });
  if (f.chargedCents === 0) return `No bank or card fees counted ${when}.`;
  const count = f.kinds.reduce((s, k) => s + k.rows.length, 0);
  const paid = `You paid at least ${formatCents(f.chargedCents)} in bank and card fees (${charges(count)}) ${when}`;
  return f.givenBackCents === 0 ? `${paid}.` : `${paid}, and ${formatCents(f.givenBackCents)} of fees came back.`;
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
export const BANK_FEES_UNCOUNTED_NOTE = `Their bank text doesn't pass this card's word test for an ${KINDS_IN_WORDS} fee (see "How these are counted"), so they're listed here and left out of the total.`;

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
    why.push('Interest is what borrowing costs — a balance carried past its due date, or a cash advance.');
  }
  if (annualCount > 0) {
    parts.push(`${formatCents(annualCents)} of annual fees (${charges(annualCount)})`);
    why.push('An annual fee is the yearly price of keeping a card or account.');
  }
  if (parts.length === 0) return null;
  return `Left out: ${parts.join(' and ')}. ${why.join(' ')}`;
}

/** The disclosure that holds the rule. */
export const BANK_FEES_RULE_SUMMARY = 'How these are counted';

/**
 * The rule, one tap under the figures. A statement about this card, never about the reader —
 * and in the engine's own terms (critic cycles 1–2: a rule that describes a narrower or a
 * different test than the code runs is a false sentence).
 */
export const BANK_FEES_RULE = `Reads your checking, savings and card accounts over the 12 months up to and including today — an account you reconnected counts as one — leaving out pending rows, transfers and money moved to investments or savings, split totals, loan payments the app counts on the loan, and rows you've excluded. The word test: set aside numbers, amounts, account digits, dates, the bank's name in "NON-<bank> ATM", and, after an overdraft or returned-item fee's own words, the "for a $…" or "details:" part naming the item that caused it; the test passes when every word left belongs to one ${KINDS_IN_WORDS} fee, including a word that names that kind (overdraft, ATM, late, wire, foreign, monthly and the like) and a fee word (fee, charge or surcharge), with only a few connecting words (for, a, of, on …) besides. A charge counts when it's filed under Fees & Charges, ATM Fee or Late Fee and passes the word test (a row filed under ATM Fee or Late Fee may leave out the word naming its kind); anything else filed there is listed as not counted. Money in counts as fees that came back, wherever it's filed, when it passes the same test apart from words like refund, reversal, rebate, reimbursement, waived or credit (credit beside a wire doesn't count) — and only up to what was charged of that kind on that account in these 12 months; other money in isn't shown. Interest and finance charges and annual fees are left out. Everything errs low: a real fee worded in a way this card doesn't know is listed, not counted, and money back the card can't place isn't shown.`;
