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
import { estimateMinimumPayment } from '@/lib/engine/cash-needed/engine';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { type CategorizedTxn, type RuleLike, categorize } from '@/lib/engine/categorize/pipeline';
import { resolvePlaidCurrency } from './currency';

export type PulseAccountType = 'CHECKING' | 'SAVINGS' | 'CREDIT' | 'INVESTMENT' | 'LOAN' | 'MORTGAGE';

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
      // A mortgage is a distinct Pulse type (excluded from the debt snowball by the
      // Ramsey BS6 convention, like a manual MORTGAGE); every other loan subtype
      // (student, auto, personal, …) is a generic LOAN. Both are liabilities, so the
      // net-worth sign lands the same either way.
      return subtype === 'mortgage' ? 'MORTGAGE' : 'LOAN';
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
    iso_currency_code?: string | null; // ISO-4217 (e.g. 'USD'); nullable per Plaid docs
    unofficial_currency_code?: string | null; // crypto / unofficial currencies
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
  /** Canonical currency code (e.g. 'USD'), or null when Plaid reports neither code. Non-USD
   *  accounts are withheld from net worth at the read boundary (DECISIONS #135). */
  currency: string | null;
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
    // Account currency (ISO preferred over the unofficial/crypto code). The app does no FX; a
    // non-USD account is withheld from net worth at the read boundary (DECISIONS #135).
    currency: resolvePlaidCurrency(
      account.balances.iso_currency_code,
      account.balances.unofficial_currency_code,
    ),
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
 *
 * Two correctness rails (DECISIONS #132, audit #127 P2s):
 *  - `last_statement_balance` keeps Plaid's SIGN (`plaidSignedDollarsToCents`).
 *    A negative value is a statement CREDIT (the holder overpaid / has a credit);
 *    abs()-ing it would invent an amount owed. Signed, the cash-needed engine
 *    floors `remainingDue`/`minimumDue` to $0 — a credit correctly owes nothing.
 *  - A null OR zero `minimum_payment_amount` is NOT forced to $0 (which understates
 *    the minimum-path cash needed below the engine's own no-statement estimate).
 *    When no usable (>0) minimum is reported on a positive balance, mirror the
 *    engine's exact estimate (`estimateMinimumPayment` = max $35 / 1% of balance);
 *    a credit/zero balance owes no minimum. The statement's balance + dates are
 *    still real, so it stays on the precise (non-estimated) path — only the minimum
 *    is a conservative estimate when the issuer didn't report a usable one.
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
  const statementBalanceCents = plaidSignedDollarsToCents(last_statement_balance);
  // A "usable" minimum is a POSITIVE reported amount. A reported 0 — or a sub-cent
  // value that rounds to 0¢ — on a positive balance is treated the SAME as a missing
  // one (both understate the minimum-path cash needed) and falls through to the
  // engine's estimate. A credit/zero balance owes no minimum.
  const reportedMinCents =
    credit.minimum_payment_amount != null
      ? plaidDollarsToPositiveCents(credit.minimum_payment_amount)
      : null;
  const minimumPaymentCents =
    reportedMinCents != null && reportedMinCents > 0
      ? reportedMinCents
      : statementBalanceCents > 0
        ? estimateMinimumPayment(statementBalanceCents)
        : cents(0);
  return {
    accountId,
    cycleEnd: isoDate(last_statement_issue_date),
    dueDate: isoDate(next_payment_due_date),
    statementBalanceCents,
    minimumPaymentCents,
    isEstimated: false,
  };
}

/**
 * Plaid `/liabilities/get` `mortgage[]` (the fields Pulse models). The current
 * outstanding balance is NOT here — it comes from the linked account's
 * balances.current (already handled by mapPlaidAccount); origination_principal_amount
 * is the ORIGINAL principal, not the current balance, so it is deliberately ignored.
 */
export interface PlaidMortgageLiability {
  account_id: string;
  next_monthly_payment: number | null;
  next_payment_due_date: string | null; // YYYY-MM-DD
  interest_rate?: { percentage: number | null; type: string | null } | null;
}

/** Plaid `/liabilities/get` `student[]`. NOTE: account_id is NULLABLE for student loans. */
export interface PlaidStudentLiability {
  account_id: string | null;
  minimum_payment_amount: number | null;
  next_payment_due_date: string | null; // YYYY-MM-DD
  interest_rate_percentage: number | null;
}

/** Loan-account fields a mortgage/student liability can populate. null = not reported (PRESERVE existing). */
export interface MappedLoanFields {
  aprBps: number | null;
  minimumPaymentCents: number | null;
  dueDayOfMonth: number | null;
}

// Postgres 32-bit Int ceiling — minimumPaymentCents/aprBps/dueDayOfMonth are all Int
// columns; a value past this overflows in production (DECISIONS #129). Bounding here keeps
// these mappers truly non-throwing (no cents() safe-integer assert) and out of the column's range.
const MAX_DB_INT = 2_147_483_647;

// Interest rate percent (e.g. 6.49) → integer bps (649). Rounds FIRST, then range-checks
// `0 < bps <= MAX_DB_INT` — so a sub-bps positive rounds to 0 → null (preserve, never write a
// fabricated 0 over a real rate), and an absurd value → null (never overflow). Mirrors the
// statement path's post-rounding `> 0` guard and pickPlaidAprBps's integer-rounded ×100.
function loanRateToBps(pct: number | null | undefined): number | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  const bps = Math.round(pct * 100);
  return bps > 0 && bps <= MAX_DB_INT ? bps : null;
}

