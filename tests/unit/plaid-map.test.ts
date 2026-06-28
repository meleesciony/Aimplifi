import { describe, expect, it } from 'vitest';
import {
  type PlaidAccount,
  type PlaidCreditLiability,
  type PlaidTransaction,
  mapPlaidAccount,
  mapPlaidAccountType,
  mapPlaidLiabilityToStatement,
  pickPlaidAprBps,
  plaidAmountToCents,
  plaidDollarsToPositiveCents,
  plaidSignedDollarsToCents,
  prepareIngestedTransaction,
} from '@/lib/providers/plaid-map';

describe('plaidAmountToCents — sign flip + float-safe cents', () => {
  it('flips Plaid outflow-positive to Pulse outflow-negative', () => {
    expect(plaidAmountToCents(12.34)).toBe(-1234); // a $12.34 purchase
  });

  it('flips Plaid inflow-negative to Pulse inflow-positive', () => {
    expect(plaidAmountToCents(-100)).toBe(10000); // a $100 deposit
  });

  it('rounds float dollars half-away-from-zero (no float drift)', () => {
    // 12.99 * 100 = 1298.9999999… in float; must land on 1299.
    expect(plaidAmountToCents(12.99)).toBe(-1299);
    expect(plaidAmountToCents(0.1 + 0.2)).toBe(-30); // 0.30
  });

  it('handles zero', () => {
    expect(plaidAmountToCents(0)).toBe(0);
  });

  it('rejects non-finite input', () => {
    expect(() => plaidAmountToCents(NaN)).toThrow();
    expect(() => plaidAmountToCents(Infinity)).toThrow();
  });

  it('plaidDollarsToPositiveCents never flips sign', () => {
    expect(plaidDollarsToPositiveCents(250)).toBe(25000);
    expect(plaidDollarsToPositiveCents(-250)).toBe(25000);
  });
});

describe('plaidSignedDollarsToCents — sign-preserving balance conversion', () => {
  it('keeps a positive balance positive', () => {
    expect(plaidSignedDollarsToCents(250)).toBe(25000);
  });

  it('keeps a negative balance negative (overpaid card / overdrawn account)', () => {
    // Plaid reports balances.current = -75.00 for a card the holder overpaid.
    expect(plaidSignedDollarsToCents(-75)).toBe(-7500);
  });

  it('collapses -0 from a zero balance to 0', () => {
    expect(Object.is(plaidSignedDollarsToCents(0), -0)).toBe(false);
    expect(plaidSignedDollarsToCents(0)).toBe(0);
  });

  it('rounds half-away-from-zero on both signs', () => {
    expect(plaidSignedDollarsToCents(12.995)).toBe(1300);
    expect(plaidSignedDollarsToCents(-12.995)).toBe(-1300);
  });

  it('rejects non-finite input', () => {
    expect(() => plaidSignedDollarsToCents(NaN)).toThrow();
  });
});

describe('mapPlaidAccountType', () => {
  it('maps depository subtypes', () => {
    expect(mapPlaidAccountType('depository', 'checking')).toBe('CHECKING');
    expect(mapPlaidAccountType('depository', 'savings')).toBe('SAVINGS');
    expect(mapPlaidAccountType('depository', null)).toBe('CHECKING');
  });

  it('maps credit / loan / investment', () => {
    expect(mapPlaidAccountType('credit', 'credit card')).toBe('CREDIT');
    expect(mapPlaidAccountType('loan', 'student')).toBe('LOAN');
    expect(mapPlaidAccountType('investment', 'brokerage')).toBe('INVESTMENT');
  });

  it('throws on an unrecognized type rather than guessing (net-worth-sign safety)', () => {
    expect(() => mapPlaidAccountType('other', null)).toThrow(/unrecognized/i);
  });
});

describe('mapPlaidAccount', () => {
  const card: PlaidAccount = {
    account_id: 'plaid-acc-1',
    name: 'Platinum Card',
    mask: '4321',
    type: 'credit',
    subtype: 'credit card',
    balances: { current: 250.0, available: null, limit: 5000.0 },
  };

  it('keeps current signed (positive here), maps fields, available/limit positive', () => {
    const m = mapPlaidAccount(card);
    expect(m).toMatchObject({
      providerRef: 'plaid-acc-1',
      name: 'Platinum Card',
      type: 'CREDIT',
      mask: '4321',
      currentBalanceCents: 25000,
      availableBalanceCents: null,
      creditLimitCents: 500000,
    });
  });

  it('preserves a NEGATIVE current balance (overpaid card) so net-worth sign lands right', () => {
    // An overpaid card: Plaid reports current = -120.50 (lender owes the holder).
    // It must NOT be abs()'d to +120.50, or the type-based liability sign would
    // wrongly subtract a credit the holder actually has.
    const overpaid: PlaidAccount = {
      ...card,
      balances: { current: -120.5, available: 5120.5, limit: 5000.0 },
    };
    const m = mapPlaidAccount(overpaid);
    expect(m.currentBalanceCents).toBe(-12050);
    expect(m.availableBalanceCents).toBe(512050); // available stays non-negative
    expect(m.creditLimitCents).toBe(500000);
  });
});

describe('mapPlaidLiabilityToStatement', () => {
  it('maps a generated statement', () => {
    const credit: PlaidCreditLiability = {
      account_id: 'plaid-acc-1',
      last_statement_balance: 1234.56,
      last_statement_issue_date: '2026-05-28',
      minimum_payment_amount: 35,
      next_payment_due_date: '2026-06-22',
    };
    expect(mapPlaidLiabilityToStatement(credit, 'acct-1')).toEqual({
      accountId: 'acct-1',
      cycleEnd: '2026-05-28',
      dueDate: '2026-06-22',
      statementBalanceCents: 123456,
      minimumPaymentCents: 3500,
      isEstimated: false,
    });
  });

  it('returns null when Plaid has no generated statement yet (estimate path)', () => {
    const credit: PlaidCreditLiability = {
      account_id: 'plaid-acc-1',
      last_statement_balance: null,
      last_statement_issue_date: null,
      minimum_payment_amount: null,
      next_payment_due_date: null,
    };
    expect(mapPlaidLiabilityToStatement(credit, 'acct-1')).toBeNull();
  });
});

