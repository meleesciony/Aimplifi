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

/** Dollars → positive cents, for figures Plaid guarantees non-negative (limit/available). */
export function plaidDollarsToPositiveCents(amountDollars: number): Cents {
  if (!Number.isFinite(amountDollars)) {
    throw new Error(`plaidDollarsToPositiveCents: non-finite amount ${amountDollars}`);
  }
  return roundHalfAwayFromZero(Math.abs(amountDollars) * 100);
}

/**
 * Dollars → SIGNED cents, preserving Plaid's sign. Plaid reports a NEGATIVE
 * `balances.current` for an overpaid credit card (the lender owes the holder) or
 * an overdrawn deposit account. Used for `current` so the type-based net-worth
 * sign (isLiabilityType ? -bal : +bal) lands correctly instead of being inverted
 * by an abs(). `|| 0` collapses the -0 a zero amount would otherwise produce.
 */
export function plaidSignedDollarsToCents(amountDollars: number): Cents {
  if (!Number.isFinite(amountDollars)) {
    throw new Error(`plaidSignedDollarsToCents: non-finite amount ${amountDollars}`);
  }
  return cents(roundHalfAwayFromZero(amountDollars * 100) || 0);
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
  // null = Plaid reported a null `current` this fetch (balance UNKNOWN, not $0). The caller
  // PRESERVES the last-known-good stored balance instead of zeroing net worth (DECISIONS #130).
  currentBalanceCents: number | null;
  availableBalanceCents: number | null;
  creditLimitCents: number | null;
}

export function mapPlaidAccount(account: PlaidAccount): MappedAccount {
  return {
    providerRef: account.account_id,
    name: account.name,
    type: mapPlaidAccountType(account.type, account.subtype),
    mask: account.mask,
    // `current` keeps Plaid's sign (usually positive; negative for an overpaid card or
    // overdrawn account). The account `type` then decides its net-worth sign. A NULL
    // `current` maps to null — "unknown this fetch", NOT 0: an account's balance always
    // exists, so the caller preserves the last-known-good value rather than cratering net
    // worth with a silent $0 (DECISIONS #130, the audit-#6 follow-up). available/limit stay
    // non-negative and may legitimately be null.
    currentBalanceCents:
      account.balances.current == null ? null : plaidSignedDollarsToCents(account.balances.current),
    availableBalanceCents:
      account.balances.available == null
        ? null
        : plaidDollarsToPositiveCents(account.balances.available),
    creditLimitCents:
      account.balances.limit == null ? null : plaidDollarsToPositiveCents(account.balances.limit),
  };
}

export interface PlaidApr {
  apr_percentage: number; // e.g. 24.99 (percent, not bps)
  apr_type: string; // 'purchase_apr' | 'cash_apr' | 'balance_transfer_apr' | 'special' | ...
  balance_subject_to_apr: number | null;
  interest_charge_amount: number | null;
}

export interface PlaidCreditLiability {
  account_id: string;
  last_statement_balance: number | null;
  last_statement_issue_date: string | null; // YYYY-MM-DD
  minimum_payment_amount: number | null;
  next_payment_due_date: string | null; // YYYY-MM-DD
  aprs?: PlaidApr[] | null;
}

/**
 * Pick the representative APR (basis points) for a Plaid credit liability: the PURCHASE apr —
 * the rate that accrues on a carried purchase balance, which the debt-payoff + cash-needed
 * engines model — falling back to the highest non-`special` (promo) apr, else the highest of
 * any. Returns null when no usable apr is reported, so the account keeps its existing/blank
 * rate rather than being zeroed. apr_percentage (24.99) → bps (2499) via integer-rounded ×100,
 * so no float drift reaches the rate. WITHOUT this, every live Plaid card carries aprBps null/0
 * and its interest is computed as ZERO (audit #126-followup).
 */
export function pickPlaidAprBps(credit: { aprs?: PlaidApr[] | null }): number | null {
  const aprs = (credit.aprs ?? []).filter(
    (a): a is PlaidApr => !!a && Number.isFinite(a.apr_percentage) && a.apr_percentage > 0,
  );
  if (aprs.length === 0) return null;
  const byDescApr = (x: PlaidApr, y: PlaidApr) => y.apr_percentage - x.apr_percentage;
  const chosen =
    aprs.find((a) => a.apr_type === 'purchase_apr') ??
    [...aprs].filter((a) => a.apr_type !== 'special').sort(byDescApr)[0] ??
    [...aprs].sort(byDescApr)[0];
  return Math.round(chosen.apr_percentage * 100);
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