// Dollars → positive integer cents, or null when not usable. Rounds FIRST, then range-checks
// `0 < cents <= MAX_DB_INT`. Non-throwing (unlike plaidDollarsToPositiveCents → cents()):
// liability sync is best-effort, so a sub-cent amount (rounds to 0), an over-ceiling amount, or
// any non-finite value all return null = preserve-existing — never a fabricated 0, never a throw
// that would abort the item's whole liability sweep (incl. its credit cards).
function loanPaymentToCents(amount: number | null | undefined): number | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  // Bound the magnitude BEFORE rounding: roundHalfAwayFromZero wraps cents(), which throws
  // on a non-safe-integer — so an over-ceiling amount must short-circuit to null here, not reach it.
  if (Math.abs(amount) * 100 > MAX_DB_INT) return null;
  const c = roundHalfAwayFromZero(Math.abs(amount) * 100);
  return c > 0 ? c : null; // a sub-cent amount rounds to 0 → null (preserve, never write a 0)
}

// Day-of-month (1..31) from a YYYY-MM-DD due date, or null when absent/malformed. Uses a
// regex rather than isoDate() so a bad string yields null (skip) instead of throwing.
function dueDayFromDate(date: string | null | undefined): number | null {
  if (date == null) return null;
  const m = /^\d{4}-\d{2}-(\d{2})$/.exec(date);
  if (!m) return null;
  const day = Number(m[1]);
  return day >= 1 && day <= 31 ? day : null;
}

/**
 * Plaid mortgage → the Pulse loan Account's modeled fields. Each field is null when
 * Plaid didn't report a usable value, so the caller PRESERVES the existing stored value
 * (never overwrites a real rate/payment/due-day with a blank — the #130 preserve-on-null
 * discipline). The fixed payment + due day then feed the loan-obligation engine (calendar
 * + reminders), and the rate feeds the debt-payoff planner.
 */
export function mapPlaidMortgageToLoanFields(m: PlaidMortgageLiability): MappedLoanFields {
  return {
    aprBps: loanRateToBps(m.interest_rate?.percentage),
    minimumPaymentCents: loanPaymentToCents(m.next_monthly_payment),
    dueDayOfMonth: dueDayFromDate(m.next_payment_due_date),
  };
}

/** Plaid student loan → the Pulse loan Account's modeled fields (same preserve-on-null rule). */
export function mapPlaidStudentToLoanFields(s: PlaidStudentLiability): MappedLoanFields {
  return {
    aprBps: loanRateToBps(s.interest_rate_percentage),
    minimumPaymentCents: loanPaymentToCents(s.minimum_payment_amount),
    dueDayOfMonth: dueDayFromDate(s.next_payment_due_date),
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
