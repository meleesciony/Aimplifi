/**
 * Transaction amount write on the detail page (DECISIONS #611).
 *
 * The dollars were display-only. The write is amountCents (integer cents).
 * Sign stays with the row. Splits refuse. Demo cannot learn.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/recurring', () => ({ refreshRecurringForUser: vi.fn() }));

import { prisma } from '@/lib/db';
import {
  MAX_TXN_ABS_CENTS,
  signedTxnAmountCents,
  txnAmountError,
} from '@/lib/engine/transactions/amount';

const USER = `txn-amount-${Date.now()}-${process.pid}`;

describe('Transaction detail surface lets the household change the amount', () => {
  it('test_regression__txn_amount_control_is_on_the_detail_page', () => {
    const page = readFileSync(
      resolve('src/components/finance/transaction-detail-view.tsx'),
      'utf8',
    );
    expect(page).toContain('TxnAmountControl');
    expect(page).toContain('detail-amount');
    const control = readFileSync(
      resolve('src/components/finance/txn-amount-form.tsx'),
      'utf8',
    );
    expect(control).toContain('updateTransactionAmount');
    expect(control).toContain('Save amount');
    expect(control).toContain('onSubmit');
    expect(control).not.toContain('useActionState');
  });
});

describe('signedTxnAmountCents — magnitude typed, sign stays', () => {
  it('test_regression__txn_amount_keeps_outflow_and_inflow_sign', () => {
    expect(signedTxnAmountCents(-550, 2_1240)).toBe(-21_240);
    expect(signedTxnAmountCents(5_000, 8_000)).toBe(8_000);
    expect(signedTxnAmountCents(-550, -8_000)).toBe(-8_000);
    expect(signedTxnAmountCents(0, 8_000)).toBe(8_000);
  });

  it('test_regression__txn_amount_refuses_blank_zero_and_over_cap', () => {
    expect(txnAmountError(null)).toMatch(/above \$0/);
    expect(txnAmountError(0)).toMatch(/above \$0/);
    expect(txnAmountError(MAX_TXN_ABS_CENTS + 1)).toMatch(/too large/);
    expect(txnAmountError(8_000)).toBeUndefined();
  });
});

describe('updateTransactionAmount — integer cents, splits refuse', () => {
  let accountId = '';

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const acct = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'demo',
        name: 'Checking',
        type: 'CHECKING',
        currentBalanceCents: 0,
      },
    });
    accountId = acct.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.categorizationRule.deleteMany({ where: { userId: USER } });
    await prisma.transaction.deleteMany({ where: { account: { userId: USER } } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('test_regression__household_can_change_a_transaction_amount', async () => {
    const { updateTransactionAmount } = await import('@/server/transaction-amount-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const row = await prisma.transaction.create({
        data: {
          accountId,
          date: '2026-06-10',
          rawDescriptor: 'SQ *STARBUCKS STORE 123',
          amountCents: -550,
        },
      });
      const fd = new FormData();
      fd.set('amount', '$12.50');
      const res = await updateTransactionAmount(row.id, fd);
      expect(res.ok).toBe(true);
      const updated = await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } });
      expect(updated.amountCents).toBe(-1_250);
      expect(updated.rawDescriptor).toBe('SQ *STARBUCKS STORE 123');
      expect(updated.date).toBe('2026-06-10');

      const inflow = await prisma.transaction.create({
        data: {
          accountId,
          date: '2026-06-15',
          rawDescriptor: 'PAYROLL ACME',
          amountCents: 5_000,
        },
      });
      const inFd = new FormData();
      inFd.set('amount', '80.00');
      const inRes = await updateTransactionAmount(inflow.id, inFd);
      expect(inRes.ok).toBe(true);
      const inUpdated = await prisma.transaction.findUniqueOrThrow({ where: { id: inflow.id } });
      expect(inUpdated.amountCents).toBe(8_000);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__household_amount_edit_re_matches_the_row', async () => {
    const { updateTransactionAmount } = await import('@/server/transaction-amount-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      await prisma.categorizationRule.create({
        data: {
          userId: USER,
          categoryId: 'groceries',
          priority: 110,
          matchKeywords: 'costco',
          minAmountCents: 10_000,
        },
      });
      const row = await prisma.transaction.create({
        data: {
          accountId,
          date: '2026-06-10',
          rawDescriptor: 'COSTCO WHSE #1084',
          amountCents: -2_000,
          categoryId: 'dining',
          needsReview: false,
        },
      });
      const fd = new FormData();
      fd.set('amount', '150.00');
      const res = await updateTransactionAmount(row.id, fd);
      expect(res.ok).toBe(true);
      const updated = await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } });
      expect(updated.amountCents).toBe(-15_000);
      expect(updated.categoryId).toBe('groceries');
      expect(updated.rawDescriptor).toBe('COSTCO WHSE #1084');
      expect(updated.needsReview).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__txn_amount_refuses_a_split', async () => {
    const { updateTransactionAmount } = await import('@/server/transaction-amount-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const parent = await prisma.transaction.create({
        data: {
          accountId,
          date: '2026-06-11',
          rawDescriptor: 'COSTCO',
          amountCents: -10_000,
          isSplitParent: true,
        },
      });
      const fd = new FormData();
      fd.set('amount', '50');
      const res = await updateTransactionAmount(parent.id, fd);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/split/i);
      const still = await prisma.transaction.findUniqueOrThrow({ where: { id: parent.id } });
      expect(still.amountCents).toBe(-10_000);

      const child = await prisma.transaction.create({
        data: {
          accountId,
          date: '2026-06-11',
          rawDescriptor: 'COSTCO GROCERIES',
          amountCents: -4_000,
          splitParentId: parent.id,
        },
      });
      const childRes = await updateTransactionAmount(child.id, fd);
      expect(childRes.ok).toBe(false);
      expect(childRes.error).toMatch(/split/i);
      const childStill = await prisma.transaction.findUniqueOrThrow({ where: { id: child.id } });
      expect(childStill.amountCents).toBe(-4_000);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__txn_amount_demo_cannot_learn', async () => {
    const { updateTransactionAmount } = await import('@/server/transaction-amount-actions');
    const { DEMO_ENTRY_BLOCKED } = await import('@/lib/demo-user');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue('user-demo');
    try {
      const fd = new FormData();
      fd.set('amount', '12.50');
      const res = await updateTransactionAmount('txn-x', fd);
      expect(res.ok).toBe(false);
      expect(res.error).toBe(DEMO_ENTRY_BLOCKED);
    } finally {
      spy.mockRestore();
    }
  });
});
