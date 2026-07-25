import { describe, it, expect } from 'vitest';
import { holidayTable, isoDate } from '@/lib/dates';
import { selectLoanObligations, type LoanAccountLike } from '@/lib/engine/loans/obligations';

const HOL = holidayTable(2025, 2027);
const TODAY = isoDate('2026-06-10');

function acct(over: Partial<LoanAccountLike>): LoanAccountLike {
  return { id: 'a', name: 'Acct', type: 'LOAN', minimumPaymentCents: 38500, dueDayOfMonth: 5, ...over };
}

describe('selectLoanObligations', () => {
  it('rolls the due day to next month and walks back over a weekend AND an observed holiday', () => {
    // dueDay 5 from 2026-06-10 → 2026-07-05 (Sunday). Walk-back: Sun → Sat → Fri 2026-07-03,
    // which is the OBSERVED Independence Day (Jul 4 falls on Saturday) → Thursday 2026-07-02.
    const obs = selectLoanObligations({
      accounts: [acct({ id: 'auto', name: 'Auto Loan' })],
      today: TODAY,
      holidays: HOL,
    });
    expect(obs).toEqual([
      {
        accountId: 'auto',
        accountName: 'Auto Loan',
        accountType: 'LOAN',
        dueDate: '2026-07-05',
        effectiveDueDate: '2026-07-02',
        paymentCents: 38500,
        isEstimated: false,
        frozenSince: null,
      },
    ]);
  });

  it('includes MORTGAGE and leaves a plain business-day due date unchanged', () => {
    const [o] = selectLoanObligations({
      accounts: [
        acct({
          id: 'mtg',
          name: 'Home Mortgage',
          type: 'MORTGAGE',
          dueDayOfMonth: 15,
          minimumPaymentCents: 210000,
        }),
      ],
      today: TODAY,
      holidays: HOL,
    });
    expect(o.accountType).toBe('MORTGAGE');
    expect(o.dueDate).toBe('2026-06-15'); // a Monday
    expect(o.effectiveDueDate).toBe('2026-06-15');
    expect(o.paymentCents).toBe(210000);
  });

  it('excludes non-loan types and loans missing a payment or a due day', () => {
    const obs = selectLoanObligations({
      accounts: [
        acct({ id: 'credit', type: 'CREDIT' }),
        acct({ id: 'checking', type: 'CHECKING' }),
        acct({ id: 'noPay', minimumPaymentCents: null }),
        acct({ id: 'zeroPay', minimumPaymentCents: 0 }),
        acct({ id: 'noDue', dueDayOfMonth: null }),
      ],
      today: TODAY,
      holidays: HOL,
    });
    expect(obs).toEqual([]);
  });

  it('clamps an effective due date that would land before today up to today', () => {
    // today is Sunday 2026-07-05, dueDay 5 → dueDate 2026-07-05; its prior business day
    // (2026-07-02) is before today, so the obligation clamps UP to today — the same
    // "never before today" rule the cash-needed engine applies to cards.
    const [o] = selectLoanObligations({
      accounts: [acct({ id: 'auto', dueDayOfMonth: 5 })],
      today: isoDate('2026-07-05'),
      holidays: HOL,
    });
    expect(o.dueDate).toBe('2026-07-05');
    expect(o.effectiveDueDate).toBe('2026-07-05');
  });

  it('sorts by effective due date, then account name', () => {
    const obs = selectLoanObligations({
      accounts: [
        acct({ id: 'late', name: 'Zeta Loan', dueDayOfMonth: 20, minimumPaymentCents: 50000 }),
        acct({ id: 'earlyB', name: 'Beta Loan', dueDayOfMonth: 12, minimumPaymentCents: 60000 }),
        acct({ id: 'earlyA', name: 'Alpha Loan', dueDayOfMonth: 12, minimumPaymentCents: 70000 }),
      ],
      today: TODAY,
      holidays: HOL,
    });
    expect(obs.map((o) => o.accountId)).toEqual(['earlyA', 'earlyB', 'late']);
  });
});