describe('prepareIngestedTransaction — categorized, persist-ready row', () => {
  const base = { transaction_id: 'tx-1', account_id: 'p1', pending: false };

  it('a known-merchant purchase: negative amount, confident category, posted', () => {
    const txn: PlaidTransaction = {
      ...base,
      date: '2026-06-08',
      amount: 5.75,
      name: 'STARBUCKS STORE 123 ATLANTA',
      merchant_name: 'Starbucks',
    };
    const row = prepareIngestedTransaction(txn, 'acct-checking');
    expect(row.amountCents).toBe(-575);
    expect(row.categoryId).toBe('dining');
    expect(row.needsReview).toBe(false);
    expect(row.isTransfer).toBe(false);
    expect(row.status).toBe('POSTED');
    expect(row.providerRef).toBe('tx-1');
    expect(row.accountId).toBe('acct-checking');
  });

  it('a payroll credit: positive amount, income', () => {
    const txn: PlaidTransaction = {
      ...base,
      date: '2026-06-05',
      amount: -2500.0, // Plaid inflow is negative
      name: 'ACH DEPOSIT ACME CO PAYROLL',
      pending: false,
    };
    const row = prepareIngestedTransaction(txn, 'acct-checking');
    expect(row.amountCents).toBe(250000);
    expect(row.categoryId).toBe('income');
  });

  it('an online transfer is flagged isTransfer and excluded category', () => {
    const txn: PlaidTransaction = {
      ...base,
      date: '2026-06-06',
      amount: 500.0,
      name: 'ONLINE TRANSFER TO SAVINGS',
    };
    const row = prepareIngestedTransaction(txn, 'acct-checking');
    expect(row.isTransfer).toBe(true);
    expect(row.categoryId).toBe('transfer');
    expect(row.amountCents).toBe(-50000);
  });

  it('pending Plaid transactions map to PENDING status', () => {
    const txn: PlaidTransaction = {
      ...base,
      date: '2026-06-09',
      amount: 20,
      name: 'SQ *FOOD TRUCK',
      pending: true,
    };
    expect(prepareIngestedTransaction(txn, 'acct-checking').status).toBe('PENDING');
  });

  it('falls back through name → merchant_name → "Unknown Merchant"', () => {
    const noName: PlaidTransaction = { ...base, date: '2026-06-09', amount: 1, name: '', merchant_name: 'Etsy' };
    expect(prepareIngestedTransaction(noName, 'a').rawDescriptor).toBe('Etsy');
    const nothing: PlaidTransaction = { ...base, date: '2026-06-09', amount: 1, name: '', merchant_name: null };
    expect(prepareIngestedTransaction(nothing, 'a').rawDescriptor).toBe('Unknown Merchant');
  });

  it('applies a user rule when one matches', () => {
    const txn: PlaidTransaction = {
      ...base,
      date: '2026-06-08',
      amount: 5.75,
      name: 'STARBUCKS STORE 123',
    };
    const row = prepareIngestedTransaction(txn, 'acct-checking', [
      {
        id: 'r1',
        merchantCanonical: 'Starbucks',
        minAmountCents: null,
        maxAmountCents: null,
        weekendOnly: null,
        weekdayOnly: null,
        accountId: null,
        categoryId: 'household',
        priority: 100,
      },
    ]);
    expect(row.categoryId).toBe('household');
  });
});

describe('pickPlaidAprBps — APR percent → basis points (audit #126-followup)', () => {
  it('selects the purchase APR and converts to bps with no float drift', () => {
    expect(
      pickPlaidAprBps({
        aprs: [
          { apr_type: 'balance_transfer_apr', apr_percentage: 0, balance_subject_to_apr: null, interest_charge_amount: null },
          { apr_type: 'purchase_apr', apr_percentage: 24.99, balance_subject_to_apr: 1000, interest_charge_amount: 12.5 },
          { apr_type: 'cash_apr', apr_percentage: 29.99, balance_subject_to_apr: null, interest_charge_amount: null },
        ],
      }),
    ).toBe(2499); // 24.99% → 2499 bps (purchase APR chosen over the higher cash APR)
  });

  it('falls back to the highest non-special APR when no purchase APR is present', () => {
    expect(
      pickPlaidAprBps({
        aprs: [
          { apr_type: 'cash_apr', apr_percentage: 27.24, balance_subject_to_apr: null, interest_charge_amount: null },
          { apr_type: 'special', apr_percentage: 0, balance_subject_to_apr: null, interest_charge_amount: null },
          { apr_type: 'balance_transfer_apr', apr_percentage: 19.99, balance_subject_to_apr: null, interest_charge_amount: null },
        ],
      }),
    ).toBe(2724); // highest non-special (cash 27.24%), not the 0% promo
  });

  it('returns null when no usable APR is reported (so the rate is not zeroed)', () => {
    expect(pickPlaidAprBps({ aprs: [] })).toBeNull();
    expect(pickPlaidAprBps({})).toBeNull();
    expect(pickPlaidAprBps({ aprs: null })).toBeNull();
    expect(
      pickPlaidAprBps({ aprs: [{ apr_type: 'special', apr_percentage: 0, balance_subject_to_apr: null, interest_charge_amount: null }] }),
    ).toBeNull(); // a lone 0% promo is not a usable carrying rate
  });
});
