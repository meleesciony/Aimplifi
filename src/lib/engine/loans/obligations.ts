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
  /** YYYY-MM-DD the bank stopped sharing this loan (Account.feedDroppedAt), else null/absent.
   *  Optional on the INPUT because this interface is a structural subset of an Account row and
   *  older fixtures omit it, exactly as `minimumPaymentCents` is; REQUIRED on the output. */
  feedDroppedAt?: string | null;
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
  /**
   * YYYY-MM-DD the bank stopped sharing this loan, else null (TASKS L.18). REQUIRED for the same
   * reason it is on `CardObligation`: the reminder email and the weekly digest print this payment
   * beside a card's, and a frozen loan's `minimumPaymentCents` and due day are exactly as stale as
   * a frozen card's statement — the bank stopped confirming both on the same day.
   */
  frozenSince: string | null;
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
      frozenSince: a.feedDroppedAt ?? null,
    });
  }
  return out.sort(
    (x, y) =>
      compareDates(x.effectiveDueDate, y.effectiveDueDate) || x.accountName.localeCompare(y.accountName),
  );
}

/**
 * A frozen loan that `selectLoanObligations` drops entirely, because it carries no dated payment.
 *
 * Emitted so an ABSENCE can still be disclosed (TASKS L.20). `frozenSince` is non-null by
 * construction — the whole point of the list is the loans whose gap cannot close on its own.
 */
export interface UndatableFrozenLoan {
  accountId: string;
  accountName: string;
  /** YYYY-MM-DD the bank stopped sharing this loan. Never null here. */
  frozenSince: string;
  /**
   * WHICH field is absent (L.20 critic cycle, finding B-2).
   *
   * The first cut carried no such flag and the sentence said "we have no due date or payment
   * amount for it" about every row — false whenever only one of the two is missing, which is the
   * COMMON shape: a loan reported with a payment but no `next_payment_due_date` is what Plaid
   * returns for most issuers, and the app displays that payment on /accounts while the sentence
   * denied holding it. A disclosure whose whole job is precision about what we do and do not hold
   * may not be wrong about which one it is.
   */
  missing: 'due-day' | 'payment' | 'both';
}

/**
 * The frozen LOAN/MORTGAGE accounts that produce NO obligation above, and so appear in no dues
 * list, no reminder and no all-clear (TASKS L.20).
 *
 * `selectLoanObligations` refuses to date a loan without both a positive payment and a due day,
 * and refusing is right — the engine never fabricates a date. But the caller then had nothing to
 * carry the refusal out with, so "You're all caught up" and "a clear week ahead" were computed
 * over a list this loan could never enter. That is the L.19 thesis in its worst form: L.19 taught
 * four surfaces to qualify an all-clear using the frozen rows they could see, and this is the row
 * none of them could. `unknownDueDateCards` is the exact analogue on the card side.
 *
 * FROZEN ONLY, deliberately. A LIVE loan missing a due day is also absent from every list, but its
 * gap is a different claim with a different remedy (the bank is still talking to us; the field may
 * arrive on its own, or was never offered), and inventing one sentence for both would name the
 * wrong mechanism for one of them — the mistake `FrozenNothingDueRow.kind` exists to prevent. That
 * sibling gap is recorded in docs/STATUS.md rather than silently folded in here.
 *
 * No `today`, no holidays: nothing here is dated, so there is nothing to compute a date from.
 */
export function selectUndatableFrozenLoans(params: {
  accounts: readonly LoanAccountLike[];
}): UndatableFrozenLoan[] {
  const out: UndatableFrozenLoan[] = [];
  for (const a of params.accounts) {
    if (!LOAN_TYPES.has(a.type)) continue;
    const frozenSince = a.feedDroppedAt ?? null;
    if (frozenSince == null) continue;
    const payment = a.minimumPaymentCents ?? null;
    // The exact negation of the two guards above, so the two lists stay disjoint by construction:
    // a loan is here precisely when it is not there. Written as one condition rather than two
    // `continue`s so that staying in step with `selectLoanObligations` is a single edit.
    const hasPayment = payment != null && payment > 0;
    const hasDueDay = a.dueDayOfMonth != null;
    const datable = hasPayment && hasDueDay;
    if (datable) continue;
    out.push({
      accountId: a.id,
      accountName: a.name,
      frozenSince,
      missing: hasPayment ? 'due-day' : hasDueDay ? 'payment' : 'both',
    });
  }
  return out.sort((x, y) => x.accountName.localeCompare(y.accountName));
}
