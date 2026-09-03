/**
 * Transaction account write on the detail page (DECISIONS #613).
 *
 * The account was display-only. The write is Transaction.accountId.
 * Amount and date stay put. Splits refuse. Demo cannot learn.
 * Balances stay provider-authoritative.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/recurring', () => ({ refreshRecurringForUser: vi.fn() }));

import { prisma } from '@/lib/db';
import { txnAccountError } from '@/lib/engine/transactions/account';

const USER = `txn-account-${Date.now()}-${process.pid}`;

describe('Transaction detail surface lets the household change the account', () => {
  it('test_regression__txn_account_control_is_on_the_detail_page', () => {
    const page = readFileSync(
      resolve('src/components/finance/transaction-detail-view.tsx'),
      'utf8',
    );
    expect(page).toContain('TxnAccountControl');
    const control = readFileSync(
      resolve('src/components/finance/txn-account-form.tsx'),
      'utf8',
    );
    expect(control).toContain('updateTransactionAccount');
    expect(control).toContain('detail-account');
    expect(control).toContain('Save account');
    expect(control).toContain('onSubmit');
    expect(control).not.toContain('useActionState');
  });
});

describe('txnAccountError — blank refuses', () => {
  it('test_regression__txn_account_refuses_blank', () => {
    expect(txnAccountError('')).toMatch(/Pick an account/);
    expect(txnAccountError('   ')).toMatch(/Pick an account/);
    expect(txnAccountError('acct_1')).toBeUndefined();
  });
});

describe('updateTransactionAccount — move the row, amount stays', () => {
  let checkingId = '';
  let savingsId = '';

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const checking = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'demo',
        name: 'Checking',
        type: 'CHECKING',
        currentBalanceCents: 10_000,
      },
    });
    const savings = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'demo',
        name: 'Savings',
        type: 'SAVINGS',
        currentBalanceCents: 20_000,
      },
    });
    checkingId = checking.id;
    savingsId = savings.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { account: { userId: USER } } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('test_regression__household_can_change_a_transaction_account', async () => {
    const { updateTransactionAccount } = await import('@/server/transaction-account-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const row = await prisma.transaction.create({
        data: {
          accountId: checkingId,
          date: '2026-06-10',
          rawDescriptor: 'SQ *STARBUCKS STORE 123',
          amountCents: -550,
        },
      });
      const fd = new FormData();
      fd.set('accountId', savingsId);
      const res = await updateTransactionAccount(row.id, fd);
      expect(res.ok).toBe(true);
      const updated = await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } });
      expect(updated.accountId).toBe(savingsId);
      expect(updated.amountCents).toBe(-550);
      expect(updated.date).toBe('2026-06-10');
      expect(updated.rawDescriptor).toBe('SQ *STARBUCKS STORE 123');
      const checking = await prisma.account.findUniqueOrThrow({ where: { id: checkingId } });
      const savings = await prisma.account.findUniqueOrThrow({ where: { id: savingsId } });
      expect(checking.currentBalanceCents).toBe(10_000);
      expect(savings.currentBalanceCents).toBe(20_000);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__txn_account_refuses_a_split', async () => {
    const { updateTransactionAccount } = await import('@/server/transaction-account-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const parent = await prisma.transaction.create({
        data: {
          accountId: checkingId,
          date: '2026-06-11',
          rawDescriptor: 'COSTCO',
          amountCents: -10_000,
          isSplitParent: true,
        },
      });
      const fd = new FormData();
      fd.set('accountId', savingsId);
      const res = await updateTransactionAccount(parent.id, fd);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/split/i);
      const still = await prisma.transaction.findUniqueOrThrow({ where: { id: parent.id } });
      expect(still.accountId).toBe(checkingId);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__txn_account_demo_cannot_learn', async () => {
    const { updateTransactionAccount } = await import('@/server/transaction-account-actions');
    const { DEMO_ENTRY_BLOCKED } = await import('@/lib/demo-user');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue('user-demo');
    try {
      const fd = new FormData();
      fd.set('accountId', 'acct-x');
      const res = await updateTransactionAccount('txn-x', fd);
      expect(res.ok).toBe(false);
      expect(res.error).toBe(DEMO_ENTRY_BLOCKED);
    } finally {
      spy.mockRestore();
    }
  });
});
