/**
 * H.9 — reader-chosen payee on a LOAN/MORTGAGE, register-axis rows, named zeros.
 */
import { describe, expect, it } from 'vitest';
import {
  isLoanPaymentHistoryAccount,
  loanPaymentHistoryAskCopy,
  loanPaymentHistoryEmptyCopy,
  loanPaymentHistoryHeading,
  loanPaymentHistoryNoCandidatesCopy,
  loanPaymentHistoryRegisterLinkLabel,
  paymentMerchantPanelState,
  selectLoanPaymentHistoryRows,
  type LoanPaymentHistoryRow,
} from '@/lib/engine/account/loan-payment-history';
import { merchantNameEquals } from '@/lib/engine/transactions/query';

const PAY: LoanPaymentHistoryRow = {
  id: 't-2',
  date: '2026-06-03',
  accountId: 'chk',
  accountName: 'Everyday Checking',
  amountCents: -621_707,
  isTransfer: true,
  merchantName: 'Wells Fargo Mortgage',
};
const OLDER: LoanPaymentHistoryRow = {
  ...PAY,
  id: 't-1',
  date: '2026-05-03',
  amountCents: -621_707,
};
const REFUND: LoanPaymentHistoryRow = {
  ...PAY,
  id: 't-3',
  date: '2026-06-10',
  amountCents: 12_000,
  isTransfer: false,
};
const OTHER: LoanPaymentHistoryRow = {
  ...PAY,
  id: 't-x',
  date: '2026-06-01',
  merchantName: 'Wells Fargo Mortgage Extra',
};

describe('isLoanPaymentHistoryAccount', () => {
  it('is the C.24 loan set and nothing else', () => {
    expect(isLoanPaymentHistoryAccount('LOAN')).toBe(true);
    expect(isLoanPaymentHistoryAccount('MORTGAGE')).toBe(true);
    expect(isLoanPaymentHistoryAccount('CREDIT')).toBe(false);
    expect(isLoanPaymentHistoryAccount('CHECKING')).toBe(false);
    expect(isLoanPaymentHistoryAccount('OTHER_LIABILITY')).toBe(false);
    expect(isLoanPaymentHistoryAccount('REAL_ESTATE')).toBe(false);
  });
});

describe('merchantNameEquals — the register axis H.9 shares', () => {
  it('is case-insensitive exact, never a prefix', () => {
    expect(merchantNameEquals('Wells Fargo Mortgage', 'wells fargo mortgage')).toBe(true);
    expect(merchantNameEquals('Wells Fargo Mortgage', '  Wells Fargo Mortgage  ')).toBe(true);
    expect(merchantNameEquals('Wells Fargo Mortgage Extra', 'Wells Fargo Mortgage')).toBe(false);
    expect(merchantNameEquals('Wells Fargo Mortgage', '')).toBe(false);
    expect(merchantNameEquals('Wells Fargo Mortgage', '   ')).toBe(false);
  });
});

describe('selectLoanPaymentHistoryRows', () => {
  it('keeps the register merchant axis, both signs, newest first, and transfer-flagged rows', () => {
    const rows = selectLoanPaymentHistoryRows([OTHER, PAY, REFUND, OLDER], 'Wells Fargo Mortgage');
    expect(rows.map((r) => r.id)).toEqual(['t-3', 't-2', 't-1']);
    expect(rows.every((r) => r.merchantName === 'Wells Fargo Mortgage')).toBe(true);
    expect(rows.find((r) => r.id === 't-2')?.isTransfer).toBe(true);
    expect(rows.find((r) => r.id === 't-3')?.amountCents).toBe(12_000);
  });

  it('same-day rows sort by id descending (the register order)', () => {
    const a = { ...PAY, id: 't-a', date: '2026-06-03' };
    const b = { ...PAY, id: 't-b', date: '2026-06-03' };
    expect(selectLoanPaymentHistoryRows([a, b], 'Wells Fargo Mortgage').map((r) => r.id)).toEqual([
      't-b',
      't-a',
    ]);
  });
});

describe('paymentMerchantPanelState', () => {
  it('hides on a spending account — the register is that click', () => {
    expect(
      paymentMerchantPanelState({
        accountType: 'CHECKING',
        canSet: true,
        merchant: null,
        payments: [PAY],
      }).kind,
    ).toBe('hidden');
  });

  it('hides an unlinked loan when the reader cannot set the payee (demo fence)', () => {
    expect(
      paymentMerchantPanelState({
        accountType: 'MORTGAGE',
        canSet: false,
        merchant: null,
        payments: [PAY],
      }).kind,
    ).toBe('hidden');
  });

  it('asks when a real reader has not chosen — never lists unlinked rows', () => {
    const s = paymentMerchantPanelState({
      accountType: 'MORTGAGE',
      canSet: true,
      merchant: null,
      payments: [PAY],
    });
    expect(s).toEqual({ kind: 'ask' });
  });

  it('lists the matching rows when linked', () => {
    const s = paymentMerchantPanelState({
      accountType: 'LOAN',
      canSet: true,
      merchant: { id: 'm1', canonical: 'Wells Fargo Mortgage' },
      payments: [PAY, OTHER],
    });
    expect(s.kind).toBe('linked');
    if (s.kind !== 'linked') return;
    expect(s.payments).toHaveLength(1);
    expect(s.payments[0]?.id).toBe('t-2');
  });

  it('names the empty when linked and nothing matches — not “paid off”', () => {
    const s = paymentMerchantPanelState({
      accountType: 'MORTGAGE',
      canSet: false,
      merchant: { id: 'm1', canonical: 'Wells Fargo Mortgage' },
      payments: [OTHER],
    });
    expect(s).toEqual({
      kind: 'linked-empty',
      merchantId: 'm1',
      canonical: 'Wells Fargo Mortgage',
    });
    expect(loanPaymentHistoryEmptyCopy('Wells Fargo Mortgage')).toContain('Wells Fargo Mortgage');
    expect(loanPaymentHistoryEmptyCopy('Wells Fargo Mortgage')).toContain('not a claim that nothing was paid');
  });
});

describe('copy', () => {
  it('the ask does not claim a history and refuses to guess', () => {
    expect(loanPaymentHistoryAskCopy()).toContain('will not guess');
    expect(loanPaymentHistoryAskCopy()).toMatch(/payee/i);
    expect(loanPaymentHistoryNoCandidatesCopy()).toContain('Add a charge there first');
    expect(loanPaymentHistoryHeading('Wells Fargo Mortgage')).toBe('Activity from Wells Fargo Mortgage');
    expect(loanPaymentHistoryRegisterLinkLabel('Wells Fargo Mortgage')).toBe(
      'Every Wells Fargo Mortgage in activity',
    );
  });
});
