/**
 * Hostile-critic probe (K.7 review): can the split suppress a payment that NO
 * obligation in the projection carries — the #400-forbidden direction?
 *
 * Shape: TWO student loans share ONE merchant canonical ('Nelnet'), both paid
 * from checking at $315.00/mo. Loan1 is dateable (obligation in the list);
 * loan2 is UNDATABLE (no obligation — the common Plaid shape per
 * obligations.ts: "a loan reported with a payment but no next_payment_due_date
 * is what Plaid returns for most issuers").
 *
 * C.25 (loan-payment-flows.ts:270-284, P1-A): a row is excluded only when EVERY
 * account it paired with is eligible. The loan2 payment paired with loan2's
 * inflows (ineligible) -> C.25 KEEPS it in the flows.
 * The split (duplicate-projection.ts): one fact at (canonical|amount) suppresses
 * EVERY row at (canonical|amount) without asking which loan it paid.
 *
 * 'Nelnet' is chosen because it ROUND-TRIPS through normalizeMerchant (the
 * generic-rule canonical = cleaned form), isolating the attribution divergence
 * from the CarMax spelling mismatch.
 */
import { loanPaymentFlowExclusions } from '../../src/lib/engine/categorize/loan-payment-flows';
import { splitLoanCarriedScheduled } from '../../src/lib/engine/loans/duplicate-projection';
import { normalizeMerchant } from '../../src/lib/engine/categorize/normalize';

const RAW = 'NELNET';
console.log('raw descriptor canonical:', normalizeMerchant(RAW).canonical, '(round-trips:', normalizeMerchant(normalizeMerchant(RAW).canonical).canonical === normalizeMerchant(RAW).canonical, ')');

// Two loans, one canonical. Loan1 dateable, loan2 undatable (no dueDayOfMonth).
const OBLIGATIONS = [{ accountId: 'loan1', paymentCents: 31500 }];
// Two distinct months of +/-3-day pairs against loan1's inflows, two against loan2's.
const ROWS = [
  { id: 'r1', accountId: 'chk', date: '2026-03-05', amountCents: -31500, rawDescriptor: 'NELNET', status: 'POSTED' },
  { id: 'r2', accountId: 'chk', date: '2026-04-05', amountCents: -31500, rawDescriptor: 'NELNET', status: 'POSTED' },
  { id: 'r3', accountId: 'chk', date: '2026-03-20', amountCents: -31500, rawDescriptor: 'NELNET', status: 'POSTED' },
  { id: 'r4', accountId: 'chk', date: '2026-04-20', amountCents: -31500, rawDescriptor: 'NELNET', status: 'POSTED' },
];
// Inflows: loan1 receives the payment on the 5th; loan2 (undatable) on the 20th.
const INFLOWS = [
  { id: 'i1', accountId: 'loan1', date: '2026-03-05', amountCents: 31500 },
  { id: 'i2', accountId: 'loan1', date: '2026-04-05', amountCents: 31500 },
  { id: 'i3', accountId: 'loan2', date: '2026-03-20', amountCents: 31500 },
  { id: 'i4', accountId: 'loan2', date: '2026-04-20', amountCents: 31500 },
];
const accountTypeById = new Map([
  ['chk', 'CHECKING'],
  ['loan1', 'LOAN'],
  ['loan2', 'LOAN'],
]);

const c25 = loanPaymentFlowExclusions({
  rows: ROWS,
  loanInflows: INFLOWS,
  accountTypeById,
  obligations: OBLIGATIONS,
});
console.log('C.25 excludeIds      :', [...c25.excludeIds]);
console.log('C.25 facts           :', JSON.stringify(c25.excluded));

// The two scheduled rows the detector would persist under the shared canonical.
const scheduled = [
  { description: 'Nelnet', amountCents: -31500, nextDate: '2026-05-05' },
  { description: 'Nelnet', amountCents: -31500, nextDate: '2026-05-20' },
];
const split = splitLoanCarriedScheduled({
  scheduled,
  obligations: OBLIGATIONS,
  carried: c25.excluded,
});
console.log('split suppressed     :', split.suppressed.length, 'of', scheduled.length, 'rows');
console.log('  (both suppressed:', split.suppressed.length === 2, ')');
console.log('  obligations carrying them in this projection: 1 (loan1 31500) — loan2 has NO obligation');
console.log('  => the undatable loan2 payment leaves the projection entirely:', split.suppressed.length === 2 ? 'YES (silent deletion)' : 'no');
