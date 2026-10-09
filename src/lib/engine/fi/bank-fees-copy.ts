/**
 * The words of the "Fees you paid" card on /coach (DECISIONS #796). One author per sentence;
 * the engine is `bank-fees.ts`.
 *
 * Every figure sentence is a statement about the reader's RECORDS over a named window, and the
 * rule note — always printed under the figures — says which rows those are. A zero names its
 * basis ("counted"), because a fee filed under another category is in the records and is not
 * counted here.
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
  advisory: {
    label: 'Advisory and management fees',
    avoid:
      'A fee charged as a share of your balance is paid every year on all of it, so it is worth comparing with what the advice gives you.',
  },
  other: {
    label: 'Other fees',
    avoid: 'Worth asking what each one was for; some can be waived, or avoided with a different account or way of paying.',
  },
};

/** "Jun 2, 2026" — a calendar date for a sentence or a row. UI boundary only. */
export function feeDate(date: ISODate): string {
  const month = formatMonth(date.slice(0, 7)).split(' ')[0];
  return `${month} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`;
}

/**
 * The window as the lead names it. "in the last 12 months" only when the records reach back to
 * the window's first day; otherwise the window is shorter than 12 months of records and the
 * sentence says where they begin.
 */
export function feeWindowPhrase(f: Pick<BankFees, 'from' | 'recordsFrom'>): string {
  if (f.recordsFrom !== null && f.recordsFrom > f.from) {
    return `since your records begin on ${feeDate(f.recordsFrom)}`;
  }
  return 'in the last 12 months';
}

function charges(n: number): string {
  return n === 1 ? '1 charge' : `${n} charges`;
}

/** The card's first sentence. */
export function bankFeesLead(f: BankFees): string {
  const when = feeWindowPhrase(f);
  const count = f.kinds.reduce((s, k) => s + k.rows.length, 0);
  if (f.chargedCents === 0) {
    return f.givenBackCents === 0
      ? `No bank fees counted ${when}.`
      : `No bank fees counted ${when}, and ${formatCents(f.givenBackCents)} of fees came back to you.`;
  }
  const paid = `${formatCents(f.chargedCents)} in bank fees (${charges(count)}) ${when}`;
  if (f.givenBackCents === 0) return `You paid ${paid}.`;
  if (f.givenBackCents >= f.chargedCents) {
    return `You were charged ${paid}, and ${formatCents(f.givenBackCents)} came back.`;
  }
  return `You were charged ${paid}; ${formatCents(f.givenBackCents)} came back, so they cost you ${formatCents(f.netCents)}.`;
}

/** One kind's heading line: "Late fees — $29.00 (1 charge)". */
export function feeKindLine(k: Pick<FeeKindTotal, 'kind' | 'chargedCents' | 'rows'>): string {
  return `${FEE_KIND_COPY[k.kind].label} — ${formatCents(k.chargedCents)} (${charges(k.rows.length)})`;
}

/** The given-back heading line. */
export function feesGivenBackLine(f: Pick<BankFees, 'givenBack' | 'givenBackCents'>): string {
  const n = f.givenBack.length;
  return `Came back — ${formatCents(f.givenBackCents)} (${n === 1 ? '1 refund or reversal' : `${n} refunds or reversals`})`;
}

/**
 * What the figures leave out, by amount, when there is any. `null` when nothing was left out —
 * the rule note already states the rule; this line states the money.
 */
export function feesLeftOutLine(f: Pick<BankFees, 'leftOut'>): string | null {
  const { interestCents, interestCount, annualCents, annualCount } = f.leftOut;
  const parts: string[] = [];
  if (interestCount > 0) {
    parts.push(`${formatCents(interestCents)} of interest and finance charges (${charges(interestCount)})`);
  }
  if (annualCount > 0) {
    parts.push(`${formatCents(annualCents)} of annual card fees (${charges(annualCount)})`);
  }
  if (parts.length === 0) return null;
  // Each reason only beside the money it explains.
  const why =
    interestCount > 0 && annualCount > 0
      ? 'Interest is the cost of a balance carried from month to month, and an annual fee is the price of keeping a card.'
      : interestCount > 0
        ? 'Interest is the cost of a balance carried from month to month.'
        : 'An annual fee is the price of keeping a card.';
  return `Not counted here: ${parts.join(' and ')}. ${why}`;
}

/** The disclosure that holds the rule. */
export const BANK_FEES_RULE_SUMMARY = 'How these are counted';

/** The rule, one tap under the figures. A statement about this card, never about the reader. */
export const BANK_FEES_RULE =
  "Counts money out filed under Fees & Charges, ATM Fee or Late Fee in the 12 months to today, less fees given back: money in on those rows, or money in filed elsewhere whose bank text says a fee was refunded, reversed or waived. A fee filed under another category is not counted, and neither is a row you've excluded. Interest and finance charges and annual card fees are left out.";
