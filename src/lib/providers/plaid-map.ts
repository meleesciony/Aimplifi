/**
 * Pure mappers from Plaid API shapes into Pulse's data model. No I/O, no
 * network — the only place Plaid's float dollars and outflow-positive sign
 * convention are translated to Pulse's integer cents / outflow-negative
 * convention. Unit-tested with realistic Plaid fixtures: this is the part of
 * the integration whose bugs would silently corrupt the ledger, so it is the
 * part that must be tested even though the live network calls cannot be.
 *
 * Sign convention (Plaid docs): `amount` is POSITIVE when money leaves the
 * account (a debit/purchase) and NEGATIVE when money enters (a credit). Pulse
 * stores outflow NEGATIVE, inflow POSITIVE — so we NEGATE on ingest.
 *
 * Floats: Plaid returns amounts as JSON numbers (dollars). This module is the
 * single boundary where a float becomes cents; we round half-away-from-zero
 * immediately and never do float math downstream (src/lib/money.ts rules).
 */
import { type ISODate, isoDate } from '@/lib/dates';
import { type Cents, cents, roundHalfAwayFromZero } from '@/lib/money';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { type CategorizedTxn, type RuleLike, categorize } from '@/lib/engine/categorize/pipeline';

export type PulseAccountType = 'CHECKING' | 'SAVINGS' | 'CREDIT' | 'INVESTMENT' | 'LOAN';

/** Dollars (Plaid, outflow-positive) → signed cents (Pulse, outflow-negative). */
export function plaidAmountToCents(amountDollars: number): Cents {
  if (!Number.isFinite(amountDollars)) {
    throw new Error(`plaidAmountToCents: non-finite amount ${amountDollars}`);
  }
  // Negate to flip Plaid's outflow-positive into Pulse's outflow-negative.
  // `|| 0` collapses the -0 the negation produces for a zero amount.
  return cents(-roundHalfAwayFromZero(amountDollars * 100) || 0);
}

/** Dollars → positive cents, for balances/statement figures (no sign flip). */
export function plaidDollarsToPositiveCents(amountDollars: number): Cents {
  if (!Number.isFinite(amountDollars)) {
    throw new Error(`plaidDollarsToPositiveCents: non-finite amount ${amountDollars}`);
  }
  return roundHalfAwayFromZero(Math.abs(amountDollars) * 100);
}

/**
 * Plaid account `type`/`subtype` → Pulse account type. Throws on an unrecognized
 * top-level type rather than guessing: misclassifying a liability as an asset
 * would silently invert its net-worth sign, so failing loud is the safe choice.
 */
export function mapPlaidAccountType(type: string, subtype: string | null): PulseAccountType {
  switch (type) {
    case 'depository':
      return subtype === 'savings' || subtype === 'cd' || subtype === 'money market'
        ? 'SAVINGS'
        : 'CHECKING';
    case 'credit':
      return 'CREDIT';
    case 'loan':
      return 'LOAN';
    case 'investment':
    case 'brokerage':
      return 'INVESTMENT';
    default:
      throw new Error(`mapPlaidAccountType: unrecognized Plaid account type "${type}"`);
  }
}

export interface PlaidAccount {
  account_id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  balances: {
    current: number | null;
    available: number | null;
    limit: number | null;
  };
}

export interface MappedAccount {
  providerRef: string;
  name: string;
  type: PulseAccountType;
  mask: string | null;
  currentBalanceCents: number;
  availableBalanceCents: number | null;
  creditLimitCents: number | null;
}

export function mapPlaidAccount(account: PlaidAccount): MappedAccount {
  return {
    providerRef: account.account_id,
    name: account.name,
    type: mapPlaidAccountType(account.type, account.subtype),
    mask: account.mask,
    // Balances are stored POSITIVE; the account `type` decides asset vs
    // liability in net worth (a credit card's current balance is what's owed).
    currentBalanceCents: plaidDollarsToPositiveCents(account.balances.current ?? 0),
    availableBalanceCents:
      account.balances.available == null
        ? null
        : plaidDollarsToPositiveCents(account.balances.available),
    creditLimitCents:
      account.balances.limit == null ? null : plaidDollarsToPositiveCents(account.balances.limit),
  };
}

export interface PlaidCreditLiability {
  account_id: string;
  last_statement_balance: number | null;
  last_statement_issue_date: string | null; // YYYY-MM-DD
  minimum_payment_amount: number | null;
  next_payment_due_date: string | null; // YYYY-MM-DD
}

export interface MappedStatement {
  accountId: string;
  cycleEnd: ISODate;
  dueDate: ISODate;
  statementBalanceCents: number;
  minimumPaymentCents: number;
  isEstimated: false;
}

/**
 * Plaid `/liabilities/get` credit object → a Statement. Returns null when Plaid
 * hasn't reported a generated statement yet (missing balance/dates) — the
 * cash-needed assembler then falls back to its estimate path, exactly as for a
 * card whose statement hasn't closed.
 */
export function mapPlaidLiabilityToStatement(
  credit: PlaidCreditLiability,
  accountId: string,
): MappedStatement | null {
  const { last_statement_balance, last_statement_issue_date, next_payment_due_date } = credit;
  if (
    last_statement_balance == null ||
    last_statement_issue_date == null ||
    next_payment_due_date == null
  ) {
    return null;
  }
  return {
    accountId,
    cycleEnd: isoDate(last_statement_issue_date),
    dueDate: isoDate(next_payment_due_date),
    statementBalanceCents: plaidDollarsToPositiveCents(last_statement_balance),
    minimumPaymentCents: plaidDollarsToPositiveCents(credit.minimum_payment_amount ?? 0),
    isEstimated: false,
  };
}

export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  date: string; // YYYY-MM-DD (authorized/posted date)
  amount: number; // dollars, outflow-positive
  name: string; // raw descriptor
  merchant_name?: string | null;
  pending: boolean;
}

export interface IngestedTransaction {
  providerRef: string;
  accountId: string;
  date: ISODate;
  amountCents: number; // signed (Pulse convention)
  rawDescriptor: string;
  merchantCanonical: string;
  categoryId: string;
  confidenceBps: number;
  needsReview: boolean;
  isTransfer: boolean;
  status: 'PENDING' | 'POSTED';
}

/**
 * Map ONE Plaid transaction into a categorized, persist-ready row. Runs the
 * same normalize → rules → categorize arm every ingest source must use
 * (DECISIONS #22), so a Plaid-sourced charge is filed exactly like a
 * demo-seeded one. Cross-account transfer PAIRING and recurring re-detection
 * are batch steps the caller runs after all rows are inserted.
 */
export function prepareIngestedTransaction(
  txn: PlaidTransaction,
  accountId: string,
  rules: readonly RuleLike[] = [],
): IngestedTransaction {
  const rawDescriptor = txn.name?.trim() || txn.merchant_name?.trim() || 'Unknown Merchant';
  const amountCents = plaidAmountToCents(txn.amount);
  const date = isoDate(txn.date);
  const merchant = normalizeMerchant(rawDescriptor);
  const result: CategorizedTxn = categorize(
    { rawDescriptor, amountCents, date, accountId },
    rules,
  );
  return {
    providerRef: txn.transaction_id,
    accountId,
    date,
    amountCents,
    rawDescriptor,
    merchantCanonical: merchant.canonical,
    categoryId: result.categoryId,
    confidenceBps: result.confidenceBps,
    needsReview: result.needsReview,
    isTransfer: result.source === 'transfer',
    status: txn.pending ? 'PENDING' : 'POSTED',
  };
}
