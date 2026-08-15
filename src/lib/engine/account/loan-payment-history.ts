/**
 * H.9 — payment history on a LOAN/MORTGAGE row.
 *
 * Those accounts send balances, not transactions. The payments that produced
 * the balance post against the checking/savings/card account they left. This
 * module does not invent the link: the reader names the payee, and the rows
 * are the register's own merchant axis (`merchantNameEquals`) over
 * register-basis rows the server already kept. Null link = ASK, never a
 * guessed history (an inferred name match would file the wrong debt).
 */
import { LOAN_ACCOUNT_TYPES } from '@/lib/engine/categorize/transfers';
import { merchantNameEquals } from '@/lib/engine/transactions/query';

export function isLoanPaymentHistoryAccount(type: string): boolean {
  return LOAN_ACCOUNT_TYPES.has(type);
}

export interface LoanPaymentHistoryRow {
  id: string;
  date: string;
  accountId: string;
  accountName: string;
  amountCents: number;
  isTransfer: boolean;
  merchantName: string;
}

export type PaymentMerchantPanelState =
  | { kind: 'hidden' }
  | { kind: 'ask' }
  | { kind: 'linked'; merchantId: string; canonical: string; payments: readonly LoanPaymentHistoryRow[] }
  | { kind: 'linked-empty'; merchantId: string; canonical: string };

export function paymentMerchantPanelState(input: {
  accountType: string;
  /** Demo (and any other fenced reader) cannot write the link. An unlinked
   *  loan then has nothing to ask — showing ASK with no control is a dead end. */
  canSet: boolean;
  merchant: { id: string; canonical: string } | null;
  payments: readonly LoanPaymentHistoryRow[];
}): PaymentMerchantPanelState {
  if (!isLoanPaymentHistoryAccount(input.accountType)) return { kind: 'hidden' };
  if (input.merchant === null) return input.canSet ? { kind: 'ask' } : { kind: 'hidden' };
  const payments = selectLoanPaymentHistoryRows(input.payments, input.merchant.canonical);
  if (payments.length === 0) {
    return { kind: 'linked-empty', merchantId: input.merchant.id, canonical: input.merchant.canonical };
  }
  return {
    kind: 'linked',
    merchantId: input.merchant.id,
    canonical: input.merchant.canonical,
    payments,
  };
}

/** Newest first, then id desc — the register's own order. */
export function selectLoanPaymentHistoryRows(
  rows: readonly LoanPaymentHistoryRow[],
  canonical: string,
): LoanPaymentHistoryRow[] {
  return rows
    .filter((r) => merchantNameEquals(r.merchantName, canonical))
    .sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));
}

export function loanPaymentHistoryAskCopy(): string {
  return (
    "Which payee's charges pay this down? Choose the name as it appears in your " +
    'activity — Aimplifi will not guess.'
  );
}

export function loanPaymentHistoryNoCandidatesCopy(): string {
  return (
    'Aimplifi lists payees from your checking, savings, and card activity. ' +
    'Add a charge there first, then choose it here.'
  );
}

export function loanPaymentHistoryEmptyCopy(canonical: string): string {
  return (
    `No activity from ${canonical} on your checking, savings, or card accounts yet. ` +
    'That is not a claim that nothing was paid — only that nothing under this payee ' +
    'is in the activity list.'
  );
}

export function loanPaymentHistoryHeading(canonical: string): string {
  return `Activity from ${canonical}`;
}

export function loanPaymentHistoryRegisterLinkLabel(canonical: string): string {
  return `Every ${canonical} in activity`;
}

export const PAYMENT_MERCHANT_ACCOUNT_NOT_ELIGIBLE =
  'Only a loan or mortgage can track payments this way.';
export const PAYMENT_MERCHANT_NOT_IN_ACTIVITY =
  'That payee is not in your checking, savings, or card activity.';
