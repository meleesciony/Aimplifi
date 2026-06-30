/**
 * Plaid mortgage[]/student[] → Pulse loan-account fields (#134), pure mapper.
 * Mirrors the credit-liability mapper tests: hand-built Plaid fixtures, assert on
 * the mapped {aprBps, minimumPaymentCents, dueDayOfMonth}. Each field is null when
 * Plaid did not report a usable value (caller PRESERVES the existing stored value).
 */
import { describe, expect, it } from 'vitest';
import {
  mapPlaidAccountType,
  mapPlaidMortgageToLoanFields,
  mapPlaidStudentToLoanFields,
  type PlaidMortgageLiability,
  type PlaidStudentLiability,
} from '@/lib/providers/plaid-map';

describe('mapPlaidAccountType — loan subtypes (#134)', () => {
  it('maps a mortgage subtype to MORTGAGE and every other loan subtype to LOAN', () => {
    expect(mapPlaidAccountType('loan', 'mortgage')).toBe('MORTGAGE');
    expect(mapPlaidAccountType('loan', 'student')).toBe('LOAN');
    expect(mapPlaidAccountType('loan', 'auto')).toBe('LOAN');
    expect(mapPlaidAccountType('loan', null)).toBe('LOAN');
  });
});

describe('mapPlaidMortgageToLoanFields', () => {
  it('maps payment (dollars→cents), nested rate (percent→bps), and due day (date→DOM)', () => {
    const m: PlaidMortgageLiability = {
      account_id: 'm1',
      next_monthly_payment: 1850.0,
      next_payment_due_date: '2026-07-15',
      interest_rate: { percentage: 6.49, type: 'fixed' },
    };
    expect(mapPlaidMortgageToLoanFields(m)).toEqual({
      aprBps: 649,
      minimumPaymentCents: 185000,
      dueDayOfMonth: 15,
    });
  });

  it('treats every missing field as null (preserve existing) without throwing', () => {
    expect(
      mapPlaidMortgageToLoanFields({
        account_id: 'm2',
        next_monthly_payment: null,
        next_payment_due_date: null,
        interest_rate: null,
      }),
    ).toEqual({ aprBps: null, minimumPaymentCents: null, dueDayOfMonth: null });
  });

  it('handles an absent interest_rate object and still maps payment + due day', () => {
    expect(
      mapPlaidMortgageToLoanFields({
        account_id: 'm3',
        next_monthly_payment: 2000,
        next_payment_due_date: '2026-08-01',
      }),
    ).toEqual({ aprBps: null, minimumPaymentCents: 200000, dueDayOfMonth: 1 });
  });

  it('a SUB-CENT payment / SUB-BPS rate rounds to 0 → null (preserve), never a written 0 (critic F1)', () => {
    // $0.004 rounds to 0¢ and 0.004% rounds to 0 bps — the pre-fix `> 0` on the raw input let
    // these through and persisted a fabricated 0, ZEROING a stored payment/rate. Round-then-check
    // returns null so applyLoanFields omits the field (preserve-on-null).
    expect(
      mapPlaidMortgageToLoanFields({
        account_id: 'm6',
        next_monthly_payment: 0.004,
        next_payment_due_date: '2026-09-10',
        interest_rate: { percentage: 0.004, type: null },
      }),
    ).toEqual({ aprBps: null, minimumPaymentCents: null, dueDayOfMonth: 10 });
  });

  it('an absurdly large finite payment → null without throwing (critic F2: no cents() safe-int throw)', () => {
    // Pre-fix this threw inside cents() and aborted the whole item liability sweep (incl. its cards).
    expect(() =>
      mapPlaidMortgageToLoanFields({
        account_id: 'm7',
        next_monthly_payment: 1e14, // > the Postgres Int ceiling once ×100
        next_payment_due_date: null,
      }),
    ).not.toThrow();
    expect(
      mapPlaidMortgageToLoanFields({ account_id: 'm7', next_monthly_payment: 1e14, next_payment_due_date: null }),
    ).toEqual({ aprBps: null, minimumPaymentCents: null, dueDayOfMonth: null });
  });

  it('rejects zero / non-positive / non-finite values (→ null, not a fabricated 0)', () => {
    expect(
      mapPlaidMortgageToLoanFields({
        account_id: 'm4',
        next_monthly_payment: 0,
        next_payment_due_date: 'not-a-date',
        interest_rate: { percentage: 0, type: null },
      }),
    ).toEqual({ aprBps: null, minimumPaymentCents: null, dueDayOfMonth: null });
    expect(
      mapPlaidMortgageToLoanFields({
        account_id: 'm5',
        next_monthly_payment: Number.NaN,
        next_payment_due_date: null,
        interest_rate: { percentage: -3, type: null },
      }),
    ).toEqual({ aprBps: null, minimumPaymentCents: null, dueDayOfMonth: null });
  });
});

describe('mapPlaidStudentToLoanFields', () => {
  it('maps minimum_payment_amount, the FLAT interest_rate_percentage, and the due day', () => {
    const s: PlaidStudentLiability = {
      account_id: 's1',
      minimum_payment_amount: 250.0,
      next_payment_due_date: '2026-07-21',
      interest_rate_percentage: 4.53,
    };
    expect(mapPlaidStudentToLoanFields(s)).toEqual({
      aprBps: 453,
      minimumPaymentCents: 25000,
      dueDayOfMonth: 21,
    });
  });

  it('a deferred loan (no payment/date) still maps its known rate; payment+day stay null', () => {
    expect(
      mapPlaidStudentToLoanFields({
        account_id: 's2',
        minimum_payment_amount: null,
        next_payment_due_date: null,
        interest_rate_percentage: 4.53,
      }),
    ).toEqual({ aprBps: 453, minimumPaymentCents: null, dueDayOfMonth: null });
  });
});
