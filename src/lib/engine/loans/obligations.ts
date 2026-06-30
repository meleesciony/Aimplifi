/**
 * Loan/mortgage payment obligations (#134) — a pure, separate surface from the
 * Cash-Needed Engine. A credit card's "cash needed" is a variable statement
 * balance; a LOAN/MORTGAGE is a FIXED monthly payment on a fixed due day, so it
 * does NOT belong in the card-framed cash-needed headline (owner's product call:
 * loans surface on the calendar + reminders, NOT the dollar headline). This
 * module derives the next dated payment from the loan account's stored fields
 * (minimumPaymentCents = the fixed monthly payment; dueDayOfMonth = the due day —
 * for Plaid loans both come from /liabilities/get's mortgage[]/student[]).
 *
 * Single occurrence per loan (the next payment on/after today), mirroring how a
 * card-due is one event per statement: the calendar shows it in its due month and
 * reminders pick it up. No I/O; money is integer cents; dates via dates.ts.
 */
import { type Cents, cents } from '@/lib/money';
import { type ISODate, compareDates, nextDayOfMonth, priorBusinessDayIfNonBusiness } from '@/lib/dates';

export type LoanAccountType = 'LOAN' | 'MORTGAGE';

/** The loan-account fields this engine reads (a structural subset of an Account row). */
export interface LoanAccountLike {
  id: string;
  name: string;
  type: string;
  /** Fixed monthly payment (cents). Plaid: mortgage next_monthly_payment / student minimum_payment_amount. */
  minimumPaymentCents?: number | null;
  /** Day-of-month the payment is due. Plaid: day component of next_payment_due_date. */
  dueDayOfMonth: number | null;
}

export interface LoanObligation {
  accountId: string;
  accountName: string;
  accountType: LoanAccountType;
  /** Raw next monthly due date (the dueDayOfMonth occurrence on/after today). */
  dueDate: ISODate;
  /** Business-day adjusted (weekend/holiday → prior business day), never before today. */
  effectiveDueDate: ISODate;
  /** The fixed monthly payment that must be present by the effective due date. */
  paymentCents: Cents;
  /** Always false today (the payment is issuer-reported, not estimated) — kept for a
   *  uniform shape with card obligations when both feed the reminder selector. */
  isEstimated: boolean;
}

const LOAN_TYPES: ReadonlySet<string> = new Set(['LOAN', 'MORTGAGE']);

/**
 * The next dated payment for every LOAN/MORTGAGE account that carries BOTH a
 * positive fixed monthly payment AND a due day. Accounts missing either (or of any
 * other type) produce nothing — there is no payment/date to surface, and the engine
 * never fabricates one. Sorted by effective due date, then name.
 */
export function selectLoanObligations(params: {
  accounts: readonly LoanAccountLike[];
  today: ISODate;
  holidays: readonly ISODate[];
}): LoanObligation[] {
  const { accounts, today, holidays } = params;
  const out: LoanObligation[] = [];
  for (const a of accounts) {
    if (!LOAN_TYPES.has(a.type)) continue;
    const payment = a.minimumPaymentCents ?? null;
    if (payment == null || payment <= 0) continue; // no modeled payment → nothing to surface
    if (a.dueDayOfMonth == null) continue; // no due day → can't date it
    const dueDate = nextDayOfMonth(a.dueDayOfMonth, today);
    let effectiveDueDate = priorBusinessDayIfNonBusiness(dueDate, holidays);
    if (compareDates(effectiveDueDate, today) < 0) effectiveDueDate = today;
    out.push({
      accountId: a.id,
      accountName: a.name,
      accountType: a.type as LoanAccountType,
      dueDate,
      effectiveDueDate,
      paymentCents: cents(payment),
      isEstimated: false,
    });
  }
  return out.sort(
    (x, y) =>
      compareDates(x.effectiveDueDate, y.effectiveDueDate) || x.accountName.localeCompare(y.accountName),
  );
}
