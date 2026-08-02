/**
 * Guilt-free trailing income pattern (DECISIONS #370): earned pay preferred;
 * investment / interest / mobile deposits never inflate the allocation.
 */
import { describe, expect, it } from 'vitest';
import {
  monthlyGuiltFreeIncomeCents,
  isUntouchableIncomeRow,
} from '@/lib/engine/spending-plan/income-pattern';
import type { TxnLike } from '@/lib/engine/fi/insights';

function txn(partial: Partial<TxnLike> & Pick<TxnLike, 'date' | 'amountCents' | 'rawDescriptor'>): TxnLike {
  return {
    accountId: 'chk',
    isTransfer: false,
    status: 'POSTED',
    categoryId: 'income',
    ...partial,
  };
}

describe('monthlyGuiltFreeIncomeCents', () => {
  it('prefers paycheck leaves and ignores mobile-deposit + interest in the same month', () => {
    const months = monthlyGuiltFreeIncomeCents([
      txn({
        date: '2026-07-10',
        amountCents: 1_000_000,
        categoryId: 'paycheck',
        rawDescriptor: 'ACME PAYROLL',
      }),
      txn({
        date: '2026-07-21',
        amountCents: 200_000,
        categoryId: 'income',
        rawDescriptor: 'Deposit Mobile Banking',
      }),
      txn({
        date: '2026-07-15',
        amountCents: 50_000,
        categoryId: 'interest-income',
        rawDescriptor: 'FUND DIVIDEND',
      }),
      txn({
        date: '2026-07-15',
        amountCents: 80_000,
        categoryId: 'investment-income',
        rawDescriptor: 'BROKERAGE DIV',
      }),
    ]);
    expect(months).toEqual([{ month: '2026-07', incomeCents: 1_000_000 }]);
  });

  it('falls back to broad income (minus untouchable) when no earned-pay leaves exist', () => {
    // Demo / users who only file the generic Income category.
    const months = monthlyGuiltFreeIncomeCents([
      txn({
        date: '2026-06-03',
        amountCents: 500_000,
        categoryId: 'income',
        rawDescriptor: 'ACME PAYROLL',
      }),
      txn({
        date: '2026-06-05',
        amountCents: 95_000_000,
        categoryId: 'income',
        rawDescriptor: 'Deposit Mobile Banking',
      }),
      txn({
        date: '2026-06-15',
        amountCents: 10_000,
        categoryId: 'interest-income',
        rawDescriptor: 'Interest Paid',
      }),
    ]);
    expect(months).toEqual([{ month: '2026-06', incomeCents: 500_000 }]);
  });

  it('test_regression__untouchable_income_never_enters_guilt_free_pattern', () => {
    expect(
      isUntouchableIncomeRow(
        txn({
          date: '2026-05-05',
          amountCents: 9_546_539,
          categoryId: 'income',
          rawDescriptor: 'Deposit Mobile Banking',
        }),
      ),
    ).toBe(true);
    expect(
      isUntouchableIncomeRow(
        txn({
          date: '2026-05-15',
          amountCents: 41_250,
          categoryId: 'interest-income',
          rawDescriptor: 'CARDONE EQUITY',
        }),
      ),
    ).toBe(true);
  });

  it('test_regression__second_paycheck_still_on_generic_income_is_not_dropped', () => {
    // Owner 2026-08-01: income ~half of steady pay — #370 used ONLY paycheck
    // leaves once any existed, so a biweekly twin still filed as Income vanished.
    const months = monthlyGuiltFreeIncomeCents([
      txn({
        date: '2026-07-01',
        amountCents: 1_000_000,
        categoryId: 'paycheck',
        rawDescriptor: 'EMPLOYER PAYROLL 1',
      }),
      txn({
        date: '2026-07-15',
        amountCents: 1_000_000,
        categoryId: 'income',
        rawDescriptor: 'EMPLOYER PAYROLL 2',
      }),
      // Must still exclude MM / interest on the earned path.
      txn({
        date: '2026-07-20',
        amountCents: 200_000,
        categoryId: 'income',
        rawDescriptor: 'Deposit Mobile Banking',
      }),
      txn({
        date: '2026-07-22',
        amountCents: 50_000,
        categoryId: 'tax-refund',
        rawDescriptor: 'IRS TREAS',
      }),
    ]);
    // FAIL-OLD: earned-only → 1_000_000
    expect(months).toEqual([{ month: '2026-07', incomeCents: 2_000_000 }]);
  });
});
